import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fail, userEmail, userName } from "./lib/access";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!user) return null;
    return { _id: user._id, name: userName(user), email: userEmail(user) };
  },
});

/**
 * Runs once after every sign-in. Creates or refreshes the app's record of the
 * signed-in person.
 *
 * `name` and `email` come from the verified Clerk token when it carries them.
 * The display fields are what the browser reports from Clerk. They only label
 * things on screen ("by Damon") and are never used to decide access.
 */
export const store = mutation({
  args: { displayName: v.optional(v.string()), displayEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("Please sign in.");
    const fields = {
      // Only a verified email is kept here, since it backs the owner allowlist.
      email: identity.email && identity.emailVerified ? identity.email.toLowerCase() : undefined,
      name: (identity.name ?? identity.givenName ?? undefined)?.slice(0, 80),
      displayName: args.displayName?.trim().slice(0, 80) || undefined,
      displayEmail: args.displayEmail?.trim().toLowerCase().slice(0, 200) || undefined,
    };
    const existing = await ctx.db
      .query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!existing) return await ctx.db.insert("users", { tokenIdentifier: identity.tokenIdentifier, ...fields });
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).some((k) => existing[k] !== fields[k]);
    if (changed) await ctx.db.patch(existing._id, fields);
    return existing._id;
  },
});
