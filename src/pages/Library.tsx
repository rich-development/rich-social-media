import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useWs } from "../App";
import { ConfirmDelete, uploadFiles } from "../components/Composer";
import { Empty, Loading, PageHeader, useToast } from "../components/ui";
import { fmtSize } from "../lib";

export default function Library() {
  const { ws, can } = useWs();
  const toast = useToast();
  const [tab, setTab] = useState<"media" | "hashtags" | "templates">("media");
  const media = useQuery(api.media.list, { workspaceId: ws._id });
  const lib = useQuery(api.library.list, { workspaceId: ws._id });
  const genUrl = useMutation(api.media.generateUploadUrl);
  const saveMedia = useMutation(api.media.save);
  const removeMedia = useMutation(api.media.remove);
  const setAlt = useMutation(api.media.setAlt);
  const saveSet = useMutation(api.library.saveHashtagSet);
  const removeSet = useMutation(api.library.removeHashtagSet);
  const saveTemplate = useMutation(api.library.saveTemplate);
  const removeTemplate = useMutation(api.library.removeTemplate);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const editable = can("editor");

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      await uploadFiles([...files], () => genUrl({ workspaceId: ws._id }), (a) => saveMedia({ workspaceId: ws._id, ...a }));
      toast.ok("Uploaded.");
    } catch (e) {
      toast.fail(e);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (tab === "hashtags") await saveSet({ workspaceId: ws._id, id: (editing ?? undefined) as Id<"hashtagSets"> | undefined, name, tags: body });
      else await saveTemplate({ workspaceId: ws._id, id: (editing ?? undefined) as Id<"templates"> | undefined, name, text: body });
      setName(""); setBody(""); setEditing(null);
      toast.ok("Saved.");
    } catch (err) {
      toast.fail(err);
    }
  }
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.ok("Copied."), () => toast.fail("Could not copy."));

  if (!media || !lib) return <Loading />;
  const items = tab === "hashtags" ? lib.hashtagSets.map((h) => ({ id: h._id as string, name: h.name, body: h.tags })) : lib.templates.map((t) => ({ id: t._id as string, name: t.name, body: t.text }));

  return (
    <>
      <PageHeader title="Library" sub="Media, hashtag sets, and caption templates you reuse."
        actions={tab === "media" && editable && <>
          <button className="btn-primary" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? "Uploading…" : "Upload media"}</button>
          <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => void upload(e.target.files)} />
        </>} />
      <div className="mb-4 flex gap-1 border-b border-line">
        {(["media", "hashtags", "templates"] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setEditing(null); setName(""); setBody(""); }} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold capitalize ${tab === t ? "border-ink" : "border-transparent text-muted"}`}>{t === "hashtags" ? "Hashtag sets" : t}</button>
        ))}
      </div>

      {tab === "media" && (media.length === 0 ? (
        <Empty title="No media yet">Upload images (up to 15 MB) and videos (up to 250 MB). JPG, PNG, WebP, GIF, MP4, MOV, WebM.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => (
            <div key={m._id} className="card overflow-hidden">
              <div className="aspect-square bg-canvas">
                {m.url && (m.kind === "image" ? <img src={m.url} alt={m.alt || m.name} className="h-full w-full object-cover" loading="lazy" /> : <video src={m.url} className="h-full w-full object-cover" controls preload="metadata" />)}
              </div>
              <div className="space-y-2 p-2.5">
                <div className="truncate text-xs font-semibold" title={m.name}>{m.name}</div>
                <div className="text-[11px] text-muted">{m.kind} · {fmtSize(m.size)}</div>
                {editable && (
                  <>
                    <input className="input px-2 py-1 text-xs" defaultValue={m.alt} placeholder="Alt text (describe it)" maxLength={1000}
                      onBlur={(e) => e.target.value !== m.alt && void setAlt({ mediaId: m._id, alt: e.target.value }).catch((err) => toast.fail(err))} />
                    <ConfirmDelete onConfirm={() => void removeMedia({ mediaId: m._id }).then(() => toast.ok("Deleted."), (e) => toast.fail(e))} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab !== "media" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            {items.length === 0 && <Empty title={tab === "hashtags" ? "No hashtag sets yet" : "No templates yet"}>{tab === "hashtags" ? "Save a group of hashtags once, then drop it into any post with one click." : "Save captions or caption skeletons you reuse, like a weekly series opener."}</Empty>}
            {items.map((i) => (
              <div key={i.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <div className="font-semibold">{i.name}</div>
                  <div className="ml-auto flex gap-2">
                    <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => void copy(i.body)}><Copy size={13} /> Copy</button>
                    {editable && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => { setEditing(i.id); setName(i.name); setBody(i.body); }}>Edit</button>}
                    {editable && <ConfirmDelete onConfirm={() => void (tab === "hashtags" ? removeSet({ id: i.id as Id<"hashtagSets"> }) : removeTemplate({ id: i.id as Id<"templates"> })).catch((e) => toast.fail(e))} />}
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{i.body}</p>
              </div>
            ))}
          </div>
          {editable && (
            <form onSubmit={submit} className="card h-fit space-y-3 p-4">
              <div className="font-semibold">{editing ? "Edit" : "New"} {tab === "hashtags" ? "hashtag set" : "template"}</div>
              <div>
                <label className="label" htmlFor="lib-name">Name</label>
                <input id="lib-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
              </div>
              <div>
                <label className="label" htmlFor="lib-body">{tab === "hashtags" ? "Hashtags" : "Text"}</label>
                <textarea id="lib-body" className="input min-h-32" value={body} onChange={(e) => setBody(e.target.value)} required
                  placeholder={tab === "hashtags" ? "leadership, purpose, #coaching" : "Caption text"} />
                {tab === "hashtags" && <p className="mt-1 text-xs text-muted">Separate with spaces or commas. They are saved as one paragraph, ready to paste.</p>}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary flex-1">Save</button>
                {editing && <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setName(""); setBody(""); }}>Cancel</button>}
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
