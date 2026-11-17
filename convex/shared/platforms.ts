// Shared by the backend and the web app. Keep this file free of server code.

export const PLATFORMS = [
  "facebook",
  "instagram",
  "threads",
  "linkedin",
  "youtube",
  "tiktok",
  "pinterest",
  "bluesky",
  "x",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export type PlatformInfo = {
  label: string;
  /** Hard character limit for the main text. */
  maxChars: number;
  maxImages: number;
  maxVideos: number;
  /** A post cannot go out without media. */
  requiresMedia: boolean;
  /** Only video posts are supported. */
  videoOnly: boolean;
  supportsFirstComment: boolean;
  /** Which OAuth app this platform connects through. */
  provider: "meta" | "threads" | "linkedin" | "google" | "tiktok" | "pinterest" | "bluesky" | "x";
  color: string;
  note?: string;
};

export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  facebook: {
    label: "Facebook Page", maxChars: 63206, maxImages: 10, maxVideos: 1,
    requiresMedia: false, videoOnly: false, supportsFirstComment: true,
    provider: "meta", color: "#1877F2",
  },
  instagram: {
    label: "Instagram", maxChars: 2200, maxImages: 10, maxVideos: 1,
    requiresMedia: true, videoOnly: false, supportsFirstComment: true,
    provider: "meta", color: "#E1306C",
    note: "Needs a Business or Creator account linked to a Facebook Page. Max 30 hashtags.",
  },
  threads: {
    label: "Threads", maxChars: 500, maxImages: 20, maxVideos: 1,
    requiresMedia: false, videoOnly: false, supportsFirstComment: false,
    provider: "threads", color: "#000000",
  },
  linkedin: {
    label: "LinkedIn", maxChars: 3000, maxImages: 9, maxVideos: 1,
    requiresMedia: false, videoOnly: false, supportsFirstComment: false,
    provider: "linkedin", color: "#0A66C2",
  },
  youtube: {
    label: "YouTube", maxChars: 5000, maxImages: 0, maxVideos: 1,
    requiresMedia: true, videoOnly: true, supportsFirstComment: false,
    provider: "google", color: "#FF0000",
    note: "Video only. The first line of the caption becomes the title unless you set one.",
  },
  tiktok: {
    label: "TikTok", maxChars: 2200, maxImages: 0, maxVideos: 1,
    requiresMedia: true, videoOnly: true, supportsFirstComment: false,
    provider: "tiktok", color: "#111111",
    note: "Video only. Posts are private until TikTok audits your developer app.",
  },
  pinterest: {
    label: "Pinterest", maxChars: 800, maxImages: 1, maxVideos: 0,
    requiresMedia: true, videoOnly: false, supportsFirstComment: false,
    provider: "pinterest", color: "#E60023",
    note: "One image per Pin. Pick a board in the post options.",
  },
  bluesky: {
    label: "Bluesky", maxChars: 300, maxImages: 4, maxVideos: 0,
    requiresMedia: false, videoOnly: false, supportsFirstComment: false,
    provider: "bluesky", color: "#0085FF",
    note: "Large images are shrunk automatically to fit Bluesky's 2 MB limit.",
  },
  x: {
    label: "X", maxChars: 280, maxImages: 0, maxVideos: 0,
    requiresMedia: false, videoOnly: false, supportsFirstComment: false,
    provider: "x", color: "#000000",
    note: "Text only. Off by default because X may charge for API posting.",
  },
};

export const ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/** Bluesky's cap on a post image, in bytes. */
export const BLUESKY_IMAGE_MAX = 2_000_000;

export type MediaKind = "image" | "video";

/** Count characters the way people see them (emoji = 1). */
export function charCount(text: string): number {
  return [...text].length;
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

/**
 * Check one channel's version of a post against that network's rules.
 * Returns a list of plain-language problems. Empty list means good to go.
 */
export function validateForPlatform(
  platform: Platform,
  text: string,
  media: { kind: MediaKind; size?: number; compactSize?: number }[],
): string[] {
  const info = PLATFORM_INFO[platform];
  const problems: string[] = [];
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");
  const n = charCount(text);
  if (n > info.maxChars) problems.push(`Text is ${n - info.maxChars} characters over the ${info.maxChars} limit.`);
  if (!text.trim() && media.length === 0) problems.push("Add some text or media.");
  if (info.requiresMedia && media.length === 0) {
    problems.push(info.videoOnly ? "Needs a video." : "Needs an image or video.");
  }
  if (info.videoOnly && images.length > 0) problems.push("Only video is supported here. Images will be skipped.");
  if (info.videoOnly && media.length > 0 && videos.length === 0) problems.push("Needs a video.");
  if (images.length > info.maxImages && !info.videoOnly) {
    problems.push(info.maxImages === 0 ? "Images are not supported here." : `Up to ${info.maxImages} image${info.maxImages === 1 ? "" : "s"}.`);
  }
  if (videos.length > info.maxVideos) {
    problems.push(info.maxVideos === 0 ? "Video is not supported here." : "Only one video per post.");
  }
  if (platform === "instagram" && countHashtags(text) > 30) problems.push("Instagram allows 30 hashtags at most.");
  // Bluesky gets the automatically shrunk copy when there is one.
  if (platform === "bluesky" && images.some((m) => (m.compactSize ?? m.size ?? 0) > BLUESKY_IMAGE_MAX)) {
    problems.push("An image is over Bluesky's 2 MB limit and has no smaller copy. Remove it and upload it again so it can be shrunk automatically.");
  }
  return problems;
}
