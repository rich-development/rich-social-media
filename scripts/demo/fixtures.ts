// Sample data for demo mode. Nothing here is real.
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const ws = {
  _id: "ws1", _creationTime: now - 30 * DAY, name: "Rich Coaching and Consulting", timezone: "America/New_York",
  requireApproval: true, createdBy: "u1", role: "owner",
  queueSlots: [{ days: [1, 2, 3, 4, 5], time: "09:00" }, { days: [1, 2, 3, 4, 5], time: "12:30" }, { days: [0, 6], time: "10:00" }],
};
const art = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="290" cy="120" r="60" fill="#fff" opacity=".25"/></svg>`)}`;
const media = [
  { _id: "m1", kind: "image", name: "keynote-stage.jpg", size: 840_000, alt: "Speaker on stage", contentType: "image/jpeg", url: art("#15120f", "#b07a14"), createdAt: now - DAY },
  { _id: "m2", kind: "image", name: "quote-card.png", size: 320_000, alt: "", contentType: "image/png", url: art("#b07a14", "#f6ead0"), createdAt: now - 2 * DAY },
  { _id: "m3", kind: "image", name: "workshop.jpg", size: 1_400_000, alt: "", contentType: "image/jpeg", url: art("#2a2520", "#736a5e"), createdAt: now - 3 * DAY },
];
const ch = (id: string, platform: string, displayName: string, handle: string, status = "active") => ({
  _id: id, _creationTime: now, workspaceId: "ws1", platform, externalId: id, displayName, handle, status, connectedBy: "u1",
  statusDetail: status === "needs_reauth" ? "The network rejected the saved access. Reconnect." : undefined,
});
const channels = [
  ch("c1", "instagram", "richcoaching", "richcoaching"), ch("c2", "facebook", "Rich Coaching and Consulting", ""),
  ch("c3", "threads", "richcoaching", "richcoaching"), ch("c4", "linkedin", "Sample Owner", "", "needs_reauth"),
  ch("c5", "bluesky", "Rich Coaching", "richcoaching.bsky.social"),
];
const target = (c: (typeof channels)[number], status: string, extra = {}) => ({
  _id: `t-${c._id}-${Math.random()}`, channelId: c._id, platform: c.platform, text: null, firstComment: null, options: null,
  status, lastError: null, permalink: null, publishedAt: null, channelName: c.displayName, avatarUrl: null, ...extra,
});
const post = (id: string, status: string, text: string, offset: number, chans: number[], extra: Record<string, unknown> = {}) => ({
  _id: id, _creationTime: now - DAY, workspaceId: "ws1", authorId: "u1", status, text, mediaIds: [], scheduledAt: now + offset,
  queued: true, updatedAt: now, authorName: "Sample Owner", media: [] as typeof media,
  targets: chans.map((i) => target(channels[i], status === "published" ? "published" : "pending")), ...extra,
});
const posts = [
  post("p1", "scheduled", "Vendors do what you inspect, not what you expect. Three questions to ask before your next contract review.\n\n#leadership #vendormanagement #publicsector", 3 * HOUR, [0, 1, 2], { media: [media[0]], mediaIds: ["m1"] }),
  post("p2", "scheduled", "In purpose. On purpose. What is one decision this week you made on purpose?", DAY + 2 * HOUR, [2, 4]),
  post("p3", "scheduled", "Coaching is not advice. It is a mirror with good questions.", 2 * DAY, [0, 1], { media: [media[1]], mediaIds: ["m2"], label: "Coaching series" }),
  post("p4", "pending_approval", "Registration is open for the spring leadership intensive. Seats are limited.", 3 * DAY, [0, 1, 2, 4], { authorName: "Sample Editor" }),
  post("p5", "draft", "Draft: the difference between a requirement and a preference in a procurement.", 5 * DAY, [1], { rejectionReason: "Tighten the hook." }),
  post("p6", "published", "Strategies that build. Coaching that transforms.", -DAY, [0, 2], { publishedAt: now - DAY }),
  post("p7", "partial", "Five signs your contact center metrics are lying to you.", -2 * DAY, [1, 3], {}),
  post("p8", "scheduled", "Friday reflection: who did you develop this week?", 4 * DAY + 5 * HOUR, [0, 2, 4]),
];
posts[6].targets[0].status = "published";
Object.assign(posts[6].targets[1], { status: "failed", lastError: "LinkedIn post failed (401): token expired" });
posts[5].targets.forEach((t) => Object.assign(t, { permalink: "https://example.com/post" }));

const perDay = Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * DAY).toISOString().slice(0, 10), count: [0, 2, 3, 1, 4, 2, 0][i % 7] + (i > 20 ? 1 : 0) }));

export const FIXTURES: Record<string, any> = {
  "users:me": { _id: "u1", name: "Sample Owner", email: "owner@example.com" },
  "workspaces:list": { workspaces: [ws, { ...ws, _id: "ws2", name: "FORGED" }], canCreate: true },
  "workspaces:members": {
    myRole: "owner",
    members: [
      { _id: "mem1", userId: "u1", role: "owner", name: "Sample Owner", email: "owner@example.com", isMe: true },
      { _id: "mem2", userId: "u2", role: "editor", name: "Sample Editor", email: "editor@example.com", isMe: false },
    ],
  },
  "workspaces:invites": [{ _id: "i1", role: "viewer", note: null, expiresAt: now + 5 * DAY }],
  "workspaces:activity": { hasMore: false, items: [
    { _id: "a1", at: now - HOUR, action: "Post scheduled", detail: null, level: "info", who: "Sample Owner", postId: "p1" },
    { _id: "a2", at: now - 5 * HOUR, action: "Publishing failed", detail: "LinkedIn: Sample Owner. LinkedIn post failed (401): token expired", level: "error", who: null, postId: "p7" },
    { _id: "a3", at: now - DAY, action: "Published", detail: "2 of 2 channels: richcoaching, Rich Coaching", level: "info", who: null, postId: "p6" },
    { _id: "a4", at: now - 2 * DAY, action: "Sent for approval", detail: null, level: "info", who: "Sample Editor", postId: "p4" },
  ] },

  "channels:list": {
    channels,
    providers: ["meta", "threads", "linkedin", "google", "tiktok", "pinterest", "bluesky", "x"].map((id) => ({
      id, configured: ["meta", "threads", "linkedin", "bluesky"].includes(id),
      redirectUri: `https://your-deployment.convex.site/oauth/callback/${id}`, envVars: [`${id.toUpperCase()}_CLIENT_ID`, `${id.toUpperCase()}_CLIENT_SECRET`],
    })),
  },
  "posts:counts": { draft: 1, pending_approval: 1, scheduled: 4, failed: 1 },
  "posts:list": (args: { status?: string }) => posts.filter((p) => !args.status || p.status === args.status).sort((a, b) => a.scheduledAt - b.scheduledAt),
  "posts:calendar": posts,
  "posts:get": (args: { postId: string }) => posts.find((p) => p._id === args.postId) ?? null,
  "posts:upcomingSlots": [now + 20 * HOUR, now + 24 * HOUR, now + 44 * HOUR],
  "media:list": media,
  "library:list": {
    hashtagSets: [
      { _id: "h1", name: "Leadership", tags: "#leadership #coaching #purpose #executivecoaching" },
      { _id: "h2", name: "Vendor accountability", tags: "#vendormanagement #procurement #publicsector #medicaid" },
    ],
    templates: [{ _id: "tp1", name: "Friday reflection", text: "Friday reflection:\n\n[question]\n\nDrop your answer below." }],
  },
  "analytics:overview": {
    days: 30, published: 52, failed: 3, upcoming: 11, successRate: 95,
    perPlatform: [{ platform: "instagram", published: 18, failed: 0 }, { platform: "facebook", published: 14, failed: 1 }, { platform: "threads", published: 12, failed: 0 }, { platform: "linkedin", published: 8, failed: 2 }],
    perDay, perHour: Array.from({ length: 24 }, (_, h) => (h === 9 ? 20 : h === 12 ? 16 : h === 18 ? 9 : h === 10 ? 7 : 0)),
    perChannel: channels.map((c, i) => ({ channelId: c._id, name: c.displayName, platform: c.platform, published: [18, 14, 12, 8, 0][i], failed: [0, 1, 0, 2, 0][i] })),
    recentFailures: [{ postId: "p7", platform: "linkedin", error: "LinkedIn post failed (401): token expired" }],
  },
};
