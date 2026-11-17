import {
  call, env, expiresIn, form, PublishError,
  type Provider, type PublishInput, type PublishResult,
} from "./http";

const API = "https://api.pinterest.com/v5";
const basic = () => `Basic ${btoa(`${env("PINTEREST_APP_ID")}:${env("PINTEREST_APP_SECRET")}`)}`;

export const pinterest: Provider = {
  env: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
  authUrl({ state, redirectUri }) {
    const q = form({
      client_id: env("PINTEREST_APP_ID"), redirect_uri: redirectUri, response_type: "code", state,
      scope: "boards:read,pins:read,pins:write,user_accounts:read",
    });
    return `https://www.pinterest.com/oauth/?${q}`;
  },
  async exchange({ code, redirectUri }) {
    const t = await call("Pinterest sign-in", `${API}/oauth/token`, {
      method: "POST", headers: { Authorization: basic() },
      body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    const auth = { Authorization: `Bearer ${t.body.access_token}` };
    const me = await call("Pinterest profile", `${API}/user_account`, { headers: auth });
    const boards = await call("Pinterest boards", `${API}/boards?page_size=100`, { headers: auth });
    return [{
      platform: "pinterest", externalId: me.body.id ?? me.body.username, displayName: me.body.business_name ?? me.body.username,
      handle: me.body.username, avatarUrl: me.body.profile_image,
      boards: (boards.body?.items ?? []).map((b: any) => ({ id: String(b.id), name: String(b.name) })),
      tokens: { accessToken: t.body.access_token, refreshToken: t.body.refresh_token, expiresAt: expiresIn(t.body.expires_in) },
    }];
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new PublishError("Pinterest access expired. Reconnect the account.", "auth");
    const t = await call("Pinterest token refresh", `${API}/oauth/token`, {
      method: "POST", headers: { Authorization: basic() },
      body: form({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
    });
    return { accessToken: t.body.access_token, refreshToken: t.body.refresh_token ?? tokens.refreshToken, expiresAt: expiresIn(t.body.expires_in) };
  },
};

export async function publishPinterest(input: PublishInput): Promise<PublishResult> {
  const image = input.media.find((m) => m.kind === "image");
  if (!image) throw new PublishError("Pinterest needs an image.", "permanent");
  if (!input.options.boardId) throw new PublishError("Pick a Pinterest board for this post.", "permanent");
  const res = await call("Pinterest pin", `${API}/pins`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      board_id: input.options.boardId,
      title: (input.options.title || input.text.split("\n")[0]).slice(0, 100),
      description: input.text.slice(0, 800),
      link: input.options.link,
      alt_text: image.alt,
      media_source: { source_type: "image_url", url: image.url },
    }),
  });
  return { externalId: res.body.id, permalink: `https://www.pinterest.com/pin/${res.body.id}/` };
}
