import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMember } from "./lib/access";
import { zonedParts } from "./lib/time";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Publishing analytics from our own records: what went out, where, and how
 * reliably. Engagement numbers (likes, reach) need each network's insights
 * API and are not pulled yet.
 */
export const overview = query({
  args: { workspaceId: v.id("workspaces"), days: v.number() },
  handler: async (ctx, { workspaceId, days }) => {
    await requireMember(ctx, workspaceId);
    const span = Math.min(Math.max(Math.round(days), 7), 90);
    const ws = (await ctx.db.get(workspaceId))!;
    const since = Date.now() - span * DAY;
    const byStatus = async (status: "published" | "failed" | "pending") =>
      await ctx.db.query("postTargets").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", status)).order("desc").take(3000);

    const published = (await byStatus("published")).filter((t) => (t.publishedAt ?? 0) >= since);
    const failed = (await byStatus("failed")).filter((t) => t._creationTime >= since);
    const upcoming = (await byStatus("pending")).length;

    const perPlatform: Record<string, { published: number; failed: number }> = {};
    const bump = (platform: string, key: "published" | "failed") => {
      perPlatform[platform] ??= { published: 0, failed: 0 };
      perPlatform[platform][key]++;
    };
    const perDay: Record<string, number> = {};
    const perHour: number[] = Array(24).fill(0);
    const dayKey = (ms: number) => {
      const p = zonedParts(ms, ws.timezone);
      return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    };
    for (let i = span - 1; i >= 0; i--) perDay[dayKey(Date.now() - i * DAY)] = 0;
    for (const t of published) {
      bump(t.platform, "published");
      const key = dayKey(t.publishedAt!);
      if (key in perDay) perDay[key]++;
      perHour[zonedParts(t.publishedAt!, ws.timezone).hour]++;
    }
    for (const t of failed) bump(t.platform, "failed");

    const channels = await ctx.db.query("channels").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    const perChannel = channels.map((c) => ({
      channelId: c._id, name: c.displayName, platform: c.platform,
      published: published.filter((t) => t.channelId === c._id).length,
      failed: failed.filter((t) => t.channelId === c._id).length,
    }));

    const total = published.length + failed.length;
    return {
      days: span,
      published: published.length,
      failed: failed.length,
      upcoming,
      successRate: total === 0 ? null : Math.round((published.length / total) * 100),
      perPlatform: Object.entries(perPlatform).map(([platform, n]) => ({ platform, ...n })),
      perDay: Object.entries(perDay).map(([day, count]) => ({ day, count })),
      perHour,
      perChannel,
      recentFailures: failed.slice(0, 8).map((t) => ({ postId: t.postId, platform: t.platform, error: t.lastError ?? "Unknown error" })),
    };
  },
});
