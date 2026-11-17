// The publishing engine. One scheduled job per channel per post.
//
//   claim (mutation)  -> marks the target "publishing", hands back what to send
//   publishTarget     -> decrypts the token, refreshes it if needed, calls the network
//   finish (mutation) -> records success, or failure with retry/backoff
//
// Convex runs scheduled actions at most once, so a crash mid-publish can never
// cause an automatic double post. The watchdog below surfaces anything stuck.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { logActivity } from "./lib/access";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { recomputePostStatus } from "./lib/postStatus";
import { PublishError, type MediaItem, type TokenSet } from "./platforms/http";
import { providerFor, PUBLISHERS } from "./platforms";
import { PLATFORM_INFO } from "./shared/platforms";

const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 20 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export const claim = internalMutation({
  args: { targetId: v.id("postTargets"), runToken: v.string() },
  handler: async (ctx, { targetId, runToken }) => {
    const target = await ctx.db.get(targetId);
    // Stale job (post was edited, rescheduled, or removed): do nothing.
    if (!target || target.status !== "pending" || target.runToken !== runToken) return null;
    const post = await ctx.db.get(target.postId);
    if (!post || (post.status !== "scheduled" && post.status !== "publishing")) return null;

    const stop = async (message: string) => {
      await ctx.db.patch(targetId, { status: "failed", lastError: message, scheduledFnId: undefined });
      await recomputePostStatus(ctx, post._id);
      await logActivity(ctx, { workspaceId: post.workspaceId, postId: post._id, action: "Publishing failed", detail: message, level: "error" });
      return null;
    };

    const channel = await ctx.db.get(target.channelId);
    if (!channel) return await stop("This channel was disconnected.");
    if (channel.status === "paused") return await stop(`${channel.displayName} is paused.`);
    if (channel.status === "needs_reauth") return await stop(`${channel.displayName} needs to be reconnected.`);
    const secret = await ctx.db.query("channelSecrets").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).unique();
    if (!secret) return await stop(`${channel.displayName} needs to be reconnected.`);

    const media = [];
    for (const id of post.mediaIds) {
      const m = await ctx.db.get(id);
      if (!m) continue;
      const url = await ctx.storage.getUrl(m.storageId);
      if (!url) continue;
      media.push({ url, kind: m.kind, contentType: m.contentType, size: m.size, alt: m.alt, storageId: m.storageId });
    }

    await ctx.db.patch(targetId, { status: "publishing", attempts: target.attempts + 1, publishStartedAt: Date.now() });
    if (post.status !== "publishing") await ctx.db.patch(post._id, { status: "publishing", updatedAt: Date.now() });

    return {
      platform: target.platform,
      text: target.text ?? post.text,
      firstComment: target.firstComment,
      options: target.options ?? {},
      media,
      channel: { _id: channel._id, externalId: channel.externalId, handle: channel.handle },
      secret: { accessTokenEnc: secret.accessTokenEnc, refreshTokenEnc: secret.refreshTokenEnc, expiresAt: secret.expiresAt },
    };
  },
});

export const saveTokens = internalMutation({
  args: {
    channelId: v.id("channels"), accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()), expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { channelId, ...sealed }) => {
    const secret = await ctx.db.query("channelSecrets").withIndex("by_channel", (q) => q.eq("channelId", channelId)).unique();
    if (secret) await ctx.db.replace(secret._id, { channelId, ...sealed });
  },
});

/** Decrypt a channel's tokens and refresh them when they are close to expiry. */
async function freshTokens(
  ctx: { runMutation: (ref: any, args: any) => Promise<any> },
  channelId: Id<"channels">,
  platform: keyof typeof PLATFORM_INFO,
  secret: { accessTokenEnc: string; refreshTokenEnc?: string; expiresAt?: number },
  force = false,
): Promise<TokenSet> {
  let tokens: TokenSet = {
    accessToken: await decryptSecret(secret.accessTokenEnc),
    refreshToken: secret.refreshTokenEnc ? await decryptSecret(secret.refreshTokenEnc) : undefined,
    expiresAt: secret.expiresAt,
  };
  const provider = providerFor(platform);
  // Threads tokens last 60 days and are renewed well ahead of time.
  const margin = platform === "threads" ? 10 * DAY : 5 * 60 * 1000;
  const due = tokens.expiresAt !== undefined && tokens.expiresAt - Date.now() < margin;
  if ((due || force) && provider?.refresh) {
    tokens = await provider.refresh(tokens);
    await ctx.runMutation(internal.publisher.saveTokens, {
      channelId,
      accessTokenEnc: await encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : undefined,
      expiresAt: tokens.expiresAt,
    });
  } else if (tokens.expiresAt !== undefined && tokens.expiresAt < Date.now()) {
    throw new PublishError("Access to this account has expired. Reconnect it.", "auth");
  }
  return tokens;
}

export const publishTarget = internalAction({
  args: { targetId: v.id("postTargets"), runToken: v.string() },
  handler: async (ctx, { targetId, runToken }) => {
    const job = await ctx.runMutation(internal.publisher.claim, { targetId, runToken });
    if (!job) return;
    try {
      const tokens = await freshTokens(ctx, job.channel._id, job.platform, job.secret);
      const media: MediaItem[] = job.media.map((m) => ({
        url: m.url, kind: m.kind, contentType: m.contentType, size: m.size, alt: m.alt,
        blob: async () => {
          const blob = await ctx.storage.get(m.storageId);
          if (!blob) throw new PublishError("A media file is missing.", "permanent");
          return blob;
        },
      }));
      const result = await PUBLISHERS[job.platform]({
        text: job.text, firstComment: job.firstComment, options: job.options, media,
        channel: job.channel, accessToken: tokens.accessToken,
      });
      await ctx.runMutation(internal.publisher.finish, {
        targetId, ok: true, externalPostId: result.externalId, permalink: result.permalink,
      });
    } catch (e) {
      const kind = e instanceof PublishError ? e.kind : "permanent";
      const message = e instanceof Error ? e.message : "Unknown error";
      await ctx.runMutation(internal.publisher.finish, { targetId, ok: false, errorKind: kind, error: message });
    }
  },
});

export const finish = internalMutation({
  args: {
    targetId: v.id("postTargets"),
    ok: v.boolean(),
    externalPostId: v.optional(v.string()),
    permalink: v.optional(v.string()),
    errorKind: v.optional(v.union(v.literal("auth"), v.literal("retryable"), v.literal("permanent"))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target || target.status !== "publishing") return;
    const channel = await ctx.db.get(target.channelId);
    const where = channel ? `${PLATFORM_INFO[target.platform].label}: ${channel.displayName}` : PLATFORM_INFO[target.platform].label;

    if (args.ok) {
      await ctx.db.patch(target._id, {
        status: "published", externalPostId: args.externalPostId, permalink: args.permalink,
        publishedAt: Date.now(), lastError: undefined, scheduledFnId: undefined,
      });
      await logActivity(ctx, { workspaceId: target.workspaceId, postId: target.postId, action: "Published", detail: where });
    } else {
      const error = (args.error ?? "Unknown error").slice(0, 600);
      if (args.errorKind === "auth" && channel) {
        await ctx.db.patch(channel._id, { status: "needs_reauth", statusDetail: "The network rejected the saved access. Reconnect." });
      }
      if (args.errorKind === "retryable" && target.attempts < MAX_ATTEMPTS) {
        // Back off: 2 minutes, then 8 minutes.
        const delay = 2 * 60 * 1000 * 4 ** (target.attempts - 1);
        const runToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const scheduledFnId = await ctx.scheduler.runAfter(delay, internal.publisher.publishTarget, {
          targetId: target._id, runToken,
        });
        await ctx.db.patch(target._id, { status: "pending", lastError: error, scheduledFnId, runToken });
      } else {
        await ctx.db.patch(target._id, { status: "failed", lastError: error, scheduledFnId: undefined });
        await logActivity(ctx, {
          workspaceId: target.workspaceId, postId: target.postId, action: "Publishing failed",
          detail: `${where}. ${error}`, level: "error",
        });
      }
    }
    await recomputePostStatus(ctx, target.postId);
  },
});

/** Anything "publishing" for too long is marked failed so a person can look. */
export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stuck = await ctx.db.query("postTargets").withIndex("by_status", (q) => q.eq("status", "publishing")).take(200);
    const cutoff = Date.now() - STUCK_AFTER_MS;
    for (const t of stuck) {
      if ((t.publishStartedAt ?? 0) > cutoff) continue;
      const message = "Publishing was interrupted. Check the network to see if the post went out before you retry.";
      await ctx.db.patch(t._id, { status: "failed", lastError: message, scheduledFnId: undefined });
      await logActivity(ctx, { workspaceId: t.workspaceId, postId: t.postId, action: "Publishing failed", detail: message, level: "error" });
      await recomputePostStatus(ctx, t.postId);
    }
  },
});

/** Daily: renew tokens that are close to expiry so channels do not go stale. */
export const expiringChannels = internalMutation({
  args: {},
  handler: async (ctx) => {
    const soon = Date.now() + 10 * DAY;
    const out = [];
    for (const secret of await ctx.db.query("channelSecrets").take(1000)) {
      if (secret.expiresAt === undefined || secret.expiresAt > soon) continue;
      const channel = await ctx.db.get(secret.channelId);
      if (!channel || channel.status === "needs_reauth") continue;
      if (channel.platform !== "threads" && !secret.refreshTokenEnc) {
        // No way to renew. Flag it once the token has actually run out.
        if (secret.expiresAt < Date.now()) {
          await ctx.db.patch(channel._id, { status: "needs_reauth", statusDetail: "Access expired. Reconnect." });
        }
        continue;
      }
      out.push({
        channelId: channel._id, platform: channel.platform,
        secret: { accessTokenEnc: secret.accessTokenEnc, refreshTokenEnc: secret.refreshTokenEnc, expiresAt: secret.expiresAt },
      });
    }
    return out;
  },
});

export const flagChannel = internalMutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    await ctx.db.patch(channelId, { status: "needs_reauth", statusDetail: "Access could not be renewed. Reconnect." });
  },
});

export const renewTokens = internalAction({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.runMutation(internal.publisher.expiringChannels, {});
    for (const item of due) {
      try {
        await freshTokens(ctx, item.channelId, item.platform, item.secret, true);
      } catch (e) {
        if (e instanceof PublishError && e.kind === "auth") {
          await ctx.runMutation(internal.publisher.flagChannel, { channelId: item.channelId });
        }
        console.error("Token renewal failed:", e instanceof Error ? e.message : "unknown error");
      }
    }
  },
});
