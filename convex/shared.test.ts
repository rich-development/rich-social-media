import { describe, expect, test } from "vitest";
import { nextQueueSlot, zonedParts, zonedTimeToUtc } from "./lib/time";
import { validateForPlatform } from "./shared/platforms";

describe("time zones", () => {
  test("wall clock to UTC, including daylight saving changes", () => {
    expect(new Date(zonedTimeToUtc(2026, 1, 15, 9, 0, "America/New_York")).toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(new Date(zonedTimeToUtc(2026, 7, 15, 9, 0, "America/New_York")).toISOString()).toBe("2026-07-15T13:00:00.000Z");
    expect(zonedParts(Date.UTC(2026, 10, 16, 15, 0), "America/New_York")).toMatchObject({ hour: 10, weekday: 1 });
  });
  test("queue skips taken slots and days that are off", () => {
    const slots = [{ days: [1, 3], time: "09:00" }];
    const mon10 = Date.UTC(2026, 10, 16, 15, 0);
    const wed9 = zonedTimeToUtc(2026, 11, 18, 9, 0, "America/New_York");
    expect(nextQueueSlot(slots, "America/New_York", mon10, new Set())).toBe(wed9);
    expect(nextQueueSlot(slots, "America/New_York", mon10, new Set([wed9]))).toBe(zonedTimeToUtc(2026, 11, 23, 9, 0, "America/New_York"));
    expect(nextQueueSlot([], "America/New_York", mon10, new Set())).toBeNull();
  });
});

describe("network rules", () => {
  const img = { kind: "image" as const, size: 1_500_000 };
  const vid = { kind: "video" as const, size: 5_000_000 };
  test("instagram needs media and caps hashtags", () => {
    expect(validateForPlatform("instagram", "hi", [])).toContain("Needs an image or video.");
    expect(validateForPlatform("instagram", "hi", [img])).toEqual([]);
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(validateForPlatform("instagram", tags, [img])).toContain("Instagram allows 30 hashtags at most.");
  });
  test("threads 500, bluesky 300 and 2 MB images, youtube video only", () => {
    expect(validateForPlatform("threads", "a".repeat(501), [])[0]).toMatch(/1 characters over the 500 limit/);
    expect(validateForPlatform("bluesky", "ok", [{ kind: "image", size: 2_500_000 }])).toContain("Bluesky images must be under 2 MB.");
    expect(validateForPlatform("youtube", "title", [img])).toContain("Needs a video.");
    expect(validateForPlatform("youtube", "title", [vid])).toEqual([]);
    expect(validateForPlatform("x", "hello", [img])).toContain("Images are not supported here.");
  });
  test("emoji count as one character", () => {
    expect(validateForPlatform("bluesky", "🔥".repeat(300), [])).toEqual([]);
  });
});
