import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { fail, logActivity, requireMember } from "./lib/access";
import { encryptSecret, pkceChallenge, randomToken, sha256Hex } from "./lib/crypto";
import { cancelJob, recomputePostStatus } from "./lib/postStatus";
import { connectBluesky } from "./platforms/bluesky";
import { PublishError } from "./platforms/http";
import { PROVIDERS, providerConfigured, redirectUri } from "./platforms";
import { vPlatform } from "./schema";

const PROVIDER_IDS = ["meta", "threads", "linkedin", "google", "tiktok", "pinterest", "bluesky", "x"];
const STATE_TTL_MS = 10 * 60 * 1000;

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { role } = await requireMember(ctx, workspaceId);
    const channels = await ctx.db.query("channels").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    const isAdmin = role === "admin" || role === "owner";
    return {
      channels,
      providers: PROVIDER_IDS.map((id) => ({
        id,
        configured: providerConfigured(id),
        // Setup details are only useful to (and only shown to) admins.
        redirectUri: isAdmin && id !== "bluesky" ? redirectUri(id) : null,
        envVars: isAdmin && id !== "bluesky" ? PROVIDERS[id].env : [],
      })),
    };
  },
});

export const assertAdmin = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => (await requireMember(ctx, workspaceId, "admin")).userId,
});

/** Step 1 of connecting a network: build the sign-in link. */
export const startOAuth = action({
  args: { workspaceId: v.id("workspaces"), provider: v.string() },
  handler: async (ctx, { workspaceId, provider }): Promise<string> => {
    const userId = await ctx.runQuery(internal.channels.assertAdmin, { workspaceId });
    const p = PROVIDERS[provider];
    if (!p || !providerConfigured(provider)) fail("That network is not set up yet. See the README.");
    const state = randomToken(32);
    const codeVerifier = p.usesPkce ? randomToken(48) : undefined;
    await ctx.runMutation(internal.channels.saveState, {
      stateHash: await sha256Hex(state), workspaceId, userId, provider, codeVerifier,
    });
    return p.authUrl({
      state, redirectUri: redirectUri(provider),
      codeChallenge: codeVerifier ? await pkceChallenge(codeVerifier) : undefined,
    });
  },
});

export const saveState = internalMutation({
  args: {
    stateHash: v.string(), workspaceId: v.id("workspaces"), userId: v.id("users"),
    provider: v.string(), codeVerifier: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthStates", { ...args, expiresAt: Date.now() + STATE_TTL_MS });
  },
});

/** One-time use: the state row is deleted as it is read. */
export const consumeState = internalMutation({
  args: { stateHash: v.string(), provider: v.string() },
  handler: async (ctx, { stateHash, provider }) => {
    const row = await ctx.db.query("oauthStates").withIndex("by_state", (q) => q.eq("stateHash", stateHash)).unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now() || row.provider !== provider) return null;
    // The person who started the flow must still be an admin.
    const member = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", row.workspaceId).eq("userId", row.userId))
      .unique();
    if (!member || (member.role !== "admin" && member.role !== "owner")) return null;
    return { workspaceId: row.workspaceId, userId: row.userId, codeVerifier: row.codeVerifier };
  },
});

const vSealedAccount = v.object({
  platform: vPlatform,
  externalId: v.string(),
  displayName: v.string(),
  handle: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  boards: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
  accessTokenEnc: v.string(),
  refreshTokenEnc: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
});

export const upsertAccounts = internalMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users"), accounts: v.array(vSealedAccount) },
  handler: async (ctx, { workspaceId, userId, accounts }) => {
    for (const a of accounts) {
      const existing = await ctx.db
        .query("channels")
        .withIndex("by_workspace_platform_external", (q) =>
          q.eq("workspaceId", workspaceId).eq("platform", a.platform).eq("externalId", a.externalId))
        .unique();
      const fields = {
        displayName: a.displayName.slice(0, 120), handle: a.handle, avatarUrl: a.avatarUrl, boards: a.boards,
        status: "active" as const, statusDetail: undefined,
      };
      let channelId;
      if (existing) {
        channelId = existing._id;
        await ctx.db.patch(channelId, fields);
      } else {
        channelId = await ctx.db.insert("channels", {
          workspaceId, platform: a.platform, externalId: a.externalId, connectedBy: userId, ...fields,
        });
      }
      const secret = await ctx.db.query("channelSecrets").withIndex("by_channel", (q) => q.eq("channelId", channelId)).unique();
      const sealed = { accessTokenEnc: a.accessTokenEnc, refreshTokenEnc: a.refreshTokenEnc, expiresAt: a.expiresAt };
      if (secret) await ctx.db.replace(secret._id, { channelId, ...sealed });
      else await ctx.db.insert("channelSecrets", { channelId, ...sealed });
    }
    if (accounts.length > 0) {
      await logActivity(ctx, {
        workspaceId, userId, action: "Channels connected",
        detail: accounts.map((a) => `${a.platform}: ${a.displayName}`).join(", "),
      });
    }
  },
});

export const connectBlueskyAccount = action({
  args: { workspaceId: v.id("workspaces"), handle: v.string(), appPassword: v.string() },
  handler: async (ctx, { workspaceId, handle, appPassword }) => {
    const userId = await ctx.runQuery(internal.channels.assertAdmin, { workspaceId });
    const cleanHandle = handle.trim().replace(/^@/, "");
    if (!cleanHandle || cleanHandle.length > 253 || appPassword.length > 100) fail("Check the handle and app password.");
    let account;
    try {
      account = await connectBluesky(cleanHandle, appPassword.trim());
    } catch (e) {
      if (e instanceof PublishError && e.kind === "auth") fail("Bluesky did not accept that handle and app password.");
      fail("Could not reach Bluesky. Try again in a minute.");
    }
    await ctx.runMutation(internal.channels.upsertAccounts, {
      workspaceId, userId,
      accounts: [{
        platform: account.platform, externalId: account.externalId, displayName: account.displayName,
        handle: account.handle, avatarUrl: account.avatarUrl,
        accessTokenEnc: await encryptSecret(account.tokens.accessToken),
      }],
    });
  },
});

export const setPaused = mutation({
  args: { channelId: v.id("channels"), paused: v.boolean() },
  handler: async (ctx, { channelId, paused }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) fail("Channel not found.");
    await requireMember(ctx, channel.workspaceId, "admin");
    if (channel.status === "needs_reauth") fail("Reconnect this channel first.");
    await ctx.db.patch(channelId, { status: paused ? "paused" : "active" });
  },
});

export const disconnect = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) return;
    const { userId } = await requireMember(ctx, channel.workspaceId, "admin");
    // Anything still waiting to go out on this channel is stopped and marked.
    const targets = await ctx.db.query("postTargets").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect();
    for (const t of targets) {
      if (t.status !== "pending") continue;
      await cancelJob(ctx, t);
      await ctx.db.patch(t._id, { status: "failed", lastError: "This channel was disconnected.", scheduledFnId: undefined, runToken: undefined });
      await recomputePostStatus(ctx, t.postId);
    }
    const secret = await ctx.db.query("channelSecrets").withIndex("by_channel", (q) => q.eq("channelId", channelId)).unique();
    if (secret) await ctx.db.delete(secret._id);
    // Keep the channel row out of pickers but leave history readable.
    await ctx.db.delete(channelId);
    await logActivity(ctx, {
      workspaceId: channel.workspaceId, userId, action: "Channel disconnected",
      detail: `${channel.platform}: ${channel.displayName}`,
    });
  },
});

export const purgeExpiredStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const row of await ctx.db.query("oauthStates").take(500)) {
      if (row.expiresAt < now) await ctx.db.delete(row._id);
    }
  },
});
