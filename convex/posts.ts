import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { cleanText, fail, logActivity, requireMember } from "./lib/access";
import { cancelTargets, recomputePostStatus, scheduleTargets, targetsOf } from "./lib/postStatus";
import { nextQueueSlot } from "./lib/time";
import { vPostStatus, vTargetOptions } from "./schema";
import { PLATFORM_INFO, roleAtLeast, validateForPlatform, type MediaKind, type Role } from "./shared/platforms";

const vTargetInput = v.object({
  channelId: v.id("channels"),
  text: v.optional(v.string()),
  firstComment: v.optional(v.string()),
  options: v.optional(vTargetOptions),
});
const vMode = v.union(v.literal("draft"), v.literal("schedule"), v.literal("queue"), v.literal("now"));

type PostInput = {
  postId?: Id<"posts">;
  text: string;
  mediaIds: Id<"media">[];
  targets: { channelId: Id<"channels">; text?: string; firstComment?: string; options?: Doc<"postTargets">["options"] }[];
  label?: string;
  notes?: string;
  mode: "draft" | "schedule" | "queue" | "now";
  scheduledAt?: number;
};

const EDITABLE: Doc<"posts">["status"][] = ["draft", "pending_approval", "scheduled", "failed"];

/** Times already claimed by upcoming posts, so the queue never doubles up. */
async function takenSlots(ctx: QueryCtx, workspaceId: Id<"workspaces">, skip?: Id<"posts">) {
  const upcoming = await ctx.db
    .query("posts")
    .withIndex("by_workspace_scheduled", (q) => q.eq("workspaceId", workspaceId).gt("scheduledAt", Date.now()))
    .collect();
  const taken = new Set<number>();
  for (const p of upcoming) {
    if (p._id !== skip && p.scheduledAt && (p.status === "scheduled" || p.status === "pending_approval")) taken.add(p.scheduledAt);
  }
  return taken;
}

async function queueTime(ctx: QueryCtx, ws: Doc<"workspaces">, skip?: Id<"posts">): Promise<number> {
  const slot = nextQueueSlot(ws.queueSlots, ws.timezone, Date.now(), await takenSlots(ctx, ws._id, skip));
  if (slot === null) fail("The queue has no posting times yet. Add some in Settings.");
  return slot;
}

/** Create or update a post. All write paths for post content go through here. */
async function upsertPost(
  ctx: MutationCtx, ws: Doc<"workspaces">, userId: Id<"users">, role: Role, input: PostInput,
): Promise<{ postId: Id<"posts">; status: Doc<"posts">["status"] }> {
  const text = cleanText(input.text, 65000, "Post text");
  if (input.targets.length > 40) fail("Too many channels on one post.");
  if (input.mediaIds.length > 20) fail("Up to 20 media files per post.");
  if (new Set(input.targets.map((t) => t.channelId)).size !== input.targets.length) fail("A channel was picked twice.");

  const media: { kind: MediaKind; size: number }[] = [];
  for (const id of input.mediaIds) {
    const m = await ctx.db.get(id);
    if (!m || m.workspaceId !== ws._id) fail("A media file was not found.");
    media.push({ kind: m.kind, size: m.size });
  }
  const channels: Doc<"channels">[] = [];
  for (const t of input.targets) {
    const c = await ctx.db.get(t.channelId);
    if (!c || c.workspaceId !== ws._id) fail("A channel was not found.");
    channels.push(c);
  }

  let existing: Doc<"posts"> | null = null;
  if (input.postId) {
    existing = await ctx.db.get(input.postId);
    if (!existing || existing.workspaceId !== ws._id) fail("Post not found.");
    if (!EDITABLE.includes(existing.status)) fail("This post can no longer be edited.");
  }

  let status: Doc<"posts">["status"] = "draft";
  let scheduledAt = input.scheduledAt;
  const queued = input.mode === "queue";
  if (input.mode !== "draft") {
    if (input.targets.length === 0) fail("Pick at least one channel.");
    input.targets.forEach((t, i) => {
      const c = channels[i];
      if (c.status !== "active") fail(`${c.displayName} is ${c.status === "paused" ? "paused" : "waiting to be reconnected"}.`);
      const problems = validateForPlatform(c.platform, (t.text ?? text).trim(), media);
      const blocking = problems.filter((p) => !p.includes("will be skipped"));
      if (blocking.length > 0) fail(`${PLATFORM_INFO[c.platform].label} (${c.displayName}): ${blocking[0]}`);
      if (c.platform === "pinterest" && !t.options?.boardId) fail(`Pick a Pinterest board for ${c.displayName}.`);
    });
    const needsApproval = ws.requireApproval && !roleAtLeast(role, "admin");
    status = needsApproval ? "pending_approval" : "scheduled";
    if (input.mode === "queue") scheduledAt = await queueTime(ctx, ws, input.postId);
    else if (input.mode === "now") scheduledAt = needsApproval ? undefined : Date.now();
    else if (scheduledAt === undefined || scheduledAt < Date.now() - 60_000) fail("Pick a time in the future.");
  }

  const fields = {
    status, text, mediaIds: input.mediaIds, scheduledAt, queued,
    label: input.label ? cleanText(input.label, 40, "Label") : undefined,
    notes: input.notes ? cleanText(input.notes, 2000, "Notes") : undefined,
    approvedBy: status === "scheduled" && ws.requireApproval ? userId : undefined,
    rejectionReason: undefined, publishedAt: undefined, updatedAt: Date.now(),
  };
  let postId: Id<"posts">;
  if (existing) {
    postId = existing._id;
    await cancelTargets(ctx, postId);
    for (const old of await targetsOf(ctx, postId)) await ctx.db.delete(old._id);
    await ctx.db.patch(postId, fields);
  } else {
    postId = await ctx.db.insert("posts", { workspaceId: ws._id, authorId: userId, ...fields });
  }
  for (let i = 0; i < input.targets.length; i++) {
    const t = input.targets[i];
    const override = t.text !== undefined ? cleanText(t.text, 65000, "Caption") : undefined;
    await ctx.db.insert("postTargets", {
      postId, workspaceId: ws._id, channelId: t.channelId, platform: channels[i].platform,
      text: override !== undefined && override !== text ? override : undefined,
      firstComment: t.firstComment ? cleanText(t.firstComment, 2200, "First comment") : undefined,
      options: t.options, status: "pending", attempts: 0,
    });
  }
  if (status === "scheduled") await scheduleTargets(ctx, postId, scheduledAt!);
  return { postId, status };
}

export const save = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    postId: v.optional(v.id("posts")),
    text: v.string(),
    mediaIds: v.array(v.id("media")),
    targets: v.array(vTargetInput),
    label: v.optional(v.string()),
    notes: v.optional(v.string()),
    mode: vMode,
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, ...input }) => {
    const { userId, role } = await requireMember(ctx, workspaceId, "editor");
    const ws = (await ctx.db.get(workspaceId))!;
    const result = await upsertPost(ctx, ws, userId, role, input);
    const action = {
      draft: "Draft saved", pending_approval: "Sent for approval", scheduled: input.mode === "now" ? "Publishing now" : "Post scheduled",
    }[result.status as "draft" | "pending_approval" | "scheduled"];
    await logActivity(ctx, { workspaceId, userId, postId: result.postId, action });
    return result;
  },
});

/** Create many posts at once (CSV import). Each row gets the same channels. */
export const bulkCreate = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    channelIds: v.array(v.id("channels")),
    mode: v.union(v.literal("draft"), v.literal("queue"), v.literal("schedule")),
    rows: v.array(v.object({ text: v.string(), scheduledAt: v.optional(v.number()) })),
  },
  handler: async (ctx, { workspaceId, channelIds, mode, rows }) => {
    const { userId, role } = await requireMember(ctx, workspaceId, "editor");
    if (rows.length === 0 || rows.length > 200) fail("Import between 1 and 200 posts at a time.");
    const ws = (await ctx.db.get(workspaceId))!;
    let created = 0;
    for (const row of rows) {
      if (!row.text.trim()) continue;
      // A row without a time falls back to a draft when importing on a schedule.
      const rowMode = mode === "schedule" && row.scheduledAt === undefined ? "draft" : mode;
      await upsertPost(ctx, ws, userId, role, {
        text: row.text, mediaIds: [], targets: channelIds.map((channelId) => ({ channelId })),
        mode: rowMode, scheduledAt: row.scheduledAt,
      });
      created++;
    }
    await logActivity(ctx, { workspaceId, userId, action: "Bulk import", detail: `${created} posts` });
    return created;
  },
});

async function loadPost(ctx: MutationCtx, postId: Id<"posts">, min: Role) {
  const post = await ctx.db.get(postId);
  if (!post) fail("Post not found.");
  const access = await requireMember(ctx, post.workspaceId, min);
  return { post, ...access, ws: (await ctx.db.get(post.workspaceId))! };
}

export const approve = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const { post, userId, ws } = await loadPost(ctx, postId, "admin");
    if (post.status !== "pending_approval") fail("This post is not waiting for approval.");
    let at = post.scheduledAt;
    if (post.queued && (!at || at <= Date.now())) at = await queueTime(ctx, ws, postId);
    if (!at || at <= Date.now()) at = Date.now();
    await ctx.db.patch(postId, { status: "scheduled", scheduledAt: at, approvedBy: userId, rejectionReason: undefined, updatedAt: Date.now() });
    await scheduleTargets(ctx, postId, at);
    await logActivity(ctx, { workspaceId: post.workspaceId, userId, postId, action: "Post approved" });
  },
});

export const reject = mutation({
  args: { postId: v.id("posts"), reason: v.string() },
  handler: async (ctx, { postId, reason }) => {
    const { post, userId } = await loadPost(ctx, postId, "admin");
    if (post.status !== "pending_approval") fail("This post is not waiting for approval.");
    await ctx.db.patch(postId, { status: "draft", rejectionReason: cleanText(reason, 500, "Reason") || "Changes requested.", updatedAt: Date.now() });
    await logActivity(ctx, { workspaceId: post.workspaceId, userId, postId, action: "Changes requested" });
  },
});

export const reschedule = mutation({
  args: { postId: v.id("posts"), scheduledAt: v.number() },
  handler: async (ctx, { postId, scheduledAt }) => {
    const { post, userId } = await loadPost(ctx, postId, "editor");
    if (!["draft", "pending_approval", "scheduled"].includes(post.status)) fail("This post can no longer be moved.");
    if (scheduledAt < Date.now()) fail("Pick a time in the future.");
    await ctx.db.patch(postId, { scheduledAt, queued: false, updatedAt: Date.now() });
    if (post.status === "scheduled") await scheduleTargets(ctx, postId, scheduledAt);
    await logActivity(ctx, { workspaceId: post.workspaceId, userId, postId, action: "Post rescheduled" });
  },
});

export const unschedule = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const { post, userId } = await loadPost(ctx, postId, "editor");
    if (post.status !== "scheduled" && post.status !== "pending_approval") fail("This post is not scheduled.");
    await cancelTargets(ctx, postId);
    await ctx.db.patch(postId, { status: "draft", updatedAt: Date.now() });
    await logActivity(ctx, { workspaceId: post.workspaceId, userId, postId, action: "Moved back to drafts" });
  },
});

export const remove = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const { post, userId } = await loadPost(ctx, postId, "editor");
    if (post.status === "publishing") fail("This post is going out right now.");
    await cancelTargets(ctx, postId);
    for (const t of await targetsOf(ctx, postId)) await ctx.db.delete(t._id);
    await ctx.db.delete(postId);
    await logActivity(ctx, { workspaceId: post.workspaceId, userId, action: "Post deleted" });
  },
});

export const duplicate = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const { post, userId, role, ws } = await loadPost(ctx, postId, "editor");
    const targets = [];
    for (const t of await targetsOf(ctx, postId)) {
      if (await ctx.db.get(t.channelId)) targets.push({ channelId: t.channelId, text: t.text, firstComment: t.firstComment, options: t.options });
    }
    const media = [];
    for (const id of post.mediaIds) if (await ctx.db.get(id)) media.push(id);
    return await upsertPost(ctx, ws, userId, role, {
      text: post.text, mediaIds: media, targets, label: post.label, notes: post.notes, mode: "draft",
    });
  },
});

/** Try the failed channels of a post again. Channels that worked are left alone. */
export const retry = mutation({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const { post, userId } = await loadPost(ctx, postId, "editor");
    if (post.status !== "failed" && post.status !== "partial") fail("Nothing to retry on this post.");
    for (const t of await targetsOf(ctx, postId)) {
      if (t.status === "failed") await ctx.db.patch(t._id, { status: "pending", attempts: 0, lastError: undefined });
    }
    await ctx.db.patch(postId, { status: "scheduled", updatedAt: Date.now() });
    await scheduleTargets(ctx, postId, Date.now());
    await recomputePostStatus(ctx, postId);
    await logActivity(ctx, { workspaceId: post.workspaceId, userId, postId, action: "Retrying failed channels" });
  },
});

async function hydrate(ctx: QueryCtx, post: Doc<"posts">) {
  const targets = [];
  for (const t of await ctx.db.query("postTargets").withIndex("by_post", (q) => q.eq("postId", post._id)).collect()) {
    const c = await ctx.db.get(t.channelId);
    targets.push({
      _id: t._id, channelId: t.channelId, platform: t.platform, text: t.text ?? null,
      firstComment: t.firstComment ?? null, options: t.options ?? null, status: t.status,
      lastError: t.lastError ?? null, permalink: t.permalink ?? null, publishedAt: t.publishedAt ?? null,
      channelName: c?.displayName ?? "Disconnected channel", avatarUrl: c?.avatarUrl ?? null,
    });
  }
  const media = [];
  for (const id of post.mediaIds) {
    const m = await ctx.db.get(id);
    if (m) media.push({ _id: m._id, kind: m.kind, name: m.name, size: m.size, url: await ctx.storage.getUrl(m.storageId) });
  }
  const author = await ctx.db.get(post.authorId);
  return { ...post, targets, media, authorName: author?.name ?? author?.email ?? "Someone" };
}

export const list = query({
  args: { workspaceId: v.id("workspaces"), status: v.optional(vPostStatus) },
  handler: async (ctx, { workspaceId, status }) => {
    await requireMember(ctx, workspaceId);
    const rows = status
      ? await ctx.db.query("posts").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", status)).order("desc").take(200)
      : await ctx.db.query("posts").withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspaceId)).order("desc").take(200);
    const out = [];
    for (const p of rows) out.push(await hydrate(ctx, p));
    if (status === "scheduled" || status === "pending_approval") out.sort((a, b) => (a.scheduledAt ?? Infinity) - (b.scheduledAt ?? Infinity));
    return out;
  },
});

export const calendar = query({
  args: { workspaceId: v.id("workspaces"), from: v.number(), to: v.number() },
  handler: async (ctx, { workspaceId, from, to }) => {
    await requireMember(ctx, workspaceId);
    if (to - from > 100 * 24 * 60 * 60 * 1000) fail("Date range is too wide.");
    const rows = await ctx.db
      .query("posts")
      .withIndex("by_workspace_scheduled", (q) => q.eq("workspaceId", workspaceId).gte("scheduledAt", from).lt("scheduledAt", to))
      .take(600);
    const out = [];
    for (const p of rows) out.push(await hydrate(ctx, p));
    return out;
  },
});

export const get = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    await requireMember(ctx, post.workspaceId);
    return await hydrate(ctx, post);
  },
});

export const counts = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const n = async (status: Doc<"posts">["status"]) =>
      (await ctx.db.query("posts").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", status)).take(500)).length;
    return {
      draft: await n("draft"), pending_approval: await n("pending_approval"), scheduled: await n("scheduled"),
      failed: (await n("failed")) + (await n("partial")),
    };
  },
});

/** The next few queue times, for the composer and the settings page. */
export const upcomingSlots = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const ws = (await ctx.db.get(workspaceId))!;
    const taken = await takenSlots(ctx, workspaceId);
    const out: number[] = [];
    let after = Date.now();
    for (let i = 0; i < 5; i++) {
      const slot = nextQueueSlot(ws.queueSlots, ws.timezone, after, taken);
      if (slot === null) break;
      out.push(slot);
      after = slot;
    }
    return out;
  },
});
