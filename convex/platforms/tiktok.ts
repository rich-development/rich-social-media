import {
  assertUploadable, call, env, expiresIn, form, PublishError,
  type Provider, type PublishInput, type PublishResult, type TokenSet,
} from "./http";

const API = "https://open.tiktokapis.com/v2";

function tokenSet(body: any): TokenSet {
  if (!body?.access_token) throw new PublishError(`TikTok sign-in failed: ${JSON.stringify(body).slice(0, 200)}`, "auth");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: expiresIn(body.expires_in) };
}

export const tiktok: Provider = {
  env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  authUrl({ state, redirectUri }) {
    const q = form({
      client_key: env("TIKTOK_CLIENT_KEY"), redirect_uri: redirectUri, response_type: "code", state,
      scope: "user.info.basic,video.publish",
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  },
  async exchange({ code, redirectUri }) {
    const t = await call("TikTok sign-in", `${API}/oauth/token/`, {
      method: "POST",
      body: form({
        client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"),
        code, grant_type: "authorization_code", redirect_uri: redirectUri,
      }),
    });
    const tokens = tokenSet(t.body);
    const me = await call("TikTok profile", `${API}/user/info/?fields=open_id,display_name,avatar_url`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const user = me.body?.data?.user ?? {};
    return [{
      platform: "tiktok", externalId: user.open_id ?? t.body.open_id, displayName: user.display_name ?? "TikTok account",
      avatarUrl: user.avatar_url, tokens,
    }];
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new PublishError("TikTok access expired. Reconnect the account.", "auth");
    const t = await call("TikTok token refresh", `${API}/oauth/token/`, {
      method: "POST",
      body: form({
        client_key: env("TIKTOK_CLIENT_KEY"), client_secret: env("TIKTOK_CLIENT_SECRET"),
        grant_type: "refresh_token", refresh_token: tokens.refreshToken,
      }),
    });
    return tokenSet(t.body);
  },
};

export async function publishTikTok(input: PublishInput): Promise<PublishResult> {
  const video = input.media.find((m) => m.kind === "video");
  if (!video) throw new PublishError("TikTok needs a video.", "permanent");
  assertUploadable(video, "TikTok");
  const headers = { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
  // Apps that TikTok has not audited may only post privately.
  const privacy = process.env.TIKTOK_AUDITED === "true" && input.options.privacy !== "private"
    ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
  const init = await call("TikTok upload setup", `${API}/post/publish/video/init/`, {
    method: "POST", headers,
    body: JSON.stringify({
      post_info: { title: input.text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
      source_info: { source: "FILE_UPLOAD", video_size: video.size, chunk_size: video.size, total_chunk_count: 1 },
    }),
  });
  const { publish_id, upload_url } = init.body?.data ?? {};
  if (!upload_url) throw new PublishError(`TikTok did not accept the post: ${JSON.stringify(init.body?.error).slice(0, 200)}`, "permanent");
  await call("TikTok upload", upload_url, {
    method: "PUT",
    headers: { "Content-Type": video.contentType, "Content-Range": `bytes 0-${video.size - 1}/${video.size}` },
    body: await video.blob(),
  });
  return { externalId: publish_id };
}
