// Demo mode only: stands in for the Convex client so the UI can be viewed
// with sample data and no backend. Run with `npm run demo`.
import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { FIXTURES } from "./fixtures";

export class ConvexReactClient {
  constructor(_url: string) {}
}
export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: !window.location.search.includes("signedout") };
}
export function useQuery(ref: any, args?: any) {
  if (args === "skip") return undefined;
  const name = getFunctionName(ref);
  const value = FIXTURES[name];
  if (value === undefined) console.warn("No demo data for", name);
  return typeof value === "function" ? value(args) : value;
}
const noop = (ref: any) => async () => {
  console.info("Demo mode: skipped", getFunctionName(ref));
  throw new Error("Demo mode: changes are not saved.");
};
export const useMutation = noop;
export const useAction = noop;

// @convex-dev/auth/react
export function ConvexAuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function useAuthActions() {
  return { signOut: async () => {}, setSession: async () => {} };
}
// @convex-dev/auth/methods/username-password/react
const fake = async () => ({ status: "error" as const, userError: { error: "INVALID_CREDENTIALS" } });
export const useSignInWithUsernamePassword = () => ({ signIn: fake, pending: false });
export const useSignUpWithUsernamePassword = () => ({ signUp: fake, pending: false });
