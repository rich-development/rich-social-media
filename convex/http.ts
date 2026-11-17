import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { encryptSecret, sha256Hex } from "./lib/crypto";
import { PROVIDERS, providerConfigured, redirectUri } from "./platforms";

const http = httpRouter();

function back(params: Record<string, string>): Response {
  const site = process.env.SITE_URL ?? "http://localhost:5173";
  const url = new URL("/channels", site);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

/**
 * Where each network sends the browser after the user approves access.
 * The `state` value proves this request belongs to a flow an admin started
 * from inside the app within the last 10 minutes, and it works only once.
 */
http.route({
  pathPrefix: "/oauth/callback/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const provider = url.pathname.split("/").pop() ?? "";
    const p = PROVIDERS[provider];
    if (!p || !providerConfigured(provider)) return back({ error: "That network is not set up." });

    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || state.length > 200) return back({ error: "The sign-in link was not valid. Please try again." });
    const flow = await ctx.runMutation(internal.channels.consumeState, { stateHash: await sha256Hex(state), provider });
    if (!flow) return back({ error: "The sign-in link expired. Please try again." });
    if (!code) return back({ error: "Access was not granted." });

    try {
      const accounts = await p.exchange({ code, redirectUri: redirectUri(provider), codeVerifier: flow.codeVerifier });
      if (accounts.length === 0) return back({ error: "No accounts were found on that sign-in." });
      const sealed = [];
      for (const a of accounts) {
        sealed.push({
          platform: a.platform, externalId: a.externalId, displayName: a.displayName, handle: a.handle,
          avatarUrl: a.avatarUrl, boards: a.boards,
          accessTokenEnc: await encryptSecret(a.tokens.accessToken),
          refreshTokenEnc: a.tokens.refreshToken ? await encryptSecret(a.tokens.refreshToken) : undefined,
          expiresAt: a.tokens.expiresAt,
        });
      }
      await ctx.runMutation(internal.channels.upsertAccounts, {
        workspaceId: flow.workspaceId, userId: flow.userId, accounts: sealed,
      });
      return back({ connected: String(accounts.length) });
    } catch (e) {
      // Full detail goes to the Convex logs. The browser gets a short message.
      console.error(`OAuth callback failed for ${provider}:`, e instanceof Error ? e.message : "unknown error");
      return back({ error: "Could not finish connecting. Check the Convex logs for details." });
    }
  }),
});

export default http;
