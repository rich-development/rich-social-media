import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { cleanText, fail, logActivity, requireMember, requireUser } from "./lib/access";
import { randomToken, sha256Hex } from "./lib/crypto";
import { isValidTimeZone } from "./lib/time";
import { vQueueSlot, vRole } from "./schema";

const DEFAULT_SLOTS = [
  { days: [1, 2, 3, 4, 5], time: "09:00" },
  { days: [1, 2, 3, 4, 5], time: "12:30" },
  { days: [1, 2, 3, 4, 5], time: "18:00" },
];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Who may create a workspace:
 *  - anyone listed in OWNER_EMAILS (comma separated), when that is set
 *  - otherwise the very first account on a fresh deployment
 *  - anyone who already owns a workspace (more brands)
 * Everybody else needs an invite link. An account without a workspace can
 * read and write nothing.
 */
async function mayCreateWorkspace(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  const allow = (process.env.OWNER_EMAILS ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length > 0) return !!user?.email && allow.includes(user.email);
  const anyWorkspace = await ctx.db.query("workspaces").first();
  if (!anyWorkspace) return true;
  const mine = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  return mine.some((m) => m.role === "owner");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const memberships = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const out = [];
    for (const m of memberships) {
      const ws = await ctx.db.get(m.workspaceId);
      if (ws) out.push({ ...ws, role: m.role });
    }
    return { workspaces: out, canCreate: await mayCreateWorkspace(ctx, userId) };
  },
});

export const create = mutation({
  args: { name: v.string(), timezone: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!(await mayCreateWorkspace(ctx, userId))) fail("You need an invite link to join a workspace.");
    const name = cleanText(args.name, 60, "Name");
    if (!name) fail("Give the workspace a name.");
    if (!isValidTimeZone(args.timezone)) fail("Unknown time zone.");
    const workspaceId = await ctx.db.insert("workspaces", {
      name, timezone: args.timezone, requireApproval: false, queueSlots: DEFAULT_SLOTS, createdBy: userId,
    });
    await ctx.db.insert("members", { workspaceId, userId, role: "owner" });
    await logActivity(ctx, { workspaceId, userId, action: "Workspace created" });
    return workspaceId;
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
    timezone: v.optional(v.string()),
    requireApproval: v.optional(v.boolean()),
    queueSlots: v.optional(v.array(vQueueSlot)),
  },
  handler: async (ctx, { workspaceId, ...changes }) => {
    const { userId } = await requireMember(ctx, workspaceId, "admin");
    const patch: Record<string, unknown> = {};
    if (changes.name !== undefined) {
      const name = cleanText(changes.name, 60, "Name");
      if (!name) fail("Give the workspace a name.");
      patch.name = name;
    }
    if (changes.timezone !== undefined) {
      if (!isValidTimeZone(changes.timezone)) fail("Unknown time zone.");
      patch.timezone = changes.timezone;
    }
    if (changes.requireApproval !== undefined) patch.requireApproval = changes.requireApproval;
    if (changes.queueSlots !== undefined) {
      if (changes.queueSlots.length > 50) fail("Too many queue times.");
      for (const slot of changes.queueSlots) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)) fail("Queue times must look like 09:30.");
        if (slot.days.length === 0 || slot.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
          fail("Pick at least one day for each queue time.");
        }
      }
      patch.queueSlots = changes.queueSlots;
    }
    await ctx.db.patch(workspaceId, patch);
    await logActivity(ctx, { workspaceId, userId, action: "Workspace settings updated" });
  },
});

export const members = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { userId, role } = await requireMember(ctx, workspaceId);
    const rows = await ctx.db.query("members").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    const out = [];
    for (const m of rows) {
      const u = await ctx.db.get(m.userId);
      out.push({ _id: m._id, userId: m.userId, role: m.role, name: u?.name ?? null, email: u?.email ?? null, isMe: m.userId === userId });
    }
    return { members: out, myRole: role };
  },
});

async function ownerCount(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const rows = await ctx.db.query("members").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
  return rows.filter((m) => m.role === "owner").length;
}

export const setRole = mutation({
  args: { memberId: v.id("members"), role: vRole },
  handler: async (ctx, { memberId, role }) => {
    const target = await ctx.db.get(memberId);
    if (!target) fail("Member not found.");
    const { userId } = await requireMember(ctx, target.workspaceId, "owner");
    if (target.role === "owner" && role !== "owner" && (await ownerCount(ctx, target.workspaceId)) <= 1) {
      fail("A workspace needs at least one owner.");
    }
    await ctx.db.patch(memberId, { role });
    await logActivity(ctx, { workspaceId: target.workspaceId, userId, action: "Member role changed", detail: role });
  },
});

export const removeMember = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const target = await ctx.db.get(memberId);
    if (!target) fail("Member not found.");
    const caller = await requireMember(ctx, target.workspaceId);
    // Owners can remove anyone. Everyone can remove themselves.
    if (caller.userId !== target.userId && caller.role !== "owner") fail("Only an owner can remove members.");
    if (target.role === "owner" && (await ownerCount(ctx, target.workspaceId)) <= 1) {
      fail("A workspace needs at least one owner.");
    }
    await ctx.db.delete(memberId);
    await logActivity(ctx, { workspaceId: target.workspaceId, userId: caller.userId, action: "Member removed" });
  },
});

export const invites = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId, "admin");
    const rows = await ctx.db.query("invites").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    const now = Date.now();
    // Never return the token hash.
    return rows
      .filter((i) => !i.acceptedBy && i.expiresAt > now)
      .map((i) => ({ _id: i._id, role: i.role, note: i.note ?? null, expiresAt: i.expiresAt }));
  },
});

/**
 * Creates a one-time invite link. The token is generated here (real
 * randomness), shown once, and only its hash is stored.
 */
export const createInvite = action({
  args: { workspaceId: v.id("workspaces"), role: vRole, note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ token: string; expiresAt: number }> => {
    const token = randomToken(32);
    const expiresAt: number = await ctx.runMutation(internal.workspaces.insertInvite, {
      ...args, tokenHash: await sha256Hex(token),
    });
    return { token, expiresAt };
  },
});

export const insertInvite = internalMutation({
  args: { workspaceId: v.id("workspaces"), role: vRole, note: v.optional(v.string()), tokenHash: v.string() },
  handler: async (ctx, { workspaceId, role, note, tokenHash }) => {
    const caller = await requireMember(ctx, workspaceId, "admin");
    if (role === "owner" && caller.role !== "owner") fail("Only an owner can invite another owner.");
    const expiresAt = Date.now() + INVITE_TTL_MS;
    await ctx.db.insert("invites", {
      workspaceId, role, tokenHash, invitedBy: caller.userId, expiresAt,
      note: note ? cleanText(note, 120, "Note") : undefined,
    });
    await logActivity(ctx, { workspaceId, userId: caller.userId, action: "Invite link created", detail: role });
    return expiresAt;
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (!invite) return;
    await requireMember(ctx, invite.workspaceId, "admin");
    await ctx.db.delete(inviteId);
  },
});

export const acceptInvite = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Id<"workspaces">> => {
    if (token.length > 200) fail("That invite link is not valid.");
    return await ctx.runMutation(internal.workspaces.redeemInvite, { tokenHash: await sha256Hex(token) });
  },
});

export const redeemInvite = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const userId = await requireUser(ctx);
    const invite = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!invite || invite.acceptedBy || invite.expiresAt < Date.now()) {
      fail("That invite link is not valid or has expired.");
    }
    const existing = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", invite.workspaceId).eq("userId", userId))
      .unique();
    if (!existing) {
      await ctx.db.insert("members", { workspaceId: invite.workspaceId, userId, role: invite.role });
      await ctx.db.patch(invite._id, { acceptedBy: userId });
      await logActivity(ctx, { workspaceId: invite.workspaceId, userId, action: "Joined the workspace" });
    }
    return invite.workspaceId;
  },
});

export const activity = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const rows = await ctx.db
      .query("activity").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc").take(60);
    const names = new Map<string, string>();
    const out = [];
    for (const r of rows) {
      let who: string | null = null;
      if (r.userId) {
        if (!names.has(r.userId)) {
          const u = await ctx.db.get(r.userId);
          names.set(r.userId, u?.name ?? u?.email ?? "Someone");
        }
        who = names.get(r.userId)!;
      }
      out.push({ _id: r._id, at: r._creationTime, action: r.action, detail: r.detail ?? null, level: r.level, who, postId: r.postId ?? null });
    }
    return out;
  },
});
