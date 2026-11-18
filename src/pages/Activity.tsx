import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ACTIVITY_KIND_IDS, ACTIVITY_KINDS, type ActivityKind } from "../../convex/shared/activity";
import { useWs } from "../App";
import { ActivityList, Loading, PageHeader } from "../components/ui";

const PAGE = 40;

export default function Activity() {
  const { ws, compose } = useWs();
  const [kind, setKind] = useState<ActivityKind | null>(null);
  const [problems, setProblems] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const data = useQuery(api.workspaces.activity, {
    workspaceId: ws._id, limit, kind: kind ?? undefined, level: problems ? "error" : undefined,
  });
  const pick = (next: ActivityKind | null) => { setKind(next); setLimit(PAGE); };
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-muted hover:border-ink/40 hover:text-ink"}`;

  return (
    <>
      <PageHeader title="Activity" sub="What happened in this workspace. Entries older than 90 days are cleared automatically." />
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter activity">
        <button className={chip(kind === null)} aria-pressed={kind === null} onClick={() => pick(null)}>All types</button>
        {ACTIVITY_KIND_IDS.map((id) => (
          <button key={id} className={chip(kind === id)} aria-pressed={kind === id} onClick={() => pick(id)}>{ACTIVITY_KINDS[id].label}</button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="h-4 w-4 accent-bad" checked={problems} onChange={(e) => { setProblems(e.target.checked); setLimit(PAGE); }} />
          Problems only
        </label>
      </div>
      {!data ? <Loading /> : data.items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-muted">
          Nothing matches{problems ? " with problems" : ""}{kind ? ` in ${ACTIVITY_KINDS[kind].label.toLowerCase()}` : ""}.
        </div>
      ) : (
        <>
          <ActivityList items={data.items} tz={ws.timezone} onOpen={(postId) => compose({ postId })} />
          {data.hasMore && <button className="btn-ghost mt-4" onClick={() => setLimit((n) => n + PAGE)}>Show more</button>}
        </>
      )}
    </>
  );
}
