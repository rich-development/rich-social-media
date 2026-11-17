// One-time setup: creates the key that encrypts social account tokens and
// stores it on your Convex deployment. Safe to run again: it never replaces
// an existing key (doing so would lock out every connected channel).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const prod = process.argv.includes("--prod") ? ["--prod"] : [];
const run = (args) => execFileSync("npx", ["convex", ...args, ...prod], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let existing = "";
try {
  existing = run(["env", "get", "TOKEN_ENCRYPTION_KEY"]).trim();
} catch {
  // Not set yet.
}
if (existing) {
  console.log("TOKEN_ENCRYPTION_KEY is already set. Nothing to do.");
} else {
  // The key is passed straight to Convex and never printed or written to disk.
  run(["env", "set", "TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64")]);
  console.log("TOKEN_ENCRYPTION_KEY created and saved on your Convex deployment.");
}
