// Bluesky needs no developer app. The user creates an "app password" in
// Bluesky settings and we store it encrypted. A fresh session is opened for
// each post.
import { BLUESKY_IMAGE_MAX } from "../shared/platforms";
import { call, PublishError, type Account, type PublishInput, type PublishResult } from "./http";

const PDS = "https://bsky.social/xrpc";

async function session(identifier: string, password: string) {
  const res = await call("Bluesky sign-in", `${PDS}/com.atproto.server.createSession`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  }, { authCodes: (b) => b?.error === "AuthenticationRequired" || b?.error === "AccountTakedown" });
  return res.body as { accessJwt: string; did: string; handle: string };
}

export async function connectBluesky(handle: string, appPassword: string): Promise<Account> {
  const s = await session(handle, appPassword);
  let displayName = s.handle;
  let avatarUrl: string | undefined;
  try {
    const p = await call("Bluesky profile", `${PDS}/app.bsky.actor.getProfile?actor=${encodeURIComponent(s.did)}`, {
      headers: { Authorization: `Bearer ${s.accessJwt}` },
    });
    displayName = p.body.displayName || s.handle;
    avatarUrl = p.body.avatar;
  } catch {
    // Profile details are nice to have.
  }
  return { platform: "bluesky", externalId: s.did, displayName, handle: s.handle, avatarUrl, tokens: { accessToken: appPassword } };
}

/** Links and hashtags need byte offsets into the UTF-8 text. */
function facets(text: string) {
  const enc = new TextEncoder();
  const out: unknown[] = [];
  const at = (index: number) => enc.encode(text.slice(0, index)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    const uri = m[0].replace(/[.,;:!?]+$/, "");
    out.push({
      index: { byteStart: at(m.index), byteEnd: at(m.index + uri.length) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri }],
    });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = m.index + m[1].length;
    out.push({
      index: { byteStart: at(start), byteEnd: at(start + 1 + m[2].length) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }],
    });
  }
  return out;
}

export async function publishBluesky(input: PublishInput): Promise<PublishResult> {
  // accessToken holds the app password for this network.
  const s = await session(input.channel.externalId, input.accessToken);
  const auth = { Authorization: `Bearer ${s.accessJwt}` };
  const images = input.media.filter((m) => m.kind === "image").slice(0, 4);
  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: input.text,
    createdAt: new Date().toISOString(),
    facets: facets(input.text),
  };
  if (images.length > 0) {
    const uploaded = [];
    for (const img of images) {
      // Use the shrunk copy when the original is over Bluesky's limit.
      const file = img.size > BLUESKY_IMAGE_MAX && img.compact ? img.compact : img;
      if (file.size > BLUESKY_IMAGE_MAX) throw new PublishError("An image is over Bluesky's 2 MB limit. Upload it again so it can be shrunk automatically.", "permanent");
      const up = await call("Bluesky image upload", `${PDS}/com.atproto.repo.uploadBlob`, {
        method: "POST", headers: { ...auth, "Content-Type": file.contentType }, body: await file.blob(),
      });
      uploaded.push({ alt: img.alt ?? "", image: up.body.blob });
    }
    record.embed = { $type: "app.bsky.embed.images", images: uploaded };
  }
  const res = await call("Bluesky post", `${PDS}/com.atproto.repo.createRecord`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
  });
  const rkey = String(res.body.uri).split("/").pop();
  return { externalId: res.body.uri, permalink: `https://bsky.app/profile/${s.handle}/post/${rkey}` };
}
