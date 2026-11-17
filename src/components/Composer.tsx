import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Clock, Hash, ImagePlus, LayoutTemplate, Send, Trash2, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { charCount, PLATFORM_INFO, validateForPlatform } from "../../convex/shared/platforms";
import { useWs } from "../App";
import { fmtDateTime, fromLocalInput, toLocalInput } from "../lib";
import { Loading, Modal, PlatformBadge, StatusPill, useToast } from "./ui";

type Options = { title?: string; link?: string; boardId?: string; privacy?: "public" | "unlisted" | "private" };
type PerChannel = { text?: string; firstComment?: string; options?: Options };

export async function uploadFiles(
  files: File[], getUrl: () => Promise<string>, save: (a: { storageId: Id<"_storage">; name: string }) => Promise<Id<"media">>,
): Promise<Id<"media">[]> {
  const ids: Id<"media">[] = [];
  for (const file of files) {
    const res = await fetch(await getUrl(), { method: "POST", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw new Error("Upload failed");
    const { storageId } = await res.json();
    ids.push(await save({ storageId, name: file.name }));
  }
  return ids;
}

export default function Composer({ postId, at, onClose }: { postId?: Id<"posts">; at?: number; onClose: () => void }) {
  const { ws, can } = useWs();
  const toast = useToast();
  const existing = useQuery(api.posts.get, postId ? { postId } : "skip");
  const channelData = useQuery(api.channels.list, { workspaceId: ws._id });
  const library = useQuery(api.library.list, { workspaceId: ws._id });
  const mediaLib = useQuery(api.media.list, { workspaceId: ws._id });
  const slots = useQuery(api.posts.upcomingSlots, { workspaceId: ws._id });
  const save = useMutation(api.posts.save);
  const genUrl = useMutation(api.media.generateUploadUrl);
  const saveMedia = useMutation(api.media.save);

  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Id<"channels">[]>([]);
  const [per, setPer] = useState<Record<string, PerChannel>>({});
  const [mediaIds, setMediaIds] = useState<Id<"media">[]>([]);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState(() => toLocalInput(at ?? Date.now() + 60 * 60 * 1000, ws.timezone));
  const [tab, setTab] = useState<"base" | Id<"channels">>("base");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const loaded = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!existing || loaded.current) return;
    loaded.current = true;
    setText(existing.text);
    setPicked(existing.targets.map((t) => t.channelId));
    setPer(Object.fromEntries(existing.targets.map((t) => [t.channelId, {
      text: t.text ?? undefined, firstComment: t.firstComment ?? undefined, options: t.options ?? undefined,
    }])));
    setMediaIds(existing.media.map((m) => m._id));
    setLabel(existing.label ?? "");
    setNotes(existing.notes ?? "");
    if (existing.scheduledAt) setWhen(toLocalInput(existing.scheduledAt, ws.timezone));
  }, [existing, ws.timezone]);

  const channels = useMemo(() => channelData?.channels ?? [], [channelData]);
  const selected = channels.filter((c) => picked.includes(c._id));
  const media = (mediaLib ?? []).filter((m) => mediaIds.includes(m._id)).sort((a, b) => mediaIds.indexOf(a._id) - mediaIds.indexOf(b._id));
  const readOnly = !!existing && !["draft", "pending_approval", "scheduled", "failed"].includes(existing.status);
  const needsApproval = ws.requireApproval && !can("admin");
  const textFor = (id: string) => per[id]?.text ?? text;
  const problems = selected.map((c) => ({ channel: c, issues: validateForPlatform(c.platform, textFor(c._id).trim(), media) }));
  const blocked = problems.some((p) => p.issues.some((i) => !i.includes("will be skipped")));

  if (postId && existing === undefined) return <Modal title="Post" onClose={onClose}><Loading /></Modal>;

  const setChannel = (id: string, patch: PerChannel) => setPer((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const setOption = (id: string, patch: Options) => setChannel(id, { options: { ...per[id]?.options, ...patch } });
  const activeText = tab === "base" ? text : textFor(tab);
  const setActiveText = (value: string) => (tab === "base" ? setText(value) : setChannel(tab, { text: value }));
  // Hashtags and templates land as their own paragraph, ready to copy anywhere.
  const append = (extra: string) => setActiveText(activeText.trim() ? `${activeText.trimEnd()}\n\n${extra}` : extra);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const ids = await uploadFiles([...files], () => genUrl({ workspaceId: ws._id }), (a) => saveMedia({ workspaceId: ws._id, ...a }));
      setMediaIds((m) => [...m, ...ids]);
    } catch (e) {
      toast.fail(e);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(mode: "draft" | "schedule" | "queue" | "now") {
    let scheduledAt: number | undefined;
    if (mode === "schedule" || (mode === "draft" && when)) scheduledAt = fromLocalInput(when, ws.timezone) ?? undefined;
    setBusy(true);
    try {
      const result = await save({
        workspaceId: ws._id, postId, text, mediaIds, mode, scheduledAt,
        label: label || undefined, notes: notes || undefined,
        targets: selected.map((c) => {
          const p = per[c._id] ?? {};
          const options = Object.fromEntries(Object.entries(p.options ?? {}).filter(([, v]) => v));
          return {
            channelId: c._id,
            text: p.text !== undefined && p.text !== text ? p.text : undefined,
            firstComment: p.firstComment || undefined,
            options: Object.keys(options).length ? (options as Options) : undefined,
          };
        }),
      });
      toast.ok(result.status === "draft" ? "Draft saved." : result.status === "pending_approval" ? "Sent for approval." : mode === "now" ? "Publishing now." : "Scheduled.");
      onClose();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const activeChannel = tab === "base" ? null : channels.find((c) => c._id === tab);
  const limit = activeChannel ? PLATFORM_INFO[activeChannel.platform].maxChars : selected.length ? Math.min(...selected.map((c) => PLATFORM_INFO[c.platform].maxChars)) : null;
  const count = charCount(activeText);

  return (
    <Modal title={postId ? "Edit post" : "New post"} onClose={onClose} wide>
      <div className="grid gap-0 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5 p-5">
          {existing && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={existing.status} />
              {existing.rejectionReason && <span className="rounded-lg bg-gold-soft px-2 py-1 text-warn">Changes requested: {existing.rejectionReason}</span>}
            </div>
          )}

          <section>
            <div className="label">Channels</div>
            {channels.length === 0 ? (
              <p className="text-sm text-muted">No channels connected yet. You can still save drafts. Connect accounts on the Channels page.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {channels.map((c) => {
                  const on = picked.includes(c._id);
                  const off = c.status !== "active";
                  return (
                    <button key={c._id} type="button" disabled={readOnly} aria-pressed={on}
                      onClick={() => { setPicked((p) => (on ? p.filter((x) => x !== c._id) : [...p, c._id])); if (on && tab === c._id) setTab("base"); }}
                      className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-sm font-medium ${on ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/40"} ${off ? "opacity-60" : ""}`}>
                      <PlatformBadge platform={c.platform} size={20} /> {c.displayName}
                      {off && <span className="text-[11px] font-bold uppercase">{c.status === "paused" ? "paused" : "reconnect"}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-center gap-1 border-b border-line">
              <button type="button" onClick={() => setTab("base")} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === "base" ? "border-ink" : "border-transparent text-muted"}`}>All channels</button>
              {selected.map((c) => (
                <button key={c._id} type="button" onClick={() => setTab(c._id)}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === c._id ? "border-ink" : "border-transparent text-muted"}`}>
                  <PlatformBadge platform={c.platform} size={16} /> {c.displayName}
                  {per[c._id]?.text !== undefined && per[c._id]?.text !== text && <span className="h-1.5 w-1.5 rounded-full bg-gold" title="Customized" />}
                </button>
              ))}
            </div>
            <textarea
              className="input mt-3 min-h-44 resize-y leading-relaxed" value={activeText} readOnly={readOnly}
              onChange={(e) => setActiveText(e.target.value)}
              placeholder={tab === "base" ? "Write your post. This goes to every channel unless you customize one." : "Customize the caption for this channel."}
              aria-label="Post text"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {!readOnly && (
                <>
                  <Menu icon={<Hash size={14} />} label="Hashtags" empty="Save hashtag sets in the Library."
                    items={(library?.hashtagSets ?? []).map((h) => ({ key: h._id, label: h.name, onPick: () => append(h.tags) }))} />
                  <Menu icon={<LayoutTemplate size={14} />} label="Templates" empty="Save caption templates in the Library."
                    items={(library?.templates ?? []).map((t) => ({ key: t._id, label: t.name, onPick: () => append(t.text) }))} />
                  {tab !== "base" && per[tab]?.text !== undefined && (
                    <button type="button" className="text-xs font-semibold text-gold hover:underline" onClick={() => setChannel(tab, { text: undefined })}>Reset to the main caption</button>
                  )}
                </>
              )}
              <span className={`ml-auto text-xs font-semibold tabular-nums ${limit !== null && count > limit ? "text-bad" : "text-muted"}`}>
                {count}{limit !== null ? ` / ${limit}` : ""}
              </span>
            </div>

            {activeChannel && !readOnly && (
              <div className="mt-3 grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-2">
                {PLATFORM_INFO[activeChannel.platform].note && <p className="text-xs text-muted sm:col-span-2">{PLATFORM_INFO[activeChannel.platform].note}</p>}
                {PLATFORM_INFO[activeChannel.platform].supportsFirstComment && (
                  <div className="sm:col-span-2">
                    <label className="label">First comment</label>
                    <input className="input" value={per[activeChannel._id]?.firstComment ?? ""} onChange={(e) => setChannel(activeChannel._id, { firstComment: e.target.value })} placeholder="Good place for hashtags or a link" />
                  </div>
                )}
                {["youtube", "pinterest", "linkedin"].includes(activeChannel.platform) && (
                  <div>
                    <label className="label">Title</label>
                    <input className="input" maxLength={100} value={per[activeChannel._id]?.options?.title ?? ""} onChange={(e) => setOption(activeChannel._id, { title: e.target.value })} />
                  </div>
                )}
                {["facebook", "pinterest", "linkedin"].includes(activeChannel.platform) && (
                  <div>
                    <label className="label">Link</label>
                    <input className="input" type="url" value={per[activeChannel._id]?.options?.link ?? ""} onChange={(e) => setOption(activeChannel._id, { link: e.target.value })} placeholder="https://" />
                  </div>
                )}
                {activeChannel.platform === "pinterest" && (
                  <div>
                    <label className="label">Board</label>
                    <select className="input" value={per[activeChannel._id]?.options?.boardId ?? ""} onChange={(e) => setOption(activeChannel._id, { boardId: e.target.value })}>
                      <option value="">Pick a board</option>
                      {(activeChannel.boards ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
                {["youtube", "tiktok"].includes(activeChannel.platform) && (
                  <div>
                    <label className="label">Visibility</label>
                    <select className="input" value={per[activeChannel._id]?.options?.privacy ?? "public"} onChange={(e) => setOption(activeChannel._id, { privacy: e.target.value as Options["privacy"] })}>
                      <option value="public">Public</option>
                      {activeChannel.platform === "youtube" && <option value="unlisted">Unlisted</option>}
                      <option value="private">Private</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <div className="label">Media</div>
            <div className="flex flex-wrap gap-2">
              {media.map((m) => (
                <div key={m._id} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-line bg-canvas">
                  {m.kind === "image" && m.url ? <img src={m.url} alt={m.alt || m.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs font-semibold text-muted">Video</div>}
                  {!readOnly && (
                    <button type="button" aria-label={`Remove ${m.name}`} onClick={() => setMediaIds((ids) => ids.filter((x) => x !== m._id))}
                      className="absolute right-1 top-1 rounded-full bg-ink/80 p-0.5 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <>
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}
                    className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs font-semibold text-muted hover:border-ink/40">
                    <ImagePlus size={18} /> {uploading ? "Uploading…" : "Upload"}
                  </button>
                  <button type="button" onClick={() => setShowLibrary((s) => !s)} className="h-20 rounded-lg border border-dashed border-line px-3 text-xs font-semibold text-muted hover:border-ink/40">From library</button>
                  <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => void onFiles(e.target.files)} />
                </>
              )}
            </div>
            {showLibrary && (
              <div className="mt-2 grid max-h-44 grid-cols-6 gap-2 overflow-y-auto rounded-lg bg-canvas p-2 sm:grid-cols-8">
                {(mediaLib ?? []).filter((m) => !mediaIds.includes(m._id)).map((m) => (
                  <button key={m._id} type="button" title={m.name} onClick={() => setMediaIds((ids) => [...ids, m._id])} className="aspect-square overflow-hidden rounded border border-line bg-white">
                    {m.kind === "image" && m.url ? <img src={m.url} alt={m.alt || m.name} className="h-full w-full object-cover" /> : <span className="text-[10px] font-semibold text-muted">Video</span>}
                  </button>
                ))}
                {(mediaLib ?? []).length === 0 && <p className="col-span-full p-2 text-xs text-muted">Nothing in the library yet.</p>}
              </div>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-label">Label</label>
              <input id="c-label" className="input" value={label} maxLength={40} readOnly={readOnly} onChange={(e) => setLabel(e.target.value)} placeholder="Campaign or series" />
            </div>
            <div>
              <label className="label" htmlFor="c-notes">Team notes</label>
              <input id="c-notes" className="input" value={notes} readOnly={readOnly} onChange={(e) => setNotes(e.target.value)} placeholder="Not published. For your team only." />
            </div>
          </section>
        </div>

        <aside className="space-y-4 border-t border-line bg-canvas/60 p-5 lg:border-l lg:border-t-0">
          <div>
            <div className="label">Checks</div>
            {selected.length === 0 && <p className="text-sm text-muted">Pick channels to see how the post fits each one.</p>}
            <ul className="space-y-2">
              {problems.map(({ channel, issues }) => (
                <li key={channel._id} className="rounded-lg border border-line bg-white p-2.5 text-sm">
                  <div className="flex items-center gap-2 font-semibold"><PlatformBadge platform={channel.platform} size={18} /> {channel.displayName}
                    <span className={`ml-auto text-xs ${issues.length ? "text-bad" : "text-ok"}`}>{issues.length ? "Fix" : "Ready"}</span>
                  </div>
                  {issues.map((i) => <p key={i} className="mt-1 text-xs text-bad">{i}</p>)}
                  {existing?.targets.find((t) => t.channelId === channel._id)?.lastError && (
                    <p className="mt-1 break-words text-xs text-bad">Last try: {existing.targets.find((t) => t.channelId === channel._id)!.lastError}</p>
                  )}
                  {existing?.targets.find((t) => t.channelId === channel._id)?.permalink && (
                    <a className="mt-1 block text-xs font-semibold text-gold hover:underline" target="_blank" rel="noopener noreferrer" href={existing.targets.find((t) => t.channelId === channel._id)!.permalink!}>View live post</a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {!readOnly && can("editor") && (
            <div className="space-y-3">
              <div className="label">When</div>
              {needsApproval && <p className="rounded-lg bg-gold-soft px-3 py-2 text-xs text-warn">This workspace reviews posts first. Yours will go to an admin for approval.</p>}
              <button className="btn-gold w-full" disabled={busy || blocked || selected.length === 0 || !slots?.length} onClick={() => void submit("queue")}>
                <Clock size={16} /> Add to queue
              </button>
              <p className="-mt-1 text-xs text-muted">{slots?.length ? `Next open time: ${fmtDateTime(slots[0], ws.timezone)}` : "No queue times set. Add them in Settings."}</p>
              <div>
                <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Date and time" />
                <p className="mt-1 text-xs text-muted">Times are in {ws.timezone}.</p>
                <button className="btn-primary mt-2 w-full" disabled={busy || blocked || selected.length === 0} onClick={() => void submit("schedule")}>Schedule for this time</button>
              </div>
              <button className="btn-ghost w-full" disabled={busy || blocked || selected.length === 0} onClick={() => void submit("now")}><Send size={15} /> {needsApproval ? "Send for approval" : "Post now"}</button>
              <button className="btn-ghost w-full" disabled={busy} onClick={() => void submit("draft")}>Save as draft</button>
            </div>
          )}
          {readOnly && <p className="text-sm text-muted">This post has already gone out, so it can't be edited. Duplicate it from the Posts page to reuse it.</p>}
        </aside>
      </div>
    </Modal>
  );
}

function Menu({ icon, label, items, empty }: { icon: React.ReactNode; label: string; empty: string; items: { key: string; label: string; onPick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="btn-ghost px-2.5 py-1 text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{icon} {label}</button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-line bg-white p-1 shadow-lg">
          {items.length === 0 && <p className="p-2 text-xs text-muted">{empty}</p>}
          {items.map((i) => (
            <button key={i.key} type="button" className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-canvas" onClick={() => { i.onPick(); setOpen(false); }}>{i.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfirmDelete({ onConfirm, label = "Delete" }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <button className="btn-danger px-2.5 py-1 text-xs" onClick={onConfirm} onBlur={() => setArmed(false)}>Sure?</button>
  ) : (
    <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setArmed(true)} aria-label={label}><Trash2 size={13} /> {label}</button>
  );
}
