import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupUsernamePassword } from "@convex-dev/auth/methods/username-password/server";
import { components, internal } from "./_generated/api";

// Sessions: short-lived access tokens, 30 day max session, 14 days of
// inactivity before a sign-in is required again.
const auth = setupConvexAuth({
  component: components.auth,
  refreshInactivityTimeoutSeconds: 60 * 60 * 24 * 14,
});
export const { signOut, refreshSession, isAuthenticated } = auth;

// The "username" is the person's email address. Passwords are hashed by the
// auth component; this app never sees or stores them.
export const {
  signUpWithUsernamePassword,
  signInWithUsernamePassword,
  changePassword,
} = setupUsernamePassword(auth, {
  component: components.authPassword,
  usernameComponent: components.authUsername,
}).attachUserCallbacks({ createUser: internal.users.createUser });
