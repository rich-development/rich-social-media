import type { AuthConfig } from "convex/server";

// Sign-in is handled by Clerk. Convex only accepts tokens issued by your
// Clerk instance for this app. Set the issuer with:
//   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-instance.clerk.accounts.dev
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }],
} satisfies AuthConfig;
