import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useWs } from "../App";
import { ActivityList, Loading, PageHeader } from "../components/ui";

const PAGE = 40;

export default function Activity() {
  const { ws, compose } = useWs();
  const [problems, setProblems] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const data = useQuery(api.workspaces.activity, { workspaceId: ws._id, limit, level: problems ? "error" : undefined });
  return (
    <>
      <PageHeader title="Activity" sub="What happened in this workspace. Entries older than 90 days are cleared automatically." />
      <div className="mb-4 flex gap-1 border-b border-line">
        {[{ label: "Everything", on: !problems, set: false }, { label: "Problems only", on: problems, set: true }].map((t) => (
          <button key={t.label} onClick={() => { setProblems(t.set); setLimit(PAGE); }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${t.on ? "border-ink" : "border-transparent text-muted hover:text-ink"}`}>{t.label}</button>
        ))}
      </div>
      {!data ? <Loading /> : (
        <>
          <ActivityList items={data.items} tz={ws.timezone} onOpen={(postId) => compose({ postId })} />
          {data.hasMore && <button className="btn-ghost mt-4" onClick={() => setLimit((n) => n + PAGE)}>Show more</button>}
        </>
      )}
    </>
  );
}
