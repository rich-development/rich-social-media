import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vPlatform = v.union(
  v.literal("facebook"), v.literal("instagram"), v.literal("threads"),
  v.literal("linkedin"), v.literal("youtube"), v.literal("tiktok"),
  v.literal("pinterest"), v.literal("bluesky"), v.literal("x"),
);
export const vRole = v.union(
  v.literal("owner"), v.literal("admin"), v.literal("editor"), v.literal("viewer"),
);
export const vPostStatus = v.union(
  v.literal("draft"),
  v.literal("pending_approval"),
  v.literal("scheduled"),
  v.literal("publishing"),
  v.literal("published"),
  v.literal("partial"), // some channels succeeded, some failed
  v.literal("failed"),
);
export const vTargetStatus = v.union(
  v.literal("pending"),
  v.literal("publishing"),
  v.literal("published"),
  v.literal("failed"),
);
/** Per-network extras, e.g. YouTube title or Pinterest board. */
export const vTargetOptions = v.object({
  title: v.optional(v.string()),
  link: v.optional(v.string()),
  boardId: v.optional(v.string()),
  privacy: v.optional(v.union(v.literal("public"), v.literal("unlisted"), v.literal("private"))),
});
export const vQueueSlot = v.object({
  /** 0 = Sunday ... 6 = Saturday */
  days: v.array(v.number()),
  /** "HH:MM" in the workspace time zone */
  time: v.string(),
});

export default defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    /** Copied from the auth component (the sign-in username). */
    email: v.optional(v.string()),
  }).index("by_email", ["email"]),

  workspaces: defineTable({
    name: v.string(),
    timezone: v.string(),
    requireApproval: v.boolean(),
    queueSlots: v.array(vQueueSlot),
    createdBy: v.id("users"),
  }),

  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: vRole,
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  invites: defineTable({
    workspaceId: v.id("workspaces"),
    role: vRole,
    /** SHA-256 of the invite token. The token itself is never stored. */
    tokenHash: v.string(),
    note: v.optional(v.string()),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedBy: v.optional(v.id("users")),
  })
    .index("by_token", ["tokenHash"])
    .index("by_workspace", ["workspaceId"]),

  channels: defineTable({
    workspaceId: v.id("workspaces"),
    platform: vPlatform,
    externalId: v.string(),
    displayName: v.string(),
    handle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("needs_reauth"), v.literal("paused")),
    statusDetail: v.optional(v.string()),
    connectedBy: v.id("users"),
    /** Non-secret extras, e.g. Pinterest boards. */
    boards: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_platform_external", ["workspaceId", "platform", "externalId"]),

  // Tokens live in their own table so no channel query can leak them by
  // accident. Values are AES-256-GCM encrypted. Only internal functions
  // read this table.
  channelSecrets: defineTable({
    channelId: v.id("channels"),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  }).index("by_channel", ["channelId"]),

  oauthStates: defineTable({
    /** SHA-256 of the state value sent to the network. */
    stateHash: v.string(),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: v.string(),
    codeVerifier: v.optional(v.string()),
    expiresAt: v.number(),
  }).index("by_state", ["stateHash"]),

  media: defineTable({
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("image"), v.literal("video")),
    contentType: v.string(),
    size: v.number(),
    name: v.string(),
    alt: v.optional(v.string()),
    uploadedBy: v.id("users"),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_storage", ["storageId"]),

  posts: defineTable({
    workspaceId: v.id("workspaces"),
    authorId: v.id("users"),
    status: vPostStatus,
    text: v.string(),
    mediaIds: v.array(v.id("media")),
    scheduledAt: v.optional(v.number()),
    /** True when the time came from the queue rather than a hand-picked time. */
    queued: v.optional(v.boolean()),
    label: v.optional(v.string()),
    notes: v.optional(v.string()),
    approvedBy: v.optional(v.id("users")),
    rejectionReason: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_scheduled", ["workspaceId", "scheduledAt"])
    .index("by_workspace_updated", ["workspaceId", "updatedAt"]),

  postTargets: defineTable({
    postId: v.id("posts"),
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    platform: vPlatform,
    /** Caption override for this channel. Falls back to the post text. */
    text: v.optional(v.string()),
    firstComment: v.optional(v.string()),
    options: v.optional(vTargetOptions),
    status: vTargetStatus,
    scheduledFnId: v.optional(v.id("_scheduled_functions")),
    /** Bumped on every (re)schedule so a stale job can tell it was replaced. */
    runToken: v.optional(v.string()),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    externalPostId: v.optional(v.string()),
    permalink: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    publishStartedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId"])
    .index("by_channel", ["channelId"])
    .index("by_status", ["status"])
    .index("by_workspace_status", ["workspaceId", "status"]),

  hashtagSets: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    tags: v.string(),
  }).index("by_workspace", ["workspaceId"]),

  templates: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    text: v.string(),
  }).index("by_workspace", ["workspaceId"]),

  activity: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.id("users")),
    action: v.string(),
    detail: v.optional(v.string()),
    postId: v.optional(v.id("posts")),
    level: v.union(v.literal("info"), v.literal("error")),
  }).index("by_workspace", ["workspaceId"]),
});
