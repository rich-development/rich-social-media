import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "../../convex/shared/platforms";
import { useWs } from "../App";
import { ConfirmDelete } from "../components/Composer";
import { Empty, Loading, Modal, PageHeader, PlatformBadge, useToast } from "../components/ui";

const PROVIDER_COPY: Record<string, { title: string; platforms: Platform[]; blurb: string }> = {
  meta: { title: "Facebook + Instagram", platforms: ["facebook", "instagram"], blurb: "Connects your Facebook Pages and the Instagram business accounts linked to them." },
  threads: { title: "Threads", platforms: ["threads"], blurb: "Connects one Threads profile." },
  linkedin: { title: "LinkedIn", platforms: ["linkedin"], blurb: "Connects your personal LinkedIn profile." },
  google: { title: "YouTube", platforms: ["youtube"], blurb: "Connects your YouTube channel for video uploads." },
  tiktok: { title: "TikTok", platforms: ["tiktok"], blurb: "Connects one TikTok account for video posts." },
  pinterest: { title: "Pinterest", platforms: ["pinterest"], blurb: "Connects your Pinterest account and boards." },
  bluesky: { title: "Bluesky", platforms: ["bluesky"], blurb: "Uses an app password. No developer app needed." },
  x: { title: "X", platforms: ["x"], blurb: "Off by default. X may charge for posting through its API." },
};

export default function Channels() {
  const { ws, can } = useWs();
  const toast = useToast();
  const data = useQuery(api.channels.list, { workspaceId: ws._id });
  const startOAuth = useAction(api.channels.startOAuth);
  const connectBluesky = useAction(api.channels.connectBlueskyAccount);
  const disconnect = useMutation(api.channels.disconnect);
  const setPaused = useMutation(api.channels.setPaused);
  const [params, setParams] = useSearchParams();
  const [bluesky, setBluesky] = useState(false);
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const admin = can("admin");

  // Show the result of an OAuth round trip, then clean the address bar.
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast.ok(`${connected} channel${connected === "1" ? "" : "s"} connected.`);
    if (error) toast.fail(error.slice(0, 200));
    if (connected || error) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  async function connect(provider: string) {
    if (provider === "bluesky") return setBluesky(true);
    setBusy(provider);
    try {
      const url = await startOAuth({ workspaceId: ws._id, provider });
      // Only ever follow https links to the network's own sign-in page.
      if (!url.startsWith("https://")) throw new Error("Unexpected sign-in address");
      window.location.assign(url);
    } catch (e) {
      toast.fail(e);
      setBusy(null);
    }
  }

  async function submitBluesky(e: FormEvent) {
    e.preventDefault();
    setBusy("bluesky");
    try {
      await connectBluesky({ workspaceId: ws._id, handle, appPassword });
      toast.ok("Bluesky connected.");
      setBluesky(false); setHandle(""); setAppPassword("");
    } catch (err) {
      toast.fail(err);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <Loading />;
  const setupProvider = data.providers.find((p) => p.id === setup);

  return (
    <>
      <PageHeader title="Channels" sub="The accounts this workspace can publish to." />
      <section>
        {data.channels.length === 0 ? (
          <Empty title="No channels yet">{admin ? "Connect an account below. Bluesky is the quickest: it needs no developer app." : "Ask a workspace admin to connect accounts."}</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.channels.map((c) => (
              <li key={c._id} className="card flex items-center gap-3 p-4">
                {c.avatarUrl ? <img src={c.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" /> : <PlatformBadge platform={c.platform} size={40} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate font-semibold"><PlatformBadge platform={c.platform} size={16} /> {c.displayName}</div>
                  <div className="truncate text-xs text-muted">{PLATFORM_INFO[c.platform].label}{c.handle ? ` · @${c.handle}` : ""}</div>
                  {c.status === "needs_reauth" && <div className="mt-1 text-xs font-semibold text-bad">Needs reconnecting. {c.statusDetail}</div>}
                  {c.status === "paused" && <div className="mt-1 text-xs font-semibold text-warn">Paused. Posts to it will fail until resumed.</div>}
                </div>
                {admin && (
                  <div className="flex flex-col items-end gap-1.5">
                    {c.status === "needs_reauth"
                      ? <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => void connect(PLATFORM_INFO[c.platform].provider)}>Reconnect</button>
                      : <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => void setPaused({ channelId: c._id, paused: c.status !== "paused" }).catch((e) => toast.fail(e))}>{c.status === "paused" ? "Resume" : "Pause"}</button>}
                    <ConfirmDelete label="Disconnect" onConfirm={() => void disconnect({ channelId: c._id }).then(() => toast.ok("Disconnected."), (e) => toast.fail(e))} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {admin && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Connect a network</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.providers.map((p) => {
              const copy = PROVIDER_COPY[p.id];
              return (
                <li key={p.id} className="card flex flex-col p-4">
                  <div className="flex items-center gap-2">
                    {copy.platforms.map((pl) => <PlatformBadge key={pl} platform={pl} size={24} />)}
                    <span className="font-semibold">{copy.title}</span>
                    {!p.configured && <span className="pill ml-auto bg-canvas text-muted">Not set up</span>}
                  </div>
                  <p className="mt-2 flex-1 text-sm text-muted">{copy.blurb}</p>
                  {p.configured
                    ? <button className="btn-primary mt-3" disabled={busy === p.id} onClick={() => void connect(p.id)}>{busy === p.id ? "Opening…" : "Connect"}</button>
                    : <button className="btn-ghost mt-3" onClick={() => setSetup(p.id)}>Setup steps</button>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">Supported: {PLATFORMS.map((p) => PLATFORM_INFO[p].label).join(", ")}.</p>
        </section>
      )}

      {bluesky && (
        <Modal title="Connect Bluesky" onClose={() => setBluesky(false)}>
          <form onSubmit={submitBluesky} className="space-y-4 p-5">
            <p className="text-sm text-muted">In Bluesky, go to Settings, then Privacy and Security, then App Passwords, and create one. Use that here. Never your main password. It is stored encrypted.</p>
            <div>
              <label className="label" htmlFor="bs-handle">Handle</label>
              <input id="bs-handle" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="you.bsky.social" autoComplete="off" required />
            </div>
            <div>
              <label className="label" htmlFor="bs-pass">App password</label>
              <input id="bs-pass" type="password" className="input" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" autoComplete="off" required />
            </div>
            <button className="btn-primary w-full" disabled={busy === "bluesky"}>{busy === "bluesky" ? "Connecting…" : "Connect"}</button>
          </form>
        </Modal>
      )}

      {setupProvider && (
        <Modal title={`Set up ${PROVIDER_COPY[setupProvider.id].title}`} onClose={() => setSetup(null)}>
          <div className="space-y-3 p-5 text-sm">
            <p>This network needs a free developer app. The README has the click-by-click steps. The short version:</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Create the developer app on the network's developer site.</li>
              <li>Add this exact redirect address to the app:
                <code className="mt-1 block break-all rounded bg-canvas px-2 py-1 text-xs">{setupProvider.redirectUri}</code>
              </li>
              <li>Save the app's keys on your Convex deployment:
                {setupProvider.envVars.map((v) => <code key={v} className="mt-1 block rounded bg-canvas px-2 py-1 text-xs">npx convex env set {v} {v === "X_ENABLED" ? "true" : "your-value"}</code>)}
              </li>
              <li>Come back here and press Connect.</li>
            </ol>
          </div>
        </Modal>
      )}
    </>
  );
}
