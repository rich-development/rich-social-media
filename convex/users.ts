import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { components } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { cleanText, requireUser } from "./lib/access";

/** Called by the auth component once per new account. */
export const createUser = internalMutation({
  args: { method: v.object({ name: v.literal("usernamePassword"), profile: v.any() }) },
  returns: v.id("users"),
  handler: async (ctx) => {
    return await ctx.db.insert("users", {});
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return { _id: user._id, name: user.name ?? null, email: user.email ?? null };
  },
});

/**
 * Runs right after sign-up/sign-in. The email is read from the auth
 * component on the server, never taken from the client.
 */
export const syncProfile = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const patch: { name?: string; email?: string } = {};
    if (!user.email) {
      const username = await ctx.runQuery(components.authUsername.public.getUsername, { userId });
      if (username) patch.email = username.toLowerCase();
    }
    if (name !== undefined) {
      const clean = cleanText(name, 80, "Name");
      if (clean) patch.name = clean;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(userId, patch);
    return null;
  },
});
