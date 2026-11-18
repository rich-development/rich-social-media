import { createContext, useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuth, useClerk, UserButton, useUser } from "@clerk/react";
import { BarChart3, CalendarDays, FolderOpen, LayoutDashboard, ListChecks, LogOut, PenSquare, Radio, Settings as Cog } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { roleAtLeast, type Role } from "../convex/shared/platforms";
import Composer from "./components/Composer";
import { Loading, useToast } from "./components/ui";
import { errMsg } from "./lib";
import Activity from "./pages/Activity";
import Analytics from "./pages/Analytics";
import Auth from "./pages/Auth";
import Calendar from "./pages/Calendar";
import Channels from "./pages/Channels";
import Dashboard from "./pages/Dashboard";
import { Privacy, Terms } from "./pages/Legal";
import Library from "./pages/Library";
import Posts from "./pages/Posts";
import Settings from "./pages/Settings";

export type Workspace = Doc<"workspaces"> & { role: Role };
type ComposeOpts = { postId?: Id<"posts">; at?: number };
const WsCtx = createContext<{ ws: Workspace; can: (min: Role) => boolean; compose: (o?: ComposeOpts) => void } | null>(null);
export function useWs() {
  const ctx = useContext(WsCtx);
  if (!ctx) throw new Error("No workspace");
  return ctx;
}

const INVITE_KEY = "rs.invite";
function takeInviteFromUrl() {
  const url = new URL(window.location.href);
  if (url.pathname === "/join" && url.searchParams.get("token")) {
    sessionStorage.setItem(INVITE_KEY, url.searchParams.get("token")!);
    // Drop the token from the address bar and history.
    window.history.replaceState(null, "", "/");
  }
}
takeInviteFromUrl();

export default function App() {
  // Public pages, readable without signing in.
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/privacy") return <Privacy />;
  if (path === "/terms") return <Terms />;
  return <Gate />;
}

function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isSignedIn } = useAuth();
  if (isLoading) return <Connecting what="Connecting to the backend" />;
  // Clerk says yes but Convex says no: a setup mismatch, not a login problem.
  if (!isAuthenticated && isSignedIn) return <Trouble kind="rejected" />;
  if (!isAuthenticated) return <Auth invited={!!sessionStorage.getItem(INVITE_KEY)} />;
  return <Signed />;
}

/** A loading state that explains itself instead of hanging forever. */
function Connecting({ what }: { what: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  if (slow) return <Trouble kind="unreachable" what={what} />;
  return <Loading />;
}

function Trouble({ kind, what }: { kind: "rejected" | "unreachable"; what?: string }) {
  const { signOut } = useClerk();
  const backend = (() => {
    try { return new URL(import.meta.env.VITE_CONVEX_URL as string).host; } catch { return "(not a valid address)"; }
  })();
  return (
    <div className="mx-auto mt-20 max-w-xl card p-8 text-sm">
      <h1 className="h1">{kind === "rejected" ? "Signed in, but the backend did not accept it" : "Still waiting on the backend"}</h1>
      <p className="mt-2 text-muted">
        {kind === "rejected"
          ? "Clerk signed you in. Convex refused the sign-in token. This is a setup mismatch."
          : `Stuck on: ${what}. The app cannot finish talking to Convex.`}
      </p>
      <p className="mt-4 font-semibold">This site is pointed at: <code className="rounded bg-canvas px-1">{backend}</code></p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
        {kind === "unreachable" && <li>That should be your Convex <b>dev</b> address and end in <code>.convex.cloud</code> (not <code>.convex.site</code>). It comes from <code>VITE_CONVEX_URL</code> in Netlify. Changing it needs a new deploy.</li>}
        <li>The latest backend must be pushed: <code className="rounded bg-canvas px-1">npx convex dev --once</code> should end without errors.</li>
        <li><code>CLERK_JWT_ISSUER_DOMAIN</code> on that same Convex deployment must exactly match the Clerk Frontend API URL for the Clerk instance whose key this site uses. No trailing slash.</li>
        <li>The Convex integration must be on in that same Clerk instance.</li>
      </ul>
      <p className="mt-4 text-muted">The browser console (right-click, Inspect, Console) usually names the exact problem.</p>
      <div className="mt-5 flex gap-2">
        <button className="btn-primary" onClick={() => window.location.reload()}>Try again</button>
        <button className="btn-ghost" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}

function Signed() {
  const me = useQuery(api.users.me);
  const store = useMutation(api.users.store);
  const { user } = useUser();
  const [registered, setRegistered] = useState(false);
  const listing = useQuery(api.workspaces.list, registered ? {} : "skip");
  const acceptInvite = useAction(api.workspaces.acceptInvite);
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem("rs.ws"));
  const [joining, setJoining] = useState(() => !!sessionStorage.getItem(INVITE_KEY));

  // First thing after sign-in: make sure the backend knows this person,
  // then redeem a pending invite if there is one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Name and email from Clerk, used only to label things on screen.
        await store({
          displayName: user?.fullName ?? user?.firstName ?? undefined,
          displayEmail: user?.primaryEmailAddress?.emailAddress ?? undefined,
        });
        const token = sessionStorage.getItem(INVITE_KEY);
        if (token) {
          sessionStorage.removeItem(INVITE_KEY);
          pick(await acceptInvite({ token }));
          toast.ok("You joined the workspace.");
        }
      } catch (e) {
        toast.fail(e);
      } finally {
        if (!cancelled) { setRegistered(true); setJoining(false); }
      }
    })();
    return () => { cancelled = true; };
    // Runs once after sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(id: string) {
    localStorage.setItem("rs.ws", id);
    setSelected(id);
  }

  if (!registered) return <Connecting what="Registering your account with the backend" />;
  if (listing === undefined || joining) return <Connecting what="Loading your workspaces" />;
  if (listing.workspaces.length === 0) return <Onboarding canCreate={listing.canCreate} onReady={pick} />;
  const ws = (listing.workspaces.find((w) => w._id === selected) ?? listing.workspaces[0]) as Workspace;
  return <Shell key={ws._id} ws={ws} all={listing.workspaces as Workspace[]} canCreate={listing.canCreate} onPick={pick} userLabel={me?.name ?? me?.email ?? ""} />;
}

function Onboarding({ canCreate, onReady }: { canCreate: boolean; onReady: (id: string) => void }) {
  const create = useMutation(api.workspaces.create);
  const acceptInvite = useAction(api.workspaces.acceptInvite);
  const { signOut } = useClerk();
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (canCreate) onReady(await create({ name, timezone: tz }));
      else {
        const token = link.includes("token=") ? new URL(link.trim()).searchParams.get("token") ?? "" : link.trim();
        onReady(await acceptInvite({ token }));
      }
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-md card p-8">
      <h1 className="h1">{canCreate ? "Name your first workspace" : "You need an invite"}</h1>
      <p className="mt-2 text-sm text-muted">
        {canCreate
          ? "A workspace holds one brand: its channels, posts, queue, and team. You can add more later."
          : "Ask a workspace owner for an invite link, then paste it here."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {canCreate ? (
          <div>
            <label className="label" htmlFor="ws">Workspace name</label>
            <input id="ws" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rich Coaching and Consulting" maxLength={60} required />
            <p className="mt-1 text-xs text-muted">Time zone: {tz}. You can change it in Settings.</p>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="inv">Invite link</label>
            <input id="inv" className="input" value={link} onChange={(e) => setLink(e.target.value)} required />
          </div>
        )}
        {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary flex-1">{canCreate ? "Create workspace" : "Join"}</button>
          <button type="button" className="btn-ghost" onClick={() => void signOut()}>Sign out</button>
        </div>
      </form>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/posts", label: "Posts", icon: ListChecks },
  { to: "/library", label: "Library", icon: FolderOpen },
  { to: "/channels", label: "Channels", icon: Radio },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Cog },
];

function Shell({ ws, all, canCreate, onPick, userLabel }: { ws: Workspace; all: Workspace[]; canCreate: boolean; onPick: (id: string) => void; userLabel: string }) {
  const [composer, setComposer] = useState<ComposeOpts | null>(null);
  const counts = useQuery(api.posts.counts, { workspaceId: ws._id });
  const create = useMutation(api.workspaces.create);
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const toast = useToast();
  const ctx = useMemo(() => ({
    ws, can: (min: Role) => roleAtLeast(ws.role, min), compose: (o: ComposeOpts = {}) => setComposer(o),
  }), [ws]);
  const attention = (counts?.pending_approval ?? 0) + (counts?.failed ?? 0);

  async function addWorkspace() {
    const name = window.prompt("Name for the new workspace (one per brand):");
    if (!name?.trim()) return;
    try {
      onPick(await create({ name, timezone: ws.timezone }));
      navigate("/");
    } catch (e) {
      toast.fail(e);
    }
  }

  return (
    <WsCtx.Provider value={ctx}>
      <div className="flex min-h-full">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink p-4 text-white md:flex">
          <div className="px-2 text-lg font-bold tracking-tight">Rich Social</div>
          <label className="mt-5 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/40" htmlFor="ws-pick">Workspace</label>
          <select
            id="ws-pick" value={ws._id}
            onChange={(e) => (e.target.value === "__new" ? void addWorkspace() : onPick(e.target.value))}
            className="mt-1 rounded-lg border border-white/15 bg-ink-soft px-2 py-2 text-sm font-semibold outline-none"
          >
            {all.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
            {canCreate && <option value="__new">+ New workspace…</option>}
          </select>
          {ctx.can("editor") && (
            <button className="btn-gold mt-4 w-full" onClick={() => setComposer({})}><PenSquare size={16} /> New post</button>
          )}
          <nav className="mt-5 flex flex-1 flex-col gap-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === "/"}
                className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
                <Icon size={17} /> {label}
                {to === "/posts" && attention > 0 && <span className="ml-auto rounded-full bg-gold px-1.5 text-[11px] font-bold">{attention}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-white/10 pt-3">
            <div className="flex items-center gap-2 px-2">
              <UserButton />
              <div className="min-w-0 truncate text-xs text-white/50">{userLabel} · {ws.role}</div>
            </div>
            <button className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white" onClick={() => void signOut()}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 overflow-x-auto bg-ink p-2 text-white md:hidden">
            {NAV.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold ${isActive ? "bg-white/15" : "text-white/60"}`}>{label}</NavLink>
            ))}
            {ctx.can("editor") && <button className="ml-auto whitespace-nowrap rounded-md bg-gold px-2.5 py-1.5 text-xs font-bold" onClick={() => setComposer({})}>New post</button>}
          </div>
          <main className="mx-auto max-w-6xl p-5 sm:p-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/posts" element={<Posts />} />
              <Route path="/library" element={<Library />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </main>
        </div>
      </div>
      {composer && <Composer postId={composer.postId} at={composer.at} onClose={() => setComposer(null)} />}
    </WsCtx.Provider>
  );
}
