import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { cleanText, fail, requireMember } from "./lib/access";

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const hashtagSets = await ctx.db.query("hashtagSets").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    const templates = await ctx.db.query("templates").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    return { hashtagSets, templates };
  },
});

/** Turns "faith, #men  purpose" into "#faith #men #purpose" (one paragraph). */
function normalizeTags(raw: string): string {
  const tags = raw
    .split(/[\s,]+/).map((t) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean);
  return [...new Set(tags)].map((t) => `#${t}`).join(" ");
}

export const saveHashtagSet = mutation({
  args: { workspaceId: v.id("workspaces"), id: v.optional(v.id("hashtagSets")), name: v.string(), tags: v.string() },
  handler: async (ctx, { workspaceId, id, name, tags }) => {
    await requireMember(ctx, workspaceId, "editor");
    const doc = { name: cleanText(name, 60, "Name"), tags: normalizeTags(cleanText(tags, 2000, "Hashtags")) };
    if (!doc.name || !doc.tags) fail("Add a name and at least one hashtag.");
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.workspaceId !== workspaceId) fail("Not found.");
      await ctx.db.patch(id, doc);
    } else {
      await ctx.db.insert("hashtagSets", { workspaceId, ...doc });
    }
  },
});

export const removeHashtagSet = mutation({
  args: { id: v.id("hashtagSets") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) return;
    await requireMember(ctx, doc.workspaceId, "editor");
    await ctx.db.delete(id);
  },
});

export const saveTemplate = mutation({
  args: { workspaceId: v.id("workspaces"), id: v.optional(v.id("templates")), name: v.string(), text: v.string() },
  handler: async (ctx, { workspaceId, id, name, text }) => {
    await requireMember(ctx, workspaceId, "editor");
    const doc = { name: cleanText(name, 60, "Name"), text: cleanText(text, 10000, "Template") };
    if (!doc.name || !doc.text) fail("Add a name and some text.");
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.workspaceId !== workspaceId) fail("Not found.");
      await ctx.db.patch(id, doc);
    } else {
      await ctx.db.insert("templates", { workspaceId, ...doc });
    }
  },
});

export const removeTemplate = mutation({
  args: { id: v.id("templates") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) return;
    await requireMember(ctx, doc.workspaceId, "editor");
    await ctx.db.delete(id);
  },
});
