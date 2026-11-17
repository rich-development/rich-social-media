import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Upload } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useWs } from "../App";
import { ConfirmDelete } from "../components/Composer";
import { Empty, Loading, Modal, PageHeader, PlatformBadge, StatusPill, useToast } from "../components/ui";
import { fmtDateTime, fromLocalInput, parseCsv } from "../lib";

const TABS = [
  { id: "scheduled", label: "Queue" },
  { id: "pending_approval", label: "Approvals" },
  { id: "draft", label: "Drafts" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
  { id: "partial", label: "Partly published" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Posts() {
  const { ws, can, compose } = useWs();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("scheduled");
  const [importing, setImporting] = useState(false);
  const [rejecting, setRejecting] = useState<Id<"posts"> | null>(null);
  const [reason, setReason] = useState("");
  const posts = useQuery(api.posts.list, { workspaceId: ws._id, status: tab });
  const counts = useQuery(api.posts.counts, { workspaceId: ws._id });
  const approve = useMutation(api.posts.approve);
  const reject = useMutation(api.posts.reject);
  const remove = useMutation(api.posts.remove);
  const duplicate = useMutation(api.posts.duplicate);
  const retry = useMutation(api.posts.retry);
  const unschedule = useMutation(api.posts.unschedule);
  const run = (p: Promise<unknown>, ok: string) => p.then(() => toast.ok(ok)).catch((e) => toast.fail(e));
  const badge: Partial<Record<Tab, number>> = { scheduled: counts?.scheduled, pending_approval: counts?.pending_approval, draft: counts?.draft, failed: counts?.failed };

  return (
    <>
      <PageHeader title="Posts" sub="Everything in this workspace, by status."
        actions={can("editor") && <>
          <button className="btn-ghost" onClick={() => setImporting(true)}><Upload size={15} /> Bulk import</button>
          <button className="btn-primary" onClick={() => compose()}>New post</button>
        </>} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}{badge[t.id] ? <span className="ml-1.5 rounded-full bg-ink/10 px-1.5 text-xs">{badge[t.id]}</span> : null}
          </button>
        ))}
      </div>
      {posts === undefined ? <Loading /> : posts.length === 0 ? (
        <Empty title="Nothing here">{tab === "scheduled" ? "Posts you schedule or add to the queue show up here in the order they go out." : tab === "pending_approval" ? "Posts waiting on an admin show up here." : "No posts with this status."}</Empty>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p._id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <StatusPill status={p.status} />
                {p.scheduledAt && <span className="font-semibold text-ink">{fmtDateTime(p.scheduledAt, ws.timezone)}</span>}
                {p.queued && <span className="pill bg-canvas">Queue</span>}
                {p.label && <span className="pill bg-gold-soft text-warn">{p.label}</span>}
                <span className="ml-auto">by {p.authorName}</span>
              </div>
              <div className="mt-2 flex gap-3">
                {p.media[0] && (
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-canvas">
                    {p.media[0].kind === "image" && p.media[0].url ? <img src={p.media[0].url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] font-semibold text-muted">Video</div>}
                  </div>
                )}
                <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{p.text || <span className="text-muted">Media only</span>}</p>
              </div>
              {p.rejectionReason && <p className="mt-2 rounded-lg bg-gold-soft px-3 py-2 text-xs text-warn">Changes requested: {p.rejectionReason}</p>}
              <ul className="mt-3 flex flex-wrap gap-2">
                {p.targets.map((t) => (
                  <li key={t._id} className="flex max-w-full items-center gap-1.5 rounded-full border border-line px-2 py-1 text-xs">
                    <PlatformBadge platform={t.platform} size={16} /> <span className="truncate">{t.channelName}</span>
                    {t.status === "failed" && <span className="font-bold text-bad" title={t.lastError ?? ""}>failed</span>}
                    {t.permalink && <a className="font-semibold text-gold hover:underline" href={t.permalink} target="_blank" rel="noopener noreferrer">view</a>}
                  </li>
                ))}
              </ul>
              {p.targets.filter((t) => t.status === "failed" && t.lastError).map((t) => (
                <p key={t._id} className="mt-2 break-words rounded-lg bg-bad/5 px-3 py-2 text-xs text-bad"><b>{t.channelName}:</b> {t.lastError}</p>
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => compose({ postId: p._id })}>{["published", "partial", "publishing"].includes(p.status) ? "View" : "Edit"}</button>
                {can("editor") && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => void run(duplicate({ postId: p._id }), "Copied to drafts.")}>Duplicate</button>}
                {can("editor") && p.status === "scheduled" && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => void run(unschedule({ postId: p._id }), "Moved to drafts.")}>Unschedule</button>}
                {can("editor") && (p.status === "failed" || p.status === "partial") && <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => void run(retry({ postId: p._id }), "Retrying.")}>Retry failed channels</button>}
                {can("admin") && p.status === "pending_approval" && <>
                  <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => void run(approve({ postId: p._id }), "Approved.")}>Approve</button>
                  <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => { setRejecting(p._id); setReason(""); }}>Request changes</button>
                </>}
                {can("editor") && p.status !== "publishing" && <ConfirmDelete onConfirm={() => void run(remove({ postId: p._id }), "Deleted.")} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rejecting && (
        <Modal title="Request changes" onClose={() => setRejecting(null)}>
          <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); void run(reject({ postId: rejecting, reason }), "Sent back to drafts."); setRejecting(null); }}>
            <label className="label" htmlFor="reason">What should change?</label>
            <textarea id="reason" className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
            <button className="btn-primary w-full">Send back</button>
          </form>
        </Modal>
      )}
      {importing && <BulkImport onClose={() => setImporting(false)} />}
    </>
  );
}

function BulkImport({ onClose }: { onClose: () => void }) {
  const { ws } = useWs();
  const toast = useToast();
  const channels = useQuery(api.channels.list, { workspaceId: ws._id });
  const bulk = useMutation(api.posts.bulkCreate);
  const [rows, setRows] = useState<{ text: string; scheduledAt?: number }[]>([]);
  const [picked, setPicked] = useState<Id<"channels">[]>([]);
  const [mode, setMode] = useState<"queue" | "schedule" | "draft">("queue");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.fail("That file is too big. Keep it under 2 MB.");
    const parsed = parseCsv(await file.text());
    const header = parsed[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const hasHeader = header.includes("text");
    const textCol = hasHeader ? header.indexOf("text") : 0;
    const dateCol = hasHeader ? header.indexOf("datetime") : 1;
    const out = parsed.slice(hasHeader ? 1 : 0).slice(0, 200).map((r) => {
      const raw = (dateCol >= 0 ? r[dateCol] : "")?.trim().replace(" ", "T") ?? "";
      const at = raw ? fromLocalInput(raw, ws.timezone) : null;
      return { text: r[textCol] ?? "", scheduledAt: at && at > Date.now() ? at : undefined };
    }).filter((r) => r.text.trim());
    setRows(out);
    if (out.some((r) => r.scheduledAt)) setMode("schedule");
  }

  async function submit() {
    setBusy(true);
    try {
      const n = await bulk({ workspaceId: ws._id, channelIds: picked, mode, rows });
      toast.ok(`${n} posts imported.`);
      onClose();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Bulk import" onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <p className="text-muted">Upload a CSV with a <b>text</b> column and an optional <b>datetime</b> column (like 2026-12-01 09:30, in {ws.timezone}). Up to 200 rows. Text only. Add media after import.</p>
        <input type="file" accept=".csv,text/csv" className="input" onChange={(e) => void onFile(e.target.files?.[0])} />
        {rows.length > 0 && (
          <>
            <p className="font-semibold">{rows.length} posts found. {rows.filter((r) => r.scheduledAt).length} have a future date.</p>
            <div>
              <div className="label">Send to</div>
              <div className="flex flex-wrap gap-2">
                {(channels?.channels ?? []).filter((c) => c.status === "active").map((c) => {
                  const on = picked.includes(c._id);
                  return (
                    <button key={c._id} aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c._id) : [...p, c._id]))}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-ink bg-ink text-white" : "border-line"}`}>
                      <PlatformBadge platform={c.platform} size={16} /> {c.displayName}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="imp-mode">Then</label>
              <select id="imp-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="queue">Add each one to the queue</option>
                <option value="schedule">Use the dates in the file (rows without a date become drafts)</option>
                <option value="draft">Save all as drafts</option>
              </select>
            </div>
            <button className="btn-primary w-full" disabled={busy || (mode !== "draft" && picked.length === 0)} onClick={() => void submit()}>{busy ? "Importing…" : `Import ${rows.length} posts`}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
