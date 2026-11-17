import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { setup, signUp } from "./setup.testing";

const TZ = "America/New_York";

async function world() {
  const t = setup();
  const owner = await signUp(t, "owner@example.com");
  const workspaceId = await owner.mutation(api.workspaces.create, { name: "Brand", timezone: TZ });
  return { t, owner, workspaceId };
}

async function join(w: Awaited<ReturnType<typeof world>>, email: string, role: "admin" | "editor" | "viewer") {
  const { token } = await w.owner.action(api.workspaces.createInvite, { workspaceId: w.workspaceId, role });
  const user = await signUp(w.t, email);
  await user.action(api.workspaces.acceptInvite, { token });
  return user;
}

describe("accounts and workspaces", () => {
  test("signed-out callers get nothing", async () => {
    const { t, workspaceId } = await world();
    await expect(t.query(api.workspaces.list, {})).rejects.toThrow(/sign in/i);
    await expect(t.query(api.posts.list, { workspaceId })).rejects.toThrow(/sign in/i);
    await expect(t.query(api.channels.list, { workspaceId })).rejects.toThrow(/sign in/i);
    expect(await t.query(api.users.me, {})).toBeNull();
  });

  test("email comes from the verified sign-in token", async () => {
    const { owner } = await world();
    expect((await owner.query(api.users.me, {}))?.email).toBe("owner@example.com");
  });

  test("signed in with Clerk but not yet registered here still gets nothing", async () => {
    const { t, workspaceId } = await world();
    const ghost = t.withIdentity({ issuer: "https://test.clerk.accounts.dev", subject: "ghost", tokenIdentifier: "https://test.clerk.accounts.dev|ghost" });
    await expect(ghost.query(api.posts.list, { workspaceId })).rejects.toThrow(/sign in/i);
    expect(await ghost.query(api.users.me, {})).toBeNull();
  });

  test("the owner allowlist only honors a verified email", async () => {
    const t = setup();
    process.env.OWNER_EMAILS = "boss@example.com";
    try {
      const faker = await signUp(t, "boss@example.com", { verified: false });
      await expect(faker.mutation(api.workspaces.create, { name: "Mine", timezone: TZ })).rejects.toThrow(/invite/i);
      const other = await signUp(t, "other@example.com");
      await expect(other.mutation(api.workspaces.create, { name: "Mine", timezone: TZ })).rejects.toThrow(/invite/i);
    } finally {
      delete process.env.OWNER_EMAILS;
    }
    const t2 = setup();
    process.env.OWNER_EMAILS = "boss@example.com";
    try {
      const boss = await signUp(t2, "boss@example.com");
      await boss.mutation(api.workspaces.create, { name: "Mine", timezone: TZ });
    } finally {
      delete process.env.OWNER_EMAILS;
    }
  });

  test("a second account cannot create a workspace or see the first one", async () => {
    const { t, workspaceId } = await world();
    const stranger = await signUp(t, "stranger@example.com");
    const listing = await stranger.query(api.workspaces.list, {});
    expect(listing.workspaces).toHaveLength(0);
    expect(listing.canCreate).toBe(false);
    await expect(stranger.mutation(api.workspaces.create, { name: "Mine", timezone: TZ })).rejects.toThrow(/invite/i);
    await expect(stranger.query(api.posts.list, { workspaceId })).rejects.toThrow(/not found/i);
    await expect(stranger.query(api.media.list, { workspaceId })).rejects.toThrow(/not found/i);
    await expect(stranger.mutation(api.media.generateUploadUrl, { workspaceId })).rejects.toThrow(/not found/i);
    await expect(stranger.action(api.channels.startOAuth, { workspaceId, provider: "linkedin" })).rejects.toThrow(/not found/i);
    await expect(
      stranger.mutation(api.posts.save, { workspaceId, text: "hi", mediaIds: [], targets: [], mode: "draft" }),
    ).rejects.toThrow(/not found/i);
  });

  test("an owner can create more workspaces", async () => {
    const { owner } = await world();
    await owner.mutation(api.workspaces.create, { name: "Second brand", timezone: TZ });
    expect((await owner.query(api.workspaces.list, {})).workspaces).toHaveLength(2);
  });

  test("invite links work once and expire", async () => {
    const w = await world();
    const { token } = await w.owner.action(api.workspaces.createInvite, { workspaceId: w.workspaceId, role: "editor" });
    const a = await signUp(w.t, "a@example.com");
    const b = await signUp(w.t, "b@example.com");
    await expect(a.action(api.workspaces.acceptInvite, { token: "wrong-token" })).rejects.toThrow(/not valid/i);
    await a.action(api.workspaces.acceptInvite, { token });
    await expect(b.action(api.workspaces.acceptInvite, { token })).rejects.toThrow(/not valid/i);
    const { members } = await w.owner.query(api.workspaces.members, { workspaceId: w.workspaceId });
    expect(members.map((m) => m.role).sort()).toEqual(["editor", "owner"]);
    // The stored invite holds a hash, never the token.
    const rows = await w.t.run((ctx) => ctx.db.query("invites").collect());
    expect(rows[0].tokenHash).not.toContain(token);
  });

  test("roles are enforced", async () => {
    const w = await world();
    const viewer = await join(w, "viewer@example.com", "viewer");
    const editor = await join(w, "editor@example.com", "editor");
    const draft = { workspaceId: w.workspaceId, text: "hello", mediaIds: [], targets: [], mode: "draft" as const };

    await expect(viewer.mutation(api.posts.save, draft)).rejects.toThrow(/editor role/i);
    await expect(viewer.query(api.posts.list, { workspaceId: w.workspaceId })).resolves.toEqual([]);
    const { postId } = await editor.mutation(api.posts.save, draft);

    await expect(editor.mutation(api.workspaces.update, { workspaceId: w.workspaceId, requireApproval: true })).rejects.toThrow(/admin role/i);
    await expect(editor.action(api.workspaces.createInvite, { workspaceId: w.workspaceId, role: "editor" })).rejects.toThrow(/admin role/i);
    await expect(editor.query(api.workspaces.invites, { workspaceId: w.workspaceId })).rejects.toThrow(/admin role/i);
    await expect(editor.action(api.channels.connectBlueskyAccount, { workspaceId: w.workspaceId, handle: "x.bsky.social", appPassword: "p" })).rejects.toThrow(/admin role/i);
    await expect(editor.mutation(api.posts.approve, { postId })).rejects.toThrow(/admin role/i);

    const { members } = await w.owner.query(api.workspaces.members, { workspaceId: w.workspaceId });
    const editorRow = members.find((m) => m.email === "editor@example.com")!;
    const ownerRow = members.find((m) => m.role === "owner")!;
    await expect(editor.mutation(api.workspaces.setRole, { memberId: editorRow._id, role: "owner" })).rejects.toThrow(/owner role/i);
    await expect(w.owner.mutation(api.workspaces.setRole, { memberId: ownerRow._id, role: "editor" })).rejects.toThrow(/at least one owner/i);
    await expect(w.owner.mutation(api.workspaces.removeMember, { memberId: ownerRow._id })).rejects.toThrow(/at least one owner/i);
  });

  test("an admin cannot mint an owner invite", async () => {
    const w = await world();
    const admin = await join(w, "admin@example.com", "admin");
    await expect(admin.action(api.workspaces.createInvite, { workspaceId: w.workspaceId, role: "owner" })).rejects.toThrow(/only an owner/i);
  });

  test("posts in one workspace are invisible to another", async () => {
    const w = await world();
    const { postId } = await w.owner.mutation(api.posts.save, {
      workspaceId: w.workspaceId, text: "secret plan", mediaIds: [], targets: [], mode: "draft",
    });
    const stranger = await signUp(w.t, "stranger@example.com");
    await expect(stranger.query(api.posts.get, { postId })).rejects.toThrow(/not found/i);
    await expect(stranger.mutation(api.posts.remove, { postId })).rejects.toThrow(/not found/i);
    await expect(stranger.mutation(api.posts.duplicate, { postId })).rejects.toThrow(/not found/i);
  });
});
