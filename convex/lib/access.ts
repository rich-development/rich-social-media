import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { roleAtLeast, type Role } from "../shared/platforms";

type Ctx = QueryCtx | MutationCtx;

export function fail(message: string): never {
  throw new ConvexError(message);
}

export async function requireUser(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) fail("Please sign in.");
  return userId;
}

/**
 * Every workspace-scoped function goes through here. It confirms the caller
 * is signed in, belongs to the workspace, and holds at least `min` role.
 */
export async function requireMember(ctx: Ctx, workspaceId: Id<"workspaces">, min: Role = "viewer") {
  const userId = await requireUser(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
    .unique();
  // Same message for "no such workspace" and "not a member" so ids can't be probed.
  if (!member) fail("Workspace not found.");
  if (!roleAtLeast(member.role, min)) fail(`This needs the ${min} role or higher.`);
  return { userId, role: member.role, member };
}

export async function logActivity(
  ctx: MutationCtx,
  entry: {
    workspaceId: Id<"workspaces">;
    userId?: Id<"users">;
    action: string;
    detail?: string;
    postId?: Id<"posts">;
    level?: "info" | "error";
  },
) {
  await ctx.db.insert("activity", {
    ...entry,
    detail: entry.detail?.slice(0, 500),
    level: entry.level ?? "info",
  });
}

export function cleanText(value: string, max: number, what: string): string {
  const text = value.trim();
  if (text.length > max) fail(`${what} is too long (max ${max} characters).`);
  return text;
}
