// X (Twitter). Text posts only. Stays off unless X_ENABLED=true because the
// X API can bill for posting.
import {
  call, env, expiresIn, form, PublishError,
  type Provider, type PublishInput, type PublishResult, type TokenSet,
} from "./http";

const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const basic = () => `Basic ${btoa(`${env("X_CLIENT_ID")}:${env("X_CLIENT_SECRET")}`)}`;
const tokenSet = (b: any, prev?: TokenSet): TokenSet => ({
  accessToken: b.access_token, refreshToken: b.refresh_token ?? prev?.refreshToken, expiresAt: expiresIn(b.expires_in),
});

export const x: Provider = {
  env: ["X_ENABLED", "X_CLIENT_ID", "X_CLIENT_SECRET"],
  usesPkce: true,
  authUrl({ state, redirectUri, codeChallenge }) {
    const q = form({
      response_type: "code", client_id: env("X_CLIENT_ID"), redirect_uri: redirectUri, state,
      scope: "tweet.read tweet.write users.read offline.access",
      code_challenge: codeChallenge, code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },
  async exchange({ code, redirectUri, codeVerifier }) {
    const t = await call("X sign-in", TOKEN_URL, {
      method: "POST", headers: { Authorization: basic() },
      body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
    });
    const me = await call("X profile", "https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { Authorization: `Bearer ${t.body.access_token}` },
    });
    const u = me.body.data;
    return [{
      platform: "x", externalId: u.id, displayName: u.name, handle: u.username,
      avatarUrl: u.profile_image_url, tokens: tokenSet(t.body),
    }];
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new PublishError("X access expired. Reconnect the account.", "auth");
    const t = await call("X token refresh", TOKEN_URL, {
      method: "POST", headers: { Authorization: basic() },
      body: form({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
    }, { authCodes: (b) => b?.error === "invalid_request" || b?.error === "invalid_grant" });
    return tokenSet(t.body, tokens);
  },
};

export async function publishX(input: PublishInput): Promise<PublishResult> {
  if (process.env.X_ENABLED !== "true") throw new PublishError("X posting is switched off.", "permanent");
  const res = await call("X post", "https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: input.text }),
  });
  const id: string = res.body.data.id;
  return { externalId: id, permalink: `https://x.com/${input.channel.handle ?? "i"}/status/${id}` };
}
