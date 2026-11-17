import { mutation, query } from "./_generated/server";
import { fail } from "./lib/access";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!user) return null;
    return { _id: user._id, name: user.name ?? null, email: user.email ?? null };
  },
});

/**
 * Runs once after every sign-in. Creates or refreshes the app's record of the
 * signed-in person. Name and email come from the verified Clerk token, never
 * from anything the browser sends as an argument.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("Please sign in.");
    // Only a verified email is kept, since it is used for the owner allowlist.
    const email = identity.email && identity.emailVerified ? identity.email.toLowerCase() : undefined;
    const name = (identity.name ?? identity.givenName ?? undefined)?.slice(0, 80);
    const existing = await ctx.db
      .query("users").withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!existing) return await ctx.db.insert("users", { tokenIdentifier: identity.tokenIdentifier, name, email });
    if (existing.name !== name || existing.email !== email) await ctx.db.patch(existing._id, { name, email });
    return existing._id;
  },
});
