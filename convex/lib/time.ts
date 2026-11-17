// Time zone math without any dependencies. Works in Convex and the browser.

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(ms: number, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) map[p.type] = p.value;
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour) % 24, minute: Number(map.minute),
    weekday: WEEKDAYS.indexOf(map.weekday),
  };
}

/** The instant for a wall-clock time in a zone (handles DST). */
export function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset across DST changes.
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(ms, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    ms += guess - asUtc;
  }
  return ms;
}

export type QueueSlot = { days: number[]; time: string };

/**
 * The next open queue slot after `afterMs`, skipping any slot already taken.
 * Looks up to 60 days ahead. Returns null when there are no slots at all.
 */
export function nextQueueSlot(
  slots: QueueSlot[], tz: string, afterMs: number, taken: Set<number>,
): number | null {
  if (slots.length === 0) return null;
  const DAY = 24 * 60 * 60 * 1000;
  for (let d = 0; d < 60; d++) {
    // Midday keeps us on the right calendar day across DST shifts.
    const p = zonedParts(afterMs + d * DAY, tz);
    const candidates: number[] = [];
    for (const slot of slots) {
      if (!slot.days.includes(p.weekday)) continue;
      const [h, m] = slot.time.split(":").map(Number);
      candidates.push(zonedTimeToUtc(p.year, p.month, p.day, h, m, tz));
    }
    candidates.sort((a, b) => a - b);
    for (const c of candidates) {
      if (c > afterMs && !taken.has(c)) return c;
    }
  }
  return null;
}
