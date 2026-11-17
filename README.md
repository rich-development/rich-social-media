# Rich Social

A social media scheduling and publishing tool you own. One composer, one calendar, and one queue for every brand and network. Backend on Convex, web app in React.

## What it does

- **Workspaces.** One per brand. Each has its own channels, posts, queue, library, and team.
- **Composer.** Write once, send to many channels. Customize the caption per channel. Live character counts and per-network checks before anything is scheduled. First comment on Instagram and Facebook. Board, title, link, and visibility options where the network uses them.
- **Queue.** Set your posting times once. "Add to queue" drops a post into the next open time.
- **Calendar.** Month view in the workspace time zone. Drag a post to another day to move it.
- **Approvals.** Turn on "review before publishing" and posts from editors wait for an admin. Request changes with a note.
- **Team.** Owner, admin, editor, viewer. One-time invite links.
- **Library.** Media with alt text, hashtag sets (saved as one paste-ready paragraph), caption templates.
- **Bulk import.** Upload a CSV of posts and queue or schedule them in one go.
- **Publishing engine.** One job per channel per post, retries with backoff on temporary errors, clear error messages, one-click retry of only the channels that failed.
- **Analytics.** What went out, where, and how reliably.
- **Networks.** Facebook Pages, Instagram, Threads, LinkedIn, YouTube, TikTok, Pinterest, Bluesky. X is built but off.

## Status: read this first

| Area | State |
| --- | --- |
| Accounts, roles, invites, workspaces | Built. Covered by automated tests. |
| Posts, queue, approvals, rescheduling, retries | Built. Covered by automated tests. |
| Token encryption and the OAuth handshake | Built. Covered by automated tests using simulated network replies. |
| Bluesky connector | Built. Tested against simulated replies, not the live service. |
| Meta, Threads, LinkedIn, YouTube, TikTok, Pinterest, X connectors | Built from each network's API docs. **Never run against the live networks.** Expect to fix small things the first time each one connects. |
| Web app | Builds clean. Checked by eye in demo mode with sample data. **Not yet run against a real backend.** |
| Engagement numbers (likes, reach) | Not built. |

The build environment could not reach Convex's servers, so nothing here has been deployed yet. The first `npx convex dev` is the first real run.

## Run it

You need Node 20+ and a free Convex account.

```bash
npm install
npx convex dev          # signs you in, creates the project, writes .env.local. Leave it running.
npm run setup:keys      # in a second terminal: creates the token encryption key
npm run dev:frontend    # http://localhost:5173
```

Then create your account in the app. **The first account on a fresh deployment becomes the owner**, so do this right away. To lock ownership to specific people regardless of order:

```bash
npx convex env set OWNER_EMAILS "you@example.com,partner@example.com"
```

Want to click around before linking a backend? `npm run demo` opens the real UI with sample data. Nothing saves.

Other commands: `npm test` (backend tests), `npm run typecheck`, `npm run build`.

## Connecting the networks

Every network needs a free developer app, except Bluesky. For each one:

1. Create the app on the network's developer site.
2. Add the redirect address. In the app, go to **Channels**, press **Setup steps** on the network, and copy the exact address. It looks like `https://<your-deployment>.convex.site/oauth/callback/<provider>`.
3. Save the app's keys on Convex with `npx convex env set NAME value`.
4. Press **Connect** on the Channels page.

Also set where the browser returns after connecting (defaults to `http://localhost:5173`):

```bash
npx convex env set SITE_URL https://your-app-address
```

| Network | Developer site | Keys to set | Notes |
| --- | --- | --- | --- |
| Bluesky | none | none | In Bluesky: Settings, Privacy and Security, App Passwords. Paste the app password into the Channels page. Easiest first test. |
| Facebook + Instagram | developers.facebook.com | `META_APP_ID`, `META_APP_SECRET` | Add the "Facebook Login for Business" product. Instagram must be a Business or Creator account linked to a Page. Works for you as an app admin right away. Other people need Meta's App Review. |
| Threads | developers.facebook.com (Threads use case) | `THREADS_APP_ID`, `THREADS_APP_SECRET` | Add yourself as a Threads tester and accept the invite inside Threads. |
| LinkedIn | linkedin.com/developers | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Add "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect". Posts to your personal profile. Company pages need LinkedIn's Community Management approval and are not built. |
| YouTube | console.cloud.google.com | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enable "YouTube Data API v3". Create an OAuth client of type Web. Until Google verifies the app, uploads may be locked to private. |
| TikTok | developers.tiktok.com | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Add "Content Posting API". Posts are private until TikTok audits the app. After the audit: `npx convex env set TIKTOK_AUDITED true`. |
| Pinterest | developers.pinterest.com | `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` | Trial access may limit who can see Pins until Pinterest upgrades the app. |
| X | developer.x.com | `X_ENABLED=true`, `X_CLIENT_ID`, `X_CLIENT_SECRET` | Off by default. Check X's current API pricing before turning it on. Text only. |

Optional: `META_GRAPH_VERSION` (default `v26.0`) and `LINKEDIN_API_VERSION` (default `202601`) if a network retires the default version.

## Costs

Nothing here costs money by default. Convex, Netlify, and every developer app above have free tiers. Things that could cost money later:

- **Convex free tier limits.** Storage and bandwidth are capped. Video is what eats them. Delete old media from the Library.
- **X.** Its API may bill for posting. That is why it is off.

## Deploying

Backend: `npx convex deploy`, then `npm run setup:keys -- --prod` and set the same env vars with `--prod`.

Web app: any static host. `netlify.toml` is included with the build command, single-page routing, and security headers. Set `VITE_CONVEX_URL` to your production Convex address in the host's settings, and set `SITE_URL` on Convex to the site's address.

## Security

- **Sign-in.** Convex Auth with email and password. Passwords are hashed by the auth component (Argon2id) with built-in rate limiting and common-password checks. Sessions expire after 14 idle days or 30 days total. There is no email verification or password reset by email yet (that needs an email service).
- **Access control.** Every function checks that the caller is signed in, belongs to the workspace, and holds the needed role. A non-member gets the same "not found" as a missing workspace.
- **Who can get in.** Signing up alone grants nothing. Only the first account (or `OWNER_EMAILS`) can create a workspace. Everyone else needs an invite link, which works once, expires in 7 days, and is stored only as a hash.
- **Social tokens.** Encrypted with AES-256-GCM before storage, in a table no browser-facing query reads. The key lives only in Convex env vars. If you lose `TOKEN_ENCRYPTION_KEY`, reconnect the channels.
- **OAuth.** Random single-use `state` (stored hashed, 10 minute life), PKCE where the network supports it, and the callback re-checks that the person is still an admin.
- **No double posts.** Every publish job carries a token. Editing or rescheduling a post issues a new one and the old job does nothing. Convex runs scheduled actions at most once, and a watchdog flags anything stuck rather than retrying blindly.
- **Uploads.** File type and size are read from storage on the server, not trusted from the browser.
- **Secrets in git.** None. `.env*` files are ignored.

Known gaps: no two-factor sign-in, no email-based password reset, uploaded media URLs are unguessable but public (the networks need to fetch them).

## Known limits

- Files that a network needs uploaded byte-for-byte (LinkedIn, YouTube, TikTok video) are capped at 48 MB. Instagram, Facebook, Threads, and Pinterest fetch from a link, so they take larger files.
- Media URLs only work for the networks once the backend is on Convex cloud, not a local backend.
- LinkedIn company pages, Instagram Stories, Facebook Reels, TikTok photo posts, and X media are not built.
- Queue times are per workspace, not per channel.

## Layout

```
convex/            backend
  schema.ts        tables
  auth.ts          sign-in wiring
  posts.ts         create, schedule, queue, approve, retry
  publisher.ts     the publishing engine
  channels.ts      connect and disconnect accounts
  http.ts          OAuth callback
  platforms/       one file per network
  lib/             access control, encryption, time zones
  shared/          network rules used by both backend and web app
  *.test.ts        tests
src/               web app
scripts/demo/      sample data for `npm run demo`
```
