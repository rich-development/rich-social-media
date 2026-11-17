import type { MediaKind, Platform } from "../shared/platforms";

export type ErrorKind = "auth" | "retryable" | "permanent";

/** Every connector failure is one of these, so the engine knows what to do next. */
export class PublishError extends Error {
  kind: ErrorKind;
  constructor(message: string, kind: ErrorKind) {
    super(message);
    this.kind = kind;
  }
}

export type TokenSet = { accessToken: string; refreshToken?: string; expiresAt?: number };

export type Account = {
  platform: Platform;
  externalId: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  tokens: TokenSet;
  boards?: { id: string; name: string }[];
};

export type MediaItem = {
  url: string;
  kind: MediaKind;
  contentType: string;
  size: number;
  alt?: string;
  /** Loads the file bytes. Only for networks that need a direct upload. */
  blob: () => Promise<Blob>;
};

export type PublishInput = {
  text: string;
  firstComment?: string;
  options: { title?: string; link?: string; boardId?: string; privacy?: "public" | "unlisted" | "private" };
  media: MediaItem[];
  channel: { externalId: string; handle?: string };
  accessToken: string;
};

export type PublishResult = { externalId: string; permalink?: string };

export type Provider = {
  /** Env vars that must be set for this provider to work. */
  env: string[];
  usesPkce?: boolean;
  authUrl(p: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchange(p: { code: string; redirectUri: string; codeVerifier?: string }): Promise<Account[]>;
  refresh?(tokens: TokenSet): Promise<TokenSet>;
};

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new PublishError(`${name} is not set on the Convex deployment.`, "permanent");
  return value;
}

/** Uploads are held in memory, so very large files cannot be pushed by bytes. */
export const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;

export function assertUploadable(item: MediaItem, network: string) {
  if (item.size > MAX_UPLOAD_BYTES) {
    throw new PublishError(
      `${network} needs the file uploaded directly and this one is over 48 MB. Use a smaller file.`,
      "permanent",
    );
  }
}

function classify(status: number): ErrorKind {
  if (status === 401) return "auth";
  if (status === 429 || status >= 500) return "retryable";
  return "permanent";
}

/**
 * fetch + JSON with consistent errors. Error text includes the network's
 * response body (trimmed) but never the request URL or headers, since those
 * can carry tokens.
 */
export async function call(
  what: string,
  url: string,
  init: RequestInit = {},
  opts: { authCodes?: (body: any) => boolean } = {},
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new PublishError(`${what}: could not reach the network.`, "retryable");
  }
  const raw = await res.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const kind = opts.authCodes?.(body) ? "auth" : classify(res.status);
    throw new PublishError(`${what} failed (${res.status}): ${raw.slice(0, 300)}`, kind);
  }
  return { body, headers: res.headers };
}

export function form(params: Record<string, string | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") out.set(k, v);
  return out;
}

export function expiresIn(seconds: unknown): number | undefined {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? Date.now() + n * 1000 : undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
