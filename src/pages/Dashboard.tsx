import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useWs } from "../App";
import { ActivityList, Empty, Loading, PageHeader, PlatformBadge } from "../components/ui";
import { fmtDateTime } from "../lib";

export default function Dashboard() {
  const { ws, can, compose } = useWs();
  const counts = useQuery(api.posts.counts, { workspaceId: ws._id });
  const scheduled = useQuery(api.posts.list, { workspaceId: ws._id, status: "scheduled" });
  const channels = useQuery(api.channels.list, { workspaceId: ws._id });
  const activity = useQuery(api.workspaces.activity, { workspaceId: ws._id, limit: 6 });
  if (!counts || !scheduled || !channels || !activity) return <Loading />;
  const broken = channels.channels.filter((c) => c.status === "needs_reauth");
  const stats = [
    { label: "Scheduled", value: counts.scheduled, tab: "scheduled" },
    { label: "Drafts", value: counts.draft, tab: "draft" },
    { label: "Needs approval", value: counts.pending_approval, tab: "pending_approval" },
    { label: "Failed", value: counts.failed, bad: counts.failed > 0, tab: "failed" },
  ];
  return (
    <>
      <PageHeader title={ws.name} sub={`Times shown in ${ws.timezone}`} actions={can("editor") && <button className="btn-primary" onClick={() => compose()}>New post</button>} />
      {broken.length > 0 && (
        <Link to="/channels" className="mb-4 block rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm font-semibold text-bad">
          {broken.length === 1 ? `${broken[0].displayName} needs` : `${broken.length} channels need`} to be reconnected. Posts to {broken.length === 1 ? "it" : "them"} will fail until you do.
        </Link>
      )}
      {channels.channels.length === 0 && (
        <Link to="/channels" className="mb-4 block rounded-xl border border-gold/40 bg-gold-soft px-4 py-3 text-sm font-semibold text-warn">
          No channels connected yet. Connect your first account to start publishing.
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link to={`/posts?tab=${s.tab}`} key={s.label} className="card p-4 hover:border-ink/30">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</div>
            <div className={`mt-1 text-3xl font-bold tabular-nums ${s.bad ? "text-bad" : ""}`}>{s.value}</div>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="min-w-0">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Up next</h2>
          {scheduled.length === 0 ? (
            <Empty title="Nothing scheduled">Write a post and add it to the queue. It goes out at your next open time.</Empty>
          ) : (
            <ul className="space-y-2">
              {scheduled.slice(0, 6).map((p) => (
                <li key={p._id}>
                  <button className="card flex w-full items-center gap-3 p-3 text-left hover:border-ink/30" onClick={() => compose({ postId: p._id })}>
                    <div className="w-32 shrink-0 text-xs font-semibold text-muted">{p.scheduledAt ? fmtDateTime(p.scheduledAt, ws.timezone) : "No time"}</div>
                    <div className="min-w-0 flex-1 truncate text-sm">{p.text || <span className="text-muted">Media only</span>}</div>
                    <div className="flex -space-x-1">{p.targets.map((t) => <PlatformBadge key={t._id} platform={t.platform} size={20} />)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Recent activity</h2>
            <Link to="/activity" className="text-xs font-semibold text-gold hover:underline">View all</Link>
          </div>
          <ActivityList items={activity.items} tz={ws.timezone} onOpen={(postId) => compose({ postId })} />
        </section>
      </div>
    </>
  );
}
