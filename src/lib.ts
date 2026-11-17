import { ConvexError } from "convex/values";
import { zonedParts, zonedTimeToUtc } from "../convex/lib/time";
import type { Platform } from "../convex/shared/platforms";

/** A message safe to show a person. Server details stay in the console. */
export function errMsg(e: unknown): string {
  if (e instanceof ConvexError && typeof e.data === "string") return e.data;
  console.error(e);
  return "Something went wrong. Please try again.";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtDateTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(ms);
}
export function fmtTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms);
}
export function fmtDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(ms);
}
export function dayKey(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
/** Value for a datetime-local input, shown in the workspace time zone. */
export function toLocalInput(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function fromLocalInput(value: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}
export function fmtSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const PLATFORM_MARK: Record<Platform, string> = {
  facebook: "f", instagram: "IG", threads: "@", linkedin: "in", youtube: "YT",
  tiktok: "TT", pinterest: "P", bluesky: "bs", x: "X",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pending_approval: "Needs approval", scheduled: "Scheduled", publishing: "Publishing",
  published: "Published", partial: "Partly published", failed: "Failed", pending: "Waiting",
};
export const STATUS_STYLE: Record<string, string> = {
  draft: "bg-canvas text-muted", pending_approval: "bg-gold-soft text-warn", scheduled: "bg-ink/10 text-ink",
  publishing: "bg-gold-soft text-warn", published: "bg-ok/10 text-ok", partial: "bg-warn/10 text-warn",
  failed: "bg-bad/10 text-bad", pending: "bg-ink/10 text-ink",
};

/** Minimal CSV reader: handles quoted fields, commas, and line breaks in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}
