/// <reference types="vite/client" />
// Test harness: an in-memory Convex. Sign-in is simulated with the same
// identity shape Convex builds from a verified Clerk token.
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./setup.testing.ts"]);

export function setup() {
  return convexTest(schema, modules);
}

export async function signUp(t: ReturnType<typeof setup>, email: string, opts: { verified?: boolean } = {}) {
  const as = t.withIdentity({
    issuer: "https://test.clerk.accounts.dev",
    subject: `user_${email}`,
    tokenIdentifier: `https://test.clerk.accounts.dev|user_${email}`,
    email,
    emailVerified: opts.verified ?? true,
    name: email.split("@")[0],
  });
  await as.mutation(api.users.store, {});
  return as;
}
