import {
  assertUploadable, call, env, expiresIn, form, PublishError,
  type Provider, type PublishInput, type PublishResult,
} from "./http";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const google: Provider = {
  env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  usesPkce: true,
  authUrl({ state, redirectUri, codeChallenge }) {
    const q = form({
      client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri, response_type: "code", state,
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline", prompt: "consent", include_granted_scopes: "true",
      code_challenge: codeChallenge, code_challenge_method: "S256",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async exchange({ code, redirectUri, codeVerifier }) {
    const t = await call("Google sign-in", TOKEN_URL, {
      method: "POST",
      body: form({
        grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier,
        client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"),
      }),
    });
    const ch = await call("YouTube channel", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${t.body.access_token}` },
    });
    const tokens = {
      accessToken: t.body.access_token, refreshToken: t.body.refresh_token, expiresAt: expiresIn(t.body.expires_in),
    };
    return (ch.body?.items ?? []).map((item: any) => ({
      platform: "youtube" as const, externalId: item.id, displayName: item.snippet?.title ?? "YouTube channel",
      handle: item.snippet?.customUrl, avatarUrl: item.snippet?.thumbnails?.default?.url, tokens,
    }));
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new PublishError("YouTube access expired. Reconnect the channel.", "auth");
    const t = await call("Google token refresh", TOKEN_URL, {
      method: "POST",
      body: form({
        grant_type: "refresh_token", refresh_token: tokens.refreshToken,
        client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"),
      }),
    }, { authCodes: (b) => b?.error === "invalid_grant" });
    return { accessToken: t.body.access_token, refreshToken: tokens.refreshToken, expiresAt: expiresIn(t.body.expires_in) };
  },
};

export async function publishYouTube(input: PublishInput): Promise<PublishResult> {
  const video = input.media.find((m) => m.kind === "video");
  if (!video) throw new PublishError("YouTube needs a video.", "permanent");
  assertUploadable(video, "YouTube");
  const lines = input.text.split("\n");
  const title = (input.options.title || lines[0] || "Untitled").slice(0, 100);
  const auth = { Authorization: `Bearer ${input.accessToken}` };
  // Resumable upload: send the details first, then the bytes.
  const start = await call(
    "YouTube upload setup",
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        ...auth, "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": video.contentType, "X-Upload-Content-Length": String(video.size),
      },
      body: JSON.stringify({
        snippet: { title, description: input.text },
        status: { privacyStatus: input.options.privacy ?? "public", selfDeclaredMadeForKids: false },
      }),
    },
  );
  const location = start.headers.get("location");
  if (!location) throw new PublishError("YouTube did not return an upload address.", "retryable");
  const done = await call("YouTube upload", location, {
    method: "PUT", headers: { ...auth, "Content-Type": video.contentType }, body: await video.blob(),
  });
  const id: string = done.body.id;
  return { externalId: id, permalink: `https://www.youtube.com/watch?v=${id}` };
}
