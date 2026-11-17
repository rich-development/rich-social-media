import {
  assertUploadable, call, env, expiresIn, form, PublishError,
  type MediaItem, type Provider, type PublishInput, type PublishResult,
} from "./http";

const API = "https://api.linkedin.com";
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": process.env.LINKEDIN_API_VERSION ?? "202601",
  "X-Restli-Protocol-Version": "2.0.0",
  "Content-Type": "application/json",
});

export const linkedin: Provider = {
  env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  authUrl({ state, redirectUri }) {
    const q = form({
      response_type: "code", client_id: env("LINKEDIN_CLIENT_ID"), redirect_uri: redirectUri,
      state, scope: "openid profile w_member_social",
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },
  async exchange({ code, redirectUri }) {
    const t = await call("LinkedIn sign-in", "https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      body: form({
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
        client_id: env("LINKEDIN_CLIENT_ID"), client_secret: env("LINKEDIN_CLIENT_SECRET"),
      }),
    });
    const me = await call("LinkedIn profile", `${API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${t.body.access_token}` },
    });
    return [{
      platform: "linkedin", externalId: me.body.sub, displayName: me.body.name ?? "LinkedIn profile",
      avatarUrl: me.body.picture,
      tokens: {
        accessToken: t.body.access_token, refreshToken: t.body.refresh_token,
        expiresAt: expiresIn(t.body.expires_in),
      },
    }];
  },
  // Only some LinkedIn apps are issued refresh tokens. Without one the
  // channel is flagged for reconnection when the 60 day token runs out.
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new PublishError("LinkedIn access expired. Reconnect the account.", "auth");
    const t = await call("LinkedIn token refresh", "https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      body: form({
        grant_type: "refresh_token", refresh_token: tokens.refreshToken,
        client_id: env("LINKEDIN_CLIENT_ID"), client_secret: env("LINKEDIN_CLIENT_SECRET"),
      }),
    });
    return {
      accessToken: t.body.access_token, refreshToken: t.body.refresh_token ?? tokens.refreshToken,
      expiresAt: expiresIn(t.body.expires_in),
    };
  },
};

/** LinkedIn's post text format treats these characters as markup. */
function escapeCommentary(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`);
}

async function uploadImage(token: string, owner: string, item: MediaItem): Promise<string> {
  assertUploadable(item, "LinkedIn");
  const init = await call("LinkedIn image setup", `${API}/rest/images?action=initializeUpload`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const { uploadUrl, image } = init.body.value;
  await call("LinkedIn image upload", uploadUrl, {
    method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: await item.blob(),
  });
  return image;
}

async function uploadVideo(token: string, owner: string, item: MediaItem): Promise<string> {
  assertUploadable(item, "LinkedIn");
  const init = await call("LinkedIn video setup", `${API}/rest/videos?action=initializeUpload`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes: item.size, uploadCaptions: false, uploadThumbnail: false },
    }),
  });
  const { video, uploadInstructions, uploadToken } = init.body.value;
  const blob = await item.blob();
  const etags: string[] = [];
  for (const part of uploadInstructions) {
    const res = await call("LinkedIn video upload", part.uploadUrl, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" },
      body: blob.slice(part.firstByte, part.lastByte + 1),
    });
    etags.push((res.headers.get("etag") ?? "").replace(/"/g, ""));
  }
  await call("LinkedIn video finish", `${API}/rest/videos?action=finalizeUpload`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken: uploadToken ?? "", uploadedPartIds: etags } }),
  });
  return video;
}

export async function publishLinkedIn(input: PublishInput): Promise<PublishResult> {
  const { accessToken, channel, text, media, options } = input;
  const author = `urn:li:person:${channel.externalId}`;
  const body: Record<string, unknown> = {
    author,
    commentary: escapeCommentary(text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const videos = media.filter((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");
  if (videos.length > 0) {
    body.content = { media: { id: await uploadVideo(accessToken, author, videos[0]), title: options.title } };
  } else if (images.length === 1) {
    body.content = { media: { id: await uploadImage(accessToken, author, images[0]), altText: images[0].alt } };
  } else if (images.length > 1) {
    const ids = [];
    for (const img of images.slice(0, 9)) ids.push({ id: await uploadImage(accessToken, author, img), altText: img.alt ?? "" });
    body.content = { multiImage: { images: ids } };
  } else if (options.link) {
    body.content = { article: { source: options.link, title: options.title ?? options.link } };
  }
  const res = await call("LinkedIn post", `${API}/rest/posts`, {
    method: "POST", headers: headers(accessToken), body: JSON.stringify(body),
  });
  const urn = res.headers.get("x-restli-id") ?? "";
  if (!urn) throw new PublishError("LinkedIn accepted the post but did not return its id.", "permanent");
  return { externalId: urn, permalink: `https://www.linkedin.com/feed/update/${urn}/` };
}
