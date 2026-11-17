import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PLATFORM_INFO, type Platform } from "../../convex/shared/platforms";
import { useWs } from "../App";
import { Empty, Loading, PageHeader, PlatformBadge } from "../components/ui";

export default function Analytics() {
  const { ws } = useWs();
  const [days, setDays] = useState(30);
  const data = useQuery(api.analytics.overview, { workspaceId: ws._id, days });
  if (!data) return <Loading />;
  const maxDay = Math.max(1, ...data.perDay.map((d) => d.count));
  const maxHour = Math.max(1, ...data.perHour);
  const tiles = [
    { label: "Published", value: data.published },
    { label: "Failed", value: data.failed },
    { label: "Delivery rate", value: data.successRate === null ? "n/a" : `${data.successRate}%` },
    { label: "Waiting to go out", value: data.upcoming },
  ];
  return (
    <>
      <PageHeader title="Analytics" sub="What went out, where, and how reliably. Counts are per channel."
        actions={<select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range">
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t.label}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>
      {data.published + data.failed === 0 ? (
        <div className="mt-6"><Empty title="No publishing history yet">Once posts go out, this page fills in.</Empty></div>
      ) : (
        <>
          <section className="card mt-6 p-4">
            <h2 className="text-sm font-bold">Posts published per day</h2>
            <div className="mt-4 flex h-36 items-end gap-px" role="img" aria-label={`Posts per day over the last ${data.days} days`}>
              {data.perDay.map((d) => (
                <div key={d.day} className="group relative flex h-full flex-1 items-end">
                  <div className="w-full rounded-t bg-ink/80 group-hover:bg-gold" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 3 : 1 }} />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-white group-hover:block">{d.day}: {d.count}</div>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{data.perDay[0]?.day}</span><span>{data.perDay.at(-1)?.day}</span></div>
          </section>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="card p-4">
              <h2 className="text-sm font-bold">By channel</h2>
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="pb-2 font-semibold">Channel</th><th className="pb-2 text-right font-semibold">Published</th><th className="pb-2 text-right font-semibold">Failed</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.perChannel.map((c) => (
                    <tr key={c.channelId}>
                      <td className="py-2"><span className="flex items-center gap-2"><PlatformBadge platform={c.platform} size={18} /> {c.name}</span></td>
                      <td className="py-2 text-right tabular-nums">{c.published}</td>
                      <td className={`py-2 text-right tabular-nums ${c.failed ? "font-semibold text-bad" : ""}`}>{c.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">By network</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {data.perPlatform.map((p) => (
                  <li key={p.platform} className="flex items-center gap-2">
                    <PlatformBadge platform={p.platform as Platform} size={18} /> {PLATFORM_INFO[p.platform as Platform].label}
                    <span className="ml-auto tabular-nums">{p.published} out{p.failed ? `, ${p.failed} failed` : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card p-4">
              <h2 className="text-sm font-bold">When you post</h2>
              <p className="text-xs text-muted">Hour of day in {ws.timezone}.</p>
              <div className="mt-4 flex h-28 items-end gap-0.5" role="img" aria-label="Posts by hour of day">
                {data.perHour.map((n, h) => (
                  <div key={h} className="flex h-full flex-1 items-end" title={`${h}:00, ${n} posts`}>
                    <div className="w-full rounded-t bg-gold/80" style={{ height: `${(n / maxHour) * 100}%`, minHeight: 1 }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
              {data.recentFailures.length > 0 && (
                <>
                  <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Recent failures</h3>
                  <ul className="mt-2 space-y-2">
                    {data.recentFailures.map((f, i) => (
                      <li key={i} className="flex gap-2 text-xs"><PlatformBadge platform={f.platform} size={16} /><span className="break-words text-bad">{f.error}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-muted">Likes, comments, and reach are not pulled from the networks yet. That needs each network's insights access.</p>
    </>
  );
}
