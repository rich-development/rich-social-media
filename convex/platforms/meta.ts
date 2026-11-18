// Facebook Pages, Instagram (via the Facebook Graph API) and Threads.
import {
  call, env, expiresIn, form, sleep, PublishError,
  type Account, type Provider, type PublishInput, type PublishResult,
} from "./http";

const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v26.0"}`;
const THREADS = "https://graph.threads.net";

// Graph API signals an expired or revoked token with error code 190.
const metaAuth = { authCodes: (b: any) => b?.error?.code === 190 || b?.error?.code === 102 };

const post = (what: string, url: string, params: Record<string, string | undefined>) =>
  call(what, url, { method: "POST", body: form(params) }, metaAuth);
const get = (what: string, url: string, token: string) =>
  call(what, url, { headers: { Authorization: `Bearer ${token}` } }, metaAuth);

export const meta: Provider = {
  env: ["META_APP_ID", "META_APP_SECRET"],
  authUrl({ state, redirectUri }) {
    const q = form({
      client_id: env("META_APP_ID"),
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      // instagram_manage_comments (first comment on Instagram) is optional: Meta
      // rejects the whole sign-in if a scope is not enabled on the app. Add it
      // with META_EXTRA_SCOPES once it is enabled in the Meta dashboard.
      scope: [
        "pages_show_list", "pages_manage_posts", "pages_read_engagement",
        "instagram_basic", "instagram_content_publish", "business_management",
        ...(process.env.META_EXTRA_SCOPES ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      ].join(","),
    });
    return `https://www.facebook.com/${process.env.META_GRAPH_VERSION ?? "v26.0"}/dialog/oauth?${q}`;
  },
  async exchange({ code, redirectUri }) {
    const short = await post("Facebook sign-in", `${graph()}/oauth/access_token`, {
      client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"), redirect_uri: redirectUri, code,
    });
    // Swap for a long-lived user token. Page tokens derived from it do not expire.
    const long = await post("Facebook token exchange", `${graph()}/oauth/access_token`, {
      grant_type: "fb_exchange_token", client_id: env("META_APP_ID"), client_secret: env("META_APP_SECRET"),
      fb_exchange_token: short.body.access_token,
    });
    const pages = await get(
      "Facebook pages",
      `${graph()}/me/accounts?limit=100&fields=id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}`,
      long.body.access_token,
    );
    const accounts: Account[] = [];
    for (const page of pages.body?.data ?? []) {
      if (!page.access_token) continue;
      accounts.push({
        platform: "facebook", externalId: page.id, displayName: page.name,
        avatarUrl: page.picture?.data?.url, tokens: { accessToken: page.access_token },
      });
      const ig = page.instagram_business_account;
      if (ig?.id) {
        accounts.push({
          platform: "instagram", externalId: ig.id, displayName: ig.username ?? page.name,
          handle: ig.username, avatarUrl: ig.profile_picture_url, tokens: { accessToken: page.access_token },
        });
      }
    }
    return accounts;
  },
};

/**
 * The post is already live when this runs, so a failed comment must not fail
 * the post. Otherwise a retry would publish the post a second time.
 */
async function firstComment(network: string, id: string, access_token: string, message: string) {
  try {
    await post(`${network} first comment`, `${graph()}/${id}/comments`, { access_token, message });
  } catch (e) {
    console.warn(`${network} post went out but the first comment did not:`, e instanceof Error ? e.message : "unknown error");
  }
}

export async function publishFacebook(input: PublishInput): Promise<PublishResult> {
  const { accessToken: access_token, channel, text, media, options } = input;
  const page = `${graph()}/${channel.externalId}`;
  const videos = media.filter((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");
  let id: string;
  if (videos.length > 0) {
    const r = await post("Facebook video", `${page}/videos`, { access_token, file_url: videos[0].url, description: text });
    id = r.body.id;
  } else if (images.length === 1) {
    const r = await post("Facebook photo", `${page}/photos`, { access_token, url: images[0].url, caption: text });
    id = r.body.post_id ?? r.body.id;
  } else if (images.length > 1) {
    const params: Record<string, string> = { access_token, message: text };
    for (let i = 0; i < images.length; i++) {
      const up = await post("Facebook photo upload", `${page}/photos`, { access_token, url: images[i].url, published: "false" });
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: up.body.id });
    }
    id = (await post("Facebook post", `${page}/feed`, params)).body.id;
  } else {
    id = (await post("Facebook post", `${page}/feed`, { access_token, message: text, link: options.link })).body.id;
  }
  if (input.firstComment && videos.length === 0) {
    await firstComment("Facebook", id, access_token, input.firstComment);
  }
  return { externalId: id, permalink: `https://www.facebook.com/${id}` };
}

async function waitForContainer(base: string, id: string, token: string, field: "status_code" | "status") {
  // Videos take a while to process. Poll for up to about 5 minutes.
  for (let i = 0; i < 60; i++) {
    const r = await get("Media processing check", `${base}/${id}?fields=${field}`, token);
    const status = r.body?.[field];
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new PublishError("The network could not process this media. Check the file format and size.", "permanent");
    }
    await sleep(5000);
  }
  throw new PublishError("Media processing took too long.", "retryable");
}

export async function publishInstagram(input: PublishInput): Promise<PublishResult> {
  const { accessToken: access_token, channel, text, media } = input;
  const ig = `${graph()}/${channel.externalId}`;
  if (media.length === 0) throw new PublishError("Instagram needs an image or video.", "permanent");
  let creationId: string;
  if (media.length === 1) {
    const m = media[0];
    const r = await post("Instagram media", `${ig}/media`, m.kind === "video"
      ? { access_token, media_type: "REELS", video_url: m.url, caption: text }
      : { access_token, image_url: m.url, caption: text, alt_text: m.alt });
    creationId = r.body.id;
  } else {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const r = await post("Instagram carousel item", `${ig}/media`, m.kind === "video"
        ? { access_token, media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" }
        : { access_token, image_url: m.url, is_carousel_item: "true" });
      children.push(r.body.id);
    }
    for (const child of children) await waitForContainer(graph(), child, access_token, "status_code");
    const r = await post("Instagram carousel", `${ig}/media`, {
      access_token, media_type: "CAROUSEL", children: children.join(","), caption: text,
    });
    creationId = r.body.id;
  }
  await waitForContainer(graph(), creationId, access_token, "status_code");
  const published = await post("Instagram publish", `${ig}/media_publish`, { access_token, creation_id: creationId });
  const id: string = published.body.id;
  if (input.firstComment) await firstComment("Instagram", id, access_token, input.firstComment);
  let permalink: string | undefined;
  try {
    permalink = (await get("Instagram link", `${graph()}/${id}?fields=permalink`, access_token)).body?.permalink;
  } catch {
    // The post is live. A missing link is not worth failing over.
  }
  return { externalId: id, permalink };
}

export const threads: Provider = {
  env: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  authUrl({ state, redirectUri }) {
    const q = form({
      client_id: env("THREADS_APP_ID"), redirect_uri: redirectUri, state,
      response_type: "code", scope: "threads_basic,threads_content_publish",
    });
    return `https://threads.net/oauth/authorize?${q}`;
  },
  async exchange({ code, redirectUri }) {
    const short = await post("Threads sign-in", `${THREADS}/oauth/access_token`, {
      client_id: env("THREADS_APP_ID"), client_secret: env("THREADS_APP_SECRET"),
      grant_type: "authorization_code", redirect_uri: redirectUri, code,
    });
    const long = await call(
      "Threads token exchange",
      `${THREADS}/access_token?${form({ grant_type: "th_exchange_token", client_secret: env("THREADS_APP_SECRET"), access_token: short.body.access_token })}`,
    );
    const token: string = long.body.access_token;
    const me = await get("Threads profile", `${THREADS}/v1.0/me?fields=id,username,threads_profile_picture_url`, token);
    return [{
      platform: "threads", externalId: String(me.body.id), displayName: me.body.username,
      handle: me.body.username, avatarUrl: me.body.threads_profile_picture_url,
      tokens: { accessToken: token, expiresAt: expiresIn(long.body.expires_in) },
    }];
  },
  // Threads long-lived tokens last 60 days and are refreshed with themselves.
  async refresh(tokens) {
    const r = await call(
      "Threads token refresh",
      `${THREADS}/refresh_access_token?${form({ grant_type: "th_refresh_token", access_token: tokens.accessToken })}`,
      {}, metaAuth,
    );
    return { accessToken: r.body.access_token, expiresAt: expiresIn(r.body.expires_in) };
  },
};

export async function publishThreads(input: PublishInput): Promise<PublishResult> {
  const { accessToken: access_token, channel, text, media } = input;
  const user = `${THREADS}/v1.0/${channel.externalId}`;
  const item = (m: (typeof media)[number], extra: Record<string, string>) =>
    post("Threads media", `${user}/threads`, m.kind === "video"
      ? { access_token, media_type: "VIDEO", video_url: m.url, ...extra }
      : { access_token, media_type: "IMAGE", image_url: m.url, alt_text: m.alt, ...extra });
  let creationId: string;
  if (media.length === 0) {
    creationId = (await post("Threads post", `${user}/threads`, { access_token, media_type: "TEXT", text })).body.id;
  } else if (media.length === 1) {
    creationId = (await item(media[0], { text })).body.id;
  } else {
    const children: string[] = [];
    for (const m of media.slice(0, 20)) children.push((await item(m, { is_carousel_item: "true" })).body.id);
    for (const child of children) await waitForContainer(`${THREADS}/v1.0`, child, access_token, "status");
    creationId = (await post("Threads carousel", `${user}/threads`, {
      access_token, media_type: "CAROUSEL", children: children.join(","), text,
    })).body.id;
  }
  await waitForContainer(`${THREADS}/v1.0`, creationId, access_token, "status");
  const published = await post("Threads publish", `${user}/threads_publish`, { access_token, creation_id: creationId });
  const id: string = published.body.id;
  let permalink: string | undefined;
  try {
    permalink = (await get("Threads link", `${THREADS}/v1.0/${id}?fields=permalink`, access_token)).body?.permalink;
  } catch {
    // Post is live either way.
  }
  return { externalId: id, permalink };
}
