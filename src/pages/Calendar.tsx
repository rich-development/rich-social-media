import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { zonedParts, zonedTimeToUtc } from "../../convex/lib/time";
import { useWs } from "../App";
import { PageHeader, PlatformBadge, useToast } from "../components/ui";
import { dayKey, fmtTime, STATUS_STYLE } from "../lib";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export default function Calendar() {
  const { ws, can, compose } = useWs();
  const tz = ws.timezone;
  const toast = useToast();
  const today = zonedParts(Date.now(), tz);
  const [month, setMonth] = useState({ y: today.year, m: today.month });
  const [dragging, setDragging] = useState<Id<"posts"> | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const reschedule = useMutation(api.posts.reschedule);

  // A six-week grid starting on the Sunday on or before the 1st.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(month.y, month.m - 1, 1));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` };
    });
  }, [month]);
  const from = zonedTimeToUtc(cells[0].y, cells[0].m, cells[0].d, 0, 0, tz);
  const to = zonedTimeToUtc(cells[41].y, cells[41].m, cells[41].d, 23, 59, tz) + 60_000;
  const posts = useQuery(api.posts.calendar, { workspaceId: ws._id, from, to });

  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof posts>>();
    for (const p of posts ?? []) {
      const key = dayKey(p.scheduledAt!, tz);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledAt! - b.scheduledAt!);
    return map;
  }, [posts, tz]);

  const todayKey = `${today.year}-${pad(today.month)}-${pad(today.day)}`;
  const shift = (n: number) => setMonth(({ y, m }) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; });
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(month.y, month.m - 1, 1));

  async function drop(cell: (typeof cells)[number]) {
    setOver(null);
    const post = posts?.find((p) => p._id === dragging);
    setDragging(null);
    if (!post?.scheduledAt) return;
    // Keep the time of day, change the date.
    const t = zonedParts(post.scheduledAt, tz);
    const next = zonedTimeToUtc(cell.y, cell.m, cell.d, t.hour, t.minute, tz);
    if (next === post.scheduledAt) return;
    try {
      await reschedule({ postId: post._id, scheduledAt: next });
      toast.ok("Post moved.");
    } catch (e) {
      toast.fail(e);
    }
  }

  return (
    <>
      <PageHeader title="Calendar" sub="Drag a post to another day to move it. Click a day to write a post for it."
        actions={<>
          <button className="btn-ghost" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <button className="btn-ghost" onClick={() => setMonth({ y: today.year, m: today.month })}>Today</button>
          <button className="btn-ghost" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16} /></button>
        </>} />
      <h2 className="mb-2 text-lg font-bold">{title}</h2>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-canvas text-center text-xs font-semibold uppercase tracking-wide text-muted">
          {DAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const list = byDay.get(cell.key) ?? [];
            const outside = cell.m !== month.m;
            const past = cell.key < todayKey;
            return (
              <div key={cell.key}
                onDragOver={(e) => { if (dragging && !past) { e.preventDefault(); setOver(cell.key); } }}
                onDragLeave={() => setOver((o) => (o === cell.key ? null : o))}
                onDrop={() => void drop(cell)}
                className={`min-h-28 border-b border-r border-line p-1.5 ${outside ? "bg-canvas/60" : ""} ${over === cell.key ? "bg-gold-soft" : ""}`}>
                <button
                  className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${cell.key === todayKey ? "bg-ink text-white" : outside ? "text-muted/60" : "text-muted"} ${!past && can("editor") ? "hover:bg-gold-soft" : ""}`}
                  disabled={past || !can("editor")}
                  aria-label={`New post on ${cell.key}`}
                  onClick={() => compose({ at: Math.max(zonedTimeToUtc(cell.y, cell.m, cell.d, 9, 0, tz), Date.now() + 15 * 60_000) })}
                >{cell.d}</button>
                <div className="space-y-1">
                  {list.map((p) => {
                    const movable = can("editor") && ["draft", "pending_approval", "scheduled"].includes(p.status);
                    return (
                      <button key={p._id} draggable={movable}
                        onDragStart={() => setDragging(p._id)} onDragEnd={() => { setDragging(null); setOver(null); }}
                        onClick={() => compose({ postId: p._id })}
                        className={`block w-full rounded-md px-1.5 py-1 text-left text-[11px] leading-tight ${STATUS_STYLE[p.status]} ${movable ? "cursor-grab" : ""}`}>
                        <span className="flex items-center gap-1 font-bold">
                          {fmtTime(p.scheduledAt!, tz)}
                          <span className="ml-auto flex -space-x-1">{p.targets.slice(0, 4).map((t) => <PlatformBadge key={t._id} platform={t.platform} size={12} />)}</span>
                        </span>
                        <span className="line-clamp-2 break-words">{p.text || "Media only"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
