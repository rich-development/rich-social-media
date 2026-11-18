import { SignIn } from "@clerk/react";

/** Signed-out screen. Clerk owns the form, passwords, reset, and any 2FA. */
export default function Auth({ invited }: { invited: boolean }) {
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
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        {invited && <p className="max-w-sm rounded-lg bg-gold-soft px-3 py-2 text-sm text-warn">You have an invite. Sign in or create an account to join.</p>}
        <SignIn routing="hash" />
        <p className="text-xs text-muted"><a className="hover:underline" href="/privacy">Privacy</a> · <a className="hover:underline" href="/terms">Terms</a></p>
      </div>
    </div>
  );
}
