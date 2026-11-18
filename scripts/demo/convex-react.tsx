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
  if (getFunctionName(ref) === "users:store") return null;
  console.info("Demo mode: skipped", getFunctionName(ref));
  throw new Error("Demo mode: changes are not saved.");
};
export const useMutation = noop;
export const useAction = noop;

// convex/react-clerk and @clerk/react
export function ConvexProviderWithClerk({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export const ClerkProvider = ConvexProviderWithClerk;
export const useAuth = () => ({ isSignedIn: !window.location.search.includes("signedout") });
export const useUser = () => ({ user: { fullName: "Sample Owner", firstName: "Sample", primaryEmailAddress: { emailAddress: "owner@example.com" } } });
export const useClerk = () => ({ signOut: async () => {}, openUserProfile: () => {} });
export function UserButton() {
  return <span className="inline-block h-7 w-7 rounded-full bg-white/20" />;
}
export function SignIn() {
  return <div className="card w-full max-w-sm p-8 text-center text-sm text-muted">Clerk's sign-in form shows here.</div>;
}
