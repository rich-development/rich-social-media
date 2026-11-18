import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { decryptSecret } from "./lib/crypto";
import { setup, signUp } from "./setup.testing";

const TZ = "America/New_York";
const APP_PASSWORD = "abcd-efgh-ijkl-mnop";

type Handler = (url: string, init?: RequestInit) => Response | undefined;
let handlers: Handler[] = [];
let calls: { url: string; init?: RequestInit }[] = [];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T15:00:00Z")); // Monday 10:00 in New York
  process.env.TOKEN_ENCRYPTION_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.SITE_URL = "https://app.example.com";
  handlers = [];
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const h of handlers) {
      const res = h(url, init);
      if (res) return res;
    }
    throw new Error(`Unexpected network call in test: ${url}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
});

const bluesky: Handler = (url) => {
  if (url.endsWith("com.atproto.server.createSession")) return json({ accessJwt: "jwt", did: "did:plc:abc", handle: "damon.bsky.social" });
  if (url.includes("app.bsky.actor.getProfile")) return json({ displayName: "Damon" });
  if (url.endsWith("com.atproto.repo.createRecord")) return json({ uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz" });
};

async function world() {
  const t = setup();
  const owner = await signUp(t, "owner@example.com");
  const workspaceId = await owner.mutation(api.workspaces.create, { name: "Brand", timezone: TZ });
  handlers.push(bluesky);
  await owner.action(api.channels.connectBlueskyAccount, { workspaceId, handle: "@damon.bsky.social", appPassword: APP_PASSWORD });
  const { channels } = await owner.query(api.channels.list, { workspaceId });
  return { t, owner, workspaceId, channelId: channels[0]._id as Id<"channels"> };
}

async function drain(t: ReturnType<typeof setup>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("channels", () => {
  test("the app password is stored encrypted and never returned to the browser", async () => {
    const { t, owner, workspaceId } = await world();
    const secrets = await t.run((ctx) => ctx.db.query("channelSecrets").collect());
    expect(secrets).toHaveLength(1);
    expect(secrets[0].accessTokenEnc).not.toContain(APP_PASSWORD);
    expect(await decryptSecret(secrets[0].accessTokenEnc)).toBe(APP_PASSWORD);
    const listing = await owner.query(api.channels.list, { workspaceId });
    expect(JSON.stringify(listing)).not.toContain(APP_PASSWORD);
    expect(JSON.stringify(listing)).not.toContain(secrets[0].accessTokenEnc);
  });

  test("OAuth callback rejects unknown, reused, and cross-provider state", async () => {
    const { t, owner, workspaceId } = await world();
    process.env.LINKEDIN_CLIENT_ID = "id";
    process.env.LINKEDIN_CLIENT_SECRET = "secret";
    handlers.push((url) => {
      if (url.includes("linkedin.com/oauth/v2/accessToken")) return json({ access_token: "li-access", expires_in: 5184000 });
      if (url.endsWith("/v2/userinfo")) return json({ sub: "abc123", name: "Damon Rich" });
    });

    const forged = await t.fetch("/oauth/callback/linkedin?code=x&state=made-up", { method: "GET" });
    expect(forged.status).toBe(302);
    expect(forged.headers.get("Location")).toMatch(/^https:\/\/app\.example\.com\/channels\?error=/);

    const authUrl = new URL(await owner.action(api.channels.startOAuth, { workspaceId, provider: "linkedin" }));
    expect(authUrl.searchParams.get("redirect_uri")).toBe("https://example.convex.site/oauth/callback/linkedin");
    const state = authUrl.searchParams.get("state")!;
    // The raw state is never stored, only its hash.
    const stored = await t.run((ctx) => ctx.db.query("oauthStates").collect());
    expect(stored[0].stateHash).not.toBe(state);

    const wrongProvider = await t.fetch(`/oauth/callback/linkedin?code=x&state=${state}`.replace("linkedin", "nope"), { method: "GET" });
    expect(wrongProvider.headers.get("Location")).toContain("error=");

    const ok = await t.fetch(`/oauth/callback/linkedin?code=good&state=${state}`, { method: "GET" });
    expect(ok.headers.get("Location")).toBe("https://app.example.com/channels?connected=1");
    const replay = await t.fetch(`/oauth/callback/linkedin?code=good&state=${state}`, { method: "GET" });
    expect(replay.headers.get("Location")).toContain("error=");

    const { channels } = await owner.query(api.channels.list, { workspaceId });
    expect(channels.map((c) => c.platform).sort()).toEqual(["bluesky", "linkedin"]);
    const secrets = await t.run((ctx) => ctx.db.query("channelSecrets").collect());
    expect(JSON.stringify(secrets)).not.toContain("li-access");
  });

  test("a network that is not configured cannot be started", async () => {
    const { owner, workspaceId } = await world();
    await expect(owner.action(api.channels.startOAuth, { workspaceId, provider: "tiktok" })).rejects.toThrow(/not set up/i);
  });
});

describe("scheduling and publishing", () => {
  test("publish now goes out and records the link", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    const { postId, status } = await owner.mutation(api.posts.save, {
      workspaceId, text: "In purpose. On purpose. #purpose https://example.com", mediaIds: [],
      targets: [{ channelId }], mode: "now",
    });
    expect(status).toBe("scheduled");
    await drain(t);
    const post = await owner.query(api.posts.get, { postId });
    expect(post?.status).toBe("published");
    expect(post?.targets[0].permalink).toBe("https://bsky.app/profile/damon.bsky.social/post/3kxyz");
    const sent = calls.find((c) => c.url.endsWith("createRecord"))!;
    const record = JSON.parse(String(sent.init?.body)).record;
    expect(record.text).toContain("In purpose");
    expect(record.facets.map((f: any) => f.features[0].$type).sort()).toEqual([
      "app.bsky.richtext.facet#link", "app.bsky.richtext.facet#tag",
    ]);
  });

  test("a scheduled post waits for its time, and rescheduling never double posts", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    const at = Date.now() + 60 * 60 * 1000;
    const { postId } = await owner.mutation(api.posts.save, {
      workspaceId, text: "Later", mediaIds: [], targets: [{ channelId }], mode: "schedule", scheduledAt: at,
    });
    await owner.mutation(api.posts.reschedule, { postId, scheduledAt: at + 60 * 60 * 1000 });
    await owner.mutation(api.posts.reschedule, { postId, scheduledAt: at + 2 * 60 * 60 * 1000 });
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(0);
    await drain(t);
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(1);
    expect((await owner.query(api.posts.get, { postId }))?.status).toBe("published");
  });

  test("a stale job does nothing", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    const { postId } = await owner.mutation(api.posts.save, {
      workspaceId, text: "Later", mediaIds: [], targets: [{ channelId }], mode: "schedule", scheduledAt: Date.now() + 3600_000,
    });
    const target = (await t.run((ctx) => ctx.db.query("postTargets").collect()))[0];
    await t.action(internal.publisher.publishTarget, { targetId: target._id, runToken: "old-token" });
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(0);
    expect((await owner.query(api.posts.get, { postId }))?.status).toBe("scheduled");
  });

  test("unscheduling and deleting cancel the send", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    const input = { workspaceId, text: "Later", mediaIds: [], targets: [{ channelId }], mode: "schedule" as const, scheduledAt: Date.now() + 3600_000 };
    const a = await owner.mutation(api.posts.save, input);
    const b = await owner.mutation(api.posts.save, input);
    await owner.mutation(api.posts.unschedule, { postId: a.postId });
    await owner.mutation(api.posts.remove, { postId: b.postId });
    await drain(t);
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(0);
    expect((await owner.query(api.posts.get, { postId: a.postId }))?.status).toBe("draft");
  });

  test("temporary failures retry with backoff, then succeed", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    let attempts = 0;
    handlers.unshift((url) => {
      if (url.endsWith("createRecord") && attempts++ < 2) return json({ error: "UpstreamFailure" }, 503);
    });
    const { postId } = await owner.mutation(api.posts.save, { workspaceId, text: "Retry me", mediaIds: [], targets: [{ channelId }], mode: "now" });
    await drain(t);
    expect(attempts).toBe(3);
    expect((await owner.query(api.posts.get, { postId }))?.status).toBe("published");
  });

  test("it gives up after three tries and can be retried by hand", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    let down = true;
    handlers.unshift((url) => (url.endsWith("createRecord") && down ? json({ error: "UpstreamFailure" }, 503) : undefined));
    const { postId } = await owner.mutation(api.posts.save, { workspaceId, text: "Down", mediaIds: [], targets: [{ channelId }], mode: "now" });
    await drain(t);
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(3);
    let post = await owner.query(api.posts.get, { postId });
    expect(post?.status).toBe("failed");
    expect(post?.targets[0].lastError).toMatch(/503/);
    down = false;
    await owner.mutation(api.posts.retry, { postId });
    await drain(t);
    post = await owner.query(api.posts.get, { postId });
    expect(post?.status).toBe("published");
  });

  test("a rejected login flags the channel and does not retry", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    handlers.unshift((url) => (url.endsWith("createSession") ? json({ error: "AuthenticationRequired" }, 401) : undefined));
    const { postId } = await owner.mutation(api.posts.save, { workspaceId, text: "Nope", mediaIds: [], targets: [{ channelId }], mode: "now" });
    await drain(t);
    expect((await owner.query(api.posts.get, { postId }))?.status).toBe("failed");
    const { channels } = await owner.query(api.channels.list, { workspaceId });
    expect(channels[0].status).toBe("needs_reauth");
    await expect(
      owner.mutation(api.posts.save, { workspaceId, text: "Again", mediaIds: [], targets: [{ channelId }], mode: "now" }),
    ).rejects.toThrow(/reconnected/i);
  });

  test("network rules block a bad post before it is scheduled", async () => {
    const { owner, workspaceId, channelId } = await world();
    await expect(
      owner.mutation(api.posts.save, { workspaceId, text: "x".repeat(301), mediaIds: [], targets: [{ channelId }], mode: "now" }),
    ).rejects.toThrow(/over the 300 limit/);
    await expect(
      owner.mutation(api.posts.save, { workspaceId, text: "hi", mediaIds: [], targets: [], mode: "now" }),
    ).rejects.toThrow(/at least one channel/i);
    await expect(
      owner.mutation(api.posts.save, { workspaceId, text: "hi", mediaIds: [], targets: [{ channelId }], mode: "schedule", scheduledAt: Date.now() - 3600_000 }),
    ).rejects.toThrow(/future/i);
  });

  test("the queue fills the next open slots in the workspace time zone", async () => {
    const { owner, workspaceId, channelId } = await world();
    // Default slots are weekdays 09:00, 12:30, 18:00. It is Monday 10:00 in New York.
    const save = () => owner.mutation(api.posts.save, { workspaceId, text: "Queued", mediaIds: [], targets: [{ channelId }], mode: "queue" });
    const first = await owner.query(api.posts.get, { postId: (await save()).postId });
    const second = await owner.query(api.posts.get, { postId: (await save()).postId });
    const third = await owner.query(api.posts.get, { postId: (await save()).postId });
    expect(new Date(first!.scheduledAt!).toISOString()).toBe("2026-11-16T17:30:00.000Z"); // Mon 12:30 ET
    expect(new Date(second!.scheduledAt!).toISOString()).toBe("2026-11-16T23:00:00.000Z"); // Mon 18:00 ET
    expect(new Date(third!.scheduledAt!).toISOString()).toBe("2026-11-17T14:00:00.000Z"); // Tue 09:00 ET
  });

  test("approval: an editor's post waits, then goes out once an admin approves", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    await owner.mutation(api.workspaces.update, { workspaceId, requireApproval: true });
    const { token } = await owner.action(api.workspaces.createInvite, { workspaceId, role: "editor" });
    const editor = await signUp(t, "editor@example.com");
    await editor.action(api.workspaces.acceptInvite, { token });

    const { postId, status } = await editor.mutation(api.posts.save, { workspaceId, text: "Please review", mediaIds: [], targets: [{ channelId }], mode: "now" });
    expect(status).toBe("pending_approval");
    await drain(t);
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(0);

    await owner.mutation(api.posts.reject, { postId, reason: "Tighten the hook." });
    let post = await owner.query(api.posts.get, { postId });
    expect(post?.status).toBe("draft");
    expect(post?.rejectionReason).toBe("Tighten the hook.");

    await editor.mutation(api.posts.save, { workspaceId, postId, text: "Tighter hook", mediaIds: [], targets: [{ channelId }], mode: "now" });
    await owner.mutation(api.posts.approve, { postId });
    await drain(t);
    post = await owner.query(api.posts.get, { postId });
    expect(post?.status).toBe("published");
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(1);
  });

  test("disconnecting a channel stops what was waiting on it and wipes its secret", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    const { postId } = await owner.mutation(api.posts.save, {
      workspaceId, text: "Later", mediaIds: [], targets: [{ channelId }], mode: "schedule", scheduledAt: Date.now() + 3600_000,
    });
    await owner.mutation(api.channels.disconnect, { channelId });
    await drain(t);
    expect(calls.filter((c) => c.url.endsWith("createRecord"))).toHaveLength(0);
    expect((await owner.query(api.posts.get, { postId }))?.status).toBe("failed");
    expect(await t.run((ctx) => ctx.db.query("channelSecrets").collect())).toHaveLength(0);
  });

  test("a large image goes to Bluesky as its shrunk copy, and is blocked without one", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    handlers.unshift((url) => (url.endsWith("uploadBlob") ? json({ blob: { $type: "blob", ref: { $link: "cid" } } }) : undefined));
    const store = (bytes: number, type: string) => t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })));

    // No smaller copy: caught before scheduling, with a clear next step.
    const bare = await owner.mutation(api.media.save, { workspaceId, storageId: await store(2_600_000, "image/jpeg"), name: "big.jpg" });
    await expect(
      owner.mutation(api.posts.save, { workspaceId, text: "pic", mediaIds: [bare], targets: [{ channelId }], mode: "now" }),
    ).rejects.toThrow(/upload it again/i);

    // With a smaller copy: the copy is what Bluesky receives.
    const mediaId = await owner.mutation(api.media.save, {
      workspaceId, storageId: await store(2_600_000, "image/jpeg"), name: "big.jpg",
      compactStorageId: await store(900_000, "image/jpeg"),
    });
    const { postId } = await owner.mutation(api.posts.save, { workspaceId, text: "pic", mediaIds: [mediaId], targets: [{ channelId }], mode: "now" });
    await drain(t);
    expect((await owner.query(api.posts.get, { postId }))?.status).toBe("published");
    const upload = calls.find((c) => c.url.endsWith("uploadBlob"))!;
    expect((upload.init?.body as Blob).size).toBe(900_000);

    // A "smaller copy" that is not actually small or not a JPEG is thrown away.
    const bogus = await owner.mutation(api.media.save, {
      workspaceId, storageId: await store(2_600_000, "image/jpeg"), name: "big.jpg",
      compactStorageId: await store(2_400_000, "image/jpeg"),
    });
    const listed = await owner.query(api.media.list, { workspaceId });
    expect(listed.find((m) => m._id === bogus)?.compactSize).toBeUndefined();
    expect(listed.find((m) => m._id === mediaId)?.compactSize).toBe(900_000);
  });

  test("activity gets one line per published post, and people are shown by name", async () => {
    const { t, owner, workspaceId, channelId } = await world();
    const { postId } = await owner.mutation(api.posts.save, { workspaceId, text: "Hello", mediaIds: [], targets: [{ channelId }], mode: "now" });
    await owner.mutation(api.posts.save, { workspaceId, text: "Just a draft", mediaIds: [], targets: [], mode: "draft" });
    await drain(t);
    const { items } = await owner.query(api.workspaces.activity, { workspaceId, limit: 50 });
    expect(items.filter((a) => a.action === "Published")).toHaveLength(1);
    expect(items.find((a) => a.action === "Published")?.detail).toBe("1 of 1 channel: Damon");
    expect(items.some((a) => a.action === "Draft saved")).toBe(false);
    expect(items.find((a) => a.action === "Publishing now")?.who).toBe("owner");
    expect((await owner.query(api.posts.get, { postId }))?.authorName).toBe("owner");
    // Problems filter shows only failures.
    expect((await owner.query(api.workspaces.activity, { workspaceId, level: "error" })).items).toHaveLength(0);

    // A token with no name or email falls back to what the browser reports, for display only.
    const bare = t.withIdentity({ issuer: "https://test.clerk.accounts.dev", subject: "bare", tokenIdentifier: "https://test.clerk.accounts.dev|bare" });
    await bare.mutation(api.users.store, { displayName: "Damon Rich", displayEmail: "Someone@Example.com" });
    expect(await bare.query(api.users.me, {})).toMatchObject({ name: "Damon Rich", email: "someone@example.com" });
    const row = (await t.run((ctx) => ctx.db.query("users").collect())).find((u) => u.displayName === "Damon Rich")!;
    expect(row.email).toBeUndefined(); // never promoted to the verified field
  });

  test("bulk import queues every row", async () => {
    const { owner, workspaceId, channelId } = await world();
    const created = await owner.mutation(api.posts.bulkCreate, {
      workspaceId, channelIds: [channelId], mode: "queue", rows: [{ text: "One" }, { text: "Two" }, { text: "  " }, { text: "Three" }],
    });
    expect(created).toBe(3);
    const scheduled = await owner.query(api.posts.list, { workspaceId, status: "scheduled" });
    expect(new Set(scheduled.map((p) => p.scheduledAt)).size).toBe(3);
  });
});
