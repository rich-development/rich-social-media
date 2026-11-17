import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { cleanText, fail, requireMember } from "./lib/access";
import { BLUESKY_IMAGE_MAX } from "./shared/platforms";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_VIDEO = 250 * 1024 * 1024;

export const generateUploadUrl = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId, "editor");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Registers an uploaded file. Type and size come from storage, not the client. */
export const save = mutation({
  args: {
    workspaceId: v.id("workspaces"), storageId: v.id("_storage"), name: v.string(),
    /** Optional smaller JPEG copy of an image, made by the browser. */
    compactStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { workspaceId, storageId, name, compactStorageId }) => {
    const { userId } = await requireMember(ctx, workspaceId, "editor");
    const file = await ctx.db.system.get(storageId);
    if (!file) fail("Upload not found.");
    // A storage id may only be registered once, so one workspace cannot claim another's file.
    const claimed = await ctx.db.query("media").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first();
    if (claimed) fail("That file is already in a library.");
    const type = file.contentType ?? "";
    const kind = IMAGE_TYPES.includes(type) ? "image" : VIDEO_TYPES.includes(type) ? "video" : null;
    const tooBig = kind === "image" ? file.size > MAX_IMAGE : file.size > MAX_VIDEO;
    if (!kind || tooBig) {
      await ctx.storage.delete(storageId);
      if (compactStorageId) await ctx.storage.delete(compactStorageId);
      fail(!kind ? "Use a JPG, PNG, WebP, GIF, MP4, MOV, or WebM file." : kind === "image" ? "Images can be up to 15 MB." : "Videos can be up to 250 MB.");
    }
    // The smaller copy is checked the same way: real type and size from storage.
    let compact;
    if (compactStorageId && compactStorageId !== storageId) {
      const small = await ctx.db.system.get(compactStorageId);
      const ok = small && kind === "image" && small.contentType === "image/jpeg" && small.size <= BLUESKY_IMAGE_MAX && small.size < file.size;
      if (ok) compact = { storageId: compactStorageId, size: small.size, contentType: "image/jpeg" };
      else if (small) await ctx.storage.delete(compactStorageId);
    }
    return await ctx.db.insert("media", {
      workspaceId, storageId, kind, contentType: type, size: file.size, compact,
      name: cleanText(name, 200, "File name") || "Untitled", uploadedBy: userId,
    });
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const rows = await ctx.db.query("media").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order("desc").take(300);
    const out = [];
    for (const m of rows) {
      out.push({
        _id: m._id, kind: m.kind, name: m.name, size: m.size, compactSize: m.compact?.size, alt: m.alt ?? "",
        contentType: m.contentType, url: await ctx.storage.getUrl(m.storageId), createdAt: m._creationTime,
      });
    }
    return out;
  },
});

export const setAlt = mutation({
  args: { mediaId: v.id("media"), alt: v.string() },
  handler: async (ctx, { mediaId, alt }) => {
    const m = await ctx.db.get(mediaId);
    if (!m) fail("File not found.");
    await requireMember(ctx, m.workspaceId, "editor");
    await ctx.db.patch(mediaId, { alt: cleanText(alt, 1000, "Alt text") });
  },
});

export const remove = mutation({
  args: { mediaId: v.id("media") },
  handler: async (ctx, { mediaId }) => {
    const m = await ctx.db.get(mediaId);
    if (!m) return;
    await requireMember(ctx, m.workspaceId, "editor");
    for (const status of ["draft", "pending_approval", "scheduled", "publishing"] as const) {
      const posts = await ctx.db
        .query("posts").withIndex("by_workspace_status", (q) => q.eq("workspaceId", m.workspaceId).eq("status", status))
        .collect();
      if (posts.some((p) => p.mediaIds.includes(mediaId))) fail("This file is used by a post that has not gone out yet.");
    }
    await ctx.storage.delete(m.storageId);
    if (m.compact) await ctx.storage.delete(m.compact.storageId);
    await ctx.db.delete(mediaId);
  },
});
