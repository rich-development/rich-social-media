/// <reference types="vite/client" />
// Test harness: an in-memory Convex with the auth components registered.
import { convexTest } from "convex-test";
import core from "@convex-dev/auth/test";
import password from "@convex-dev/auth/components/password/test";
import username from "@convex-dev/auth/components/username/test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./setup.testing.ts"]);

export function setup() {
  process.env.CONVEX_CLOUD_URL ??= "https://example.convex.cloud";
  const t = convexTest(schema, modules);
  core.registerCore(t);
  password.registerPassword(t);
  t.registerComponent("authUsername", username.schema, username.modules);
  return t;
}

/** Sign up a real account through the auth component and return a client acting as it. */
export async function signUp(t: ReturnType<typeof setup>, email: string) {
  const result = await t.mutation(api.auth.signUpWithUsernamePassword, {
    username: email, password: "a long test passphrase 42!",
  });
  if (result.status !== "complete") throw new Error(`sign-up failed: ${JSON.stringify(result)}`);
  const as = t.withIdentity(core.sessionIdentity(result.tokens));
  await as.mutation(api.users.syncProfile, { name: email.split("@")[0] });
  return as;
}
