import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { useSignInWithUsernamePassword, useSignUpWithUsernamePassword } from "@convex-dev/auth/methods/username-password/react";
import { api } from "../../convex/_generated/api";

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "That email and password do not match.",
  USER_NOT_FOUND: "That email and password do not match.",
  RATE_LIMITED: "Too many tries. Wait a few minutes and try again.",
  PASSWORD_TOO_SHORT: "Use a longer password.",
  PASSWORD_TOO_LONG: "That password is too long.",
  PASSWORD_TOO_COMMON: "That password is too common. Pick something harder to guess.",
  PASSWORD_HAS_SURROUNDING_WHITESPACE: "Passwords cannot start or end with a space.",
  USERNAME_TAKEN: "An account with that email already exists. Sign in instead.",
};

export default function Auth({ invited }: { invited: boolean }) {
  const [mode, setMode] = useState<"in" | "up">(invited ? "up" : "in");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { signIn, pending: p1 } = useSignInWithUsernamePassword(api.auth);
  const { signUp, pending: p2 } = useSignUpWithUsernamePassword(api.auth);
  const syncProfile = useMutation(api.users.syncProfile);
  const pending = p1 || p2;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const username = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) return setError("Enter a valid email address.");
    const result = mode === "in" ? await signIn({ username, password }) : await signUp({ username, password });
    if (result.status !== "complete") {
      const code = "error" in result.userError ? result.userError.error : "";
      return setError(MESSAGES[code] ?? "Could not sign you in. Please try again.");
    }
    try {
      await syncProfile(mode === "up" && name.trim() ? { name } : {});
    } catch {
      // The profile also syncs on the next page load.
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="text-lg font-bold tracking-tight">Rich Social</div>
        <div>
          <p className="text-4xl font-bold leading-tight tracking-tight">Write it once.<br />Send it everywhere.<br /><span className="text-gold">On purpose.</span></p>
          <p className="mt-4 max-w-sm text-sm text-white/60">One composer, one calendar, and one queue for every brand and every network you run.</p>
        </div>
        <div className="text-xs text-white/40">Your data lives in your own Convex backend.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="h1">{mode === "in" ? "Sign in" : "Create your account"}</h1>
          {invited && <p className="mt-2 text-sm text-muted">You have an invite. Sign in or create an account to join.</p>}
          <div className="mt-6 space-y-4">
            {mode === "up" && (
              <div>
                <label className="label" htmlFor="name">Your name</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
              </div>
            )}
            <div>
              <label className="label" htmlFor="username">Email</label>
              <input id="username" name="username" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required disabled={pending} />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "in" ? "current-password" : "new-password"} required disabled={pending} />
              {mode === "up" && <p className="mt-1 text-xs text-muted">Use a long passphrase. A password manager is your friend.</p>}
            </div>
            {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={pending}>{pending ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}</button>
          </div>
          <button type="button" className="mt-4 text-sm font-semibold text-gold hover:underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }}>
            {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
