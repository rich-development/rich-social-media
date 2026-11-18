import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { PLATFORM_INFO, type Platform } from "../../convex/shared/platforms";
import type { Id } from "../../convex/_generated/dataModel";
import { errMsg, fmtDateTime, PLATFORM_MARK, STATUS_LABEL, STATUS_STYLE } from "../lib";

type Toast = { id: number; text: string; bad: boolean };
const ToastCtx = createContext<{ ok: (t: string) => void; fail: (e: unknown) => void }>({ ok: () => {}, fail: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 7000 : 3500);
  }, []);
  const ok = useCallback((t: string) => push(t, false), [push]);
  const fail = useCallback((e: unknown) => push(typeof e === "string" ? e : errMsg(e), true), [push]);
  return (
    <ToastCtx.Provider value={{ ok, fail }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${t.bad ? "bg-bad" : "bg-ink"}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function PlatformBadge({ platform, size = 24 }: { platform: Platform; size?: number }) {
  return (
    <span
      title={PLATFORM_INFO[platform].label}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: PLATFORM_INFO[platform].color }}
    >
      {PLATFORM_MARK[platform]}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_STYLE[status] ?? "bg-canvas text-muted"}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`card w-full ${wide ? "max-w-5xl" : "max-w-lg"} shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button className="rounded p-1 text-muted hover:bg-canvas" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card border-dashed px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="p-10 text-center text-sm text-muted">Loading…</div>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export type ActivityItem = { _id: string; at: number; action: string; detail: string | null; level: "info" | "error"; who: string | null; postId: Id<"posts"> | null };

/** Compact activity rows. A row tied to a post opens that post. */
export function ActivityList({ items, tz, onOpen }: { items: ActivityItem[]; tz: string; onOpen: (postId: Id<"posts">) => void }) {
  if (items.length === 0) return <div className="card p-4 text-sm text-muted">Nothing here yet.</div>;
  return (
    <ul className="card divide-y divide-line">
      {items.map((a) => {
        const body = (
          <>
            <div className="flex items-baseline gap-2">
              <span className={`mt-1 h-2 w-2 shrink-0 self-start rounded-full ${a.level === "error" ? "bg-bad" : "bg-line"}`} aria-hidden />
              <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${a.level === "error" ? "text-bad" : ""}`}>{a.action}</span>
              <span className="shrink-0 text-xs text-muted">{fmtDateTime(a.at, tz)}</span>
            </div>
            {(a.detail || a.who) && (
              <div className={`ml-4 mt-0.5 text-xs text-muted ${a.level === "error" ? "break-words" : "truncate"}`}>
                {[a.who, a.detail].filter(Boolean).join(" · ")}
              </div>
            )}
          </>
        );
        return (
          <li key={a._id}>
            {a.postId
              ? <button className="block w-full px-3 py-2.5 text-left hover:bg-canvas" onClick={() => onOpen(a.postId!)}>{body}</button>
              : <div className="px-3 py-2.5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
