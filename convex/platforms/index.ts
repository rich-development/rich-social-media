import type { Platform } from "../shared/platforms";
import { PLATFORM_INFO } from "../shared/platforms";
import { publishBluesky } from "./bluesky";
import { google, publishYouTube } from "./google";
import type { Provider, PublishInput, PublishResult } from "./http";
import { linkedin, publishLinkedIn } from "./linkedin";
import { meta, publishFacebook, publishInstagram, publishThreads, threads } from "./meta";
import { pinterest, publishPinterest } from "./pinterest";
import { publishTikTok, tiktok } from "./tiktok";
import { publishX, x } from "./x";

/** OAuth providers. Bluesky is not here: it connects with an app password. */
export const PROVIDERS: Record<string, Provider> = { meta, threads, linkedin, google, tiktok, pinterest, x };

export const PUBLISHERS: Record<Platform, (input: PublishInput) => Promise<PublishResult>> = {
  facebook: publishFacebook,
  instagram: publishInstagram,
  threads: publishThreads,
  linkedin: publishLinkedIn,
  youtube: publishYouTube,
  tiktok: publishTikTok,
  pinterest: publishPinterest,
  bluesky: publishBluesky,
  x: publishX,
};

export function providerFor(platform: Platform): Provider | undefined {
  return PROVIDERS[PLATFORM_INFO[platform].provider];
}

export function providerConfigured(id: string): boolean {
  if (id === "bluesky") return true;
  const p = PROVIDERS[id];
  if (!p) return false;
  if (id === "x" && process.env.X_ENABLED !== "true") return false;
  return p.env.every((name) => !!process.env[name]);
}

export function redirectUri(provider: string): string {
  return `${process.env.CONVEX_SITE_URL}/oauth/callback/${provider}`;
}
