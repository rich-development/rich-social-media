import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Plus, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { ROLES, type Role } from "../../convex/shared/platforms";
import { useWs } from "../App";
import { ConfirmDelete } from "../components/Composer";
import { Loading, PageHeader, useToast } from "../components/ui";
import { fmtDateTime } from "../lib";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including team and roles",
  admin: "Approve posts, manage channels and settings",
  editor: "Write, schedule, and manage posts and media",
  viewer: "Read only",
};

export default function Settings() {
  const { ws, can } = useWs();
  const toast = useToast();
  const update = useMutation(api.workspaces.update);
  const team = useQuery(api.workspaces.members, { workspaceId: ws._id });
  const invites = useQuery(api.workspaces.invites, can("admin") ? { workspaceId: ws._id } : "skip");
  const upcoming = useQuery(api.posts.upcomingSlots, { workspaceId: ws._id });
  const createInvite = useAction(api.workspaces.createInvite);
  const revokeInvite = useMutation(api.workspaces.revokeInvite);
  const setRole = useMutation(api.workspaces.setRole);
  const removeMember = useMutation(api.workspaces.removeMember);
  const changePassword = useMutation(api.auth.changePassword);

  const [name, setName] = useState(ws.name);
  const [timezone, setTimezone] = useState(ws.timezone);
  const [slots, setSlots] = useState(ws.queueSlots);
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviteLink, setInviteLink] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const admin = can("admin");
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [ws.timezone];

  const run = (p: Promise<unknown>, ok: string) => p.then(() => toast.ok(ok)).catch((e) => toast.fail(e));

  async function invite() {
    try {
      const { token } = await createInvite({ workspaceId: ws._id, role: inviteRole });
      setInviteLink(`${window.location.origin}/join?token=${token}`);
    } catch (e) {
      toast.fail(e);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await changePassword({ currentPassword: current, newPassword: next, signOutOtherSessions: true });
      if (result.success) { toast.ok("Password changed. Other devices were signed out."); setCurrent(""); setNext(""); }
      else toast.fail(result.userError.error === "INVALID_CREDENTIALS" ? "Your current password is not right." : result.userError.error === "RATE_LIMITED" ? "Too many tries. Wait a few minutes." : "Pick a longer, less common password.");
    } catch (err) {
      toast.fail(err);
    }
  }

  if (!team) return <Loading />;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <h2 className="font-bold">Workspace</h2>
          <div>
            <label className="label" htmlFor="s-name">Name</label>
            <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!admin} maxLength={60} />
          </div>
          <div>
            <label className="label" htmlFor="s-tz">Time zone</label>
            <select id="s-tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!admin}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">The calendar and queue run on this clock.</p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-ink" checked={ws.requireApproval} disabled={!admin}
              onChange={(e) => void run(update({ workspaceId: ws._id, requireApproval: e.target.checked }), e.target.checked ? "Approvals turned on." : "Approvals turned off.")} />
            <span><b>Review before publishing</b><br /><span className="text-muted">Posts from editors wait for an admin or owner to approve them.</span></span>
          </label>
          {admin && <button className="btn-primary" onClick={() => void run(update({ workspaceId: ws._id, name, timezone }), "Saved.")}>Save</button>}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-bold">Queue times</h2>
          <p className="text-sm text-muted">"Add to queue" drops a post into the next open time below.</p>
          <ul className="space-y-2">
            {slots.map((slot, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input type="time" className="input w-auto" value={slot.time} disabled={!admin} aria-label="Time"
                  onChange={(e) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
                <div className="flex gap-1">
                  {DAYS.map((d, day) => {
                    const on = slot.days.includes(day);
                    return (
                      <button key={day} type="button" disabled={!admin} aria-pressed={on} aria-label={DAY_NAMES[day]}
                        onClick={() => setSlots((s) => s.map((x, j) => (j === i ? { ...x, days: on ? x.days.filter((n) => n !== day) : [...x.days, day].sort() } : x)))}
                        className={`h-8 w-8 rounded-full text-xs font-bold ${on ? "bg-ink text-white" : "border border-line text-muted"}`}>{d}</button>
                    );
                  })}
                </div>
                {admin && <button className="rounded p-1 text-muted hover:bg-canvas" aria-label="Remove time" onClick={() => setSlots((s) => s.filter((_, j) => j !== i))}><X size={16} /></button>}
              </li>
            ))}
          </ul>
          {admin && (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setSlots((s) => [...s, { days: [1, 2, 3, 4, 5], time: "09:00" }])}><Plus size={15} /> Add a time</button>
              <button className="btn-primary" onClick={() => void run(update({ workspaceId: ws._id, queueSlots: slots }), "Queue times saved.")}>Save queue</button>
            </div>
          )}
          {upcoming && upcoming.length > 0 && (
            <p className="text-xs text-muted">Next open times: {upcoming.slice(0, 3).map((t) => fmtDateTime(t, ws.timezone)).join(" · ")}</p>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-bold">Team</h2>
          <ul className="divide-y divide-line">
            {team.members.map((m) => (
              <li key={m._id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{m.name ?? m.email ?? "New member"}{m.isMe && <span className="text-muted"> (you)</span>}</div>
                  <div className="truncate text-xs text-muted">{m.email}</div>
                </div>
                {can("owner") && !m.isMe ? (
                  <>
                    <select className="input w-auto py-1 text-xs" value={m.role} aria-label="Role" onChange={(e) => void run(setRole({ memberId: m._id, role: e.target.value as Role }), "Role updated.")}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <ConfirmDelete label="Remove" onConfirm={() => void run(removeMember({ memberId: m._id }), "Removed.")} />
                  </>
                ) : <span className="pill bg-canvas text-muted">{m.role}</span>}
              </li>
            ))}
          </ul>
          {admin && (
            <div className="space-y-2 rounded-lg bg-canvas p-3">
              <div className="label">Invite someone</div>
              <div className="flex gap-2">
                <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} aria-label="Role for the invite">
                  {ROLES.filter((r) => r !== "owner" || can("owner")).map((r) => <option key={r} value={r}>{r}: {ROLE_HELP[r]}</option>)}
                </select>
                <button className="btn-primary whitespace-nowrap" onClick={() => void invite()}>Create link</button>
              </div>
              {inviteLink && (
                <div className="space-y-1">
                  <input className="input font-mono text-xs" readOnly value={inviteLink} onFocus={(e) => e.target.select()} aria-label="Invite link" />
                  <p className="text-xs text-muted">Copy it now. It is shown once, works once, and expires in 7 days. Send it privately.</p>
                </div>
              )}
              {invites && invites.length > 0 && (
                <ul className="space-y-1 pt-1 text-xs">
                  {invites.map((i) => (
                    <li key={i._id} className="flex items-center gap-2">
                      <span>Open {i.role} invite, expires {fmtDateTime(i.expiresAt, ws.timezone)}</span>
                      <button className="ml-auto font-semibold text-bad hover:underline" onClick={() => void run(revokeInvite({ inviteId: i._id }), "Invite revoked.")}>Revoke</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <form onSubmit={submitPassword} className="card h-fit space-y-4 p-5">
          <h2 className="font-bold">Your password</h2>
          <div>
            <label className="label" htmlFor="pw-cur">Current password</label>
            <input id="pw-cur" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <label className="label" htmlFor="pw-new">New password</label>
            <input id="pw-new" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          </div>
          <button className="btn-primary">Change password</button>
        </form>
      </div>
    </>
  );
}
