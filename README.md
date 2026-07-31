# Habitrack 🦫

A personal habit tracker, built as a cleaner take on [beaverhabits](https://github.com/daya0576/beaverhabits). Multiple profiles, realtime sync across devices, installable as a PWA. Runs on Cloudflare Pages with a Neon Postgres backend.

**Live:** https://habitrack-6yj.pages.dev

**Try the demo:** https://habitrack-6yj.pages.dev/profile/demo. No signup, no login. It loads sample habits and the whole app works: add, edit, delete, reorder, check in. Your changes are kept in your browser's localStorage and never reach the server, so you can't touch anyone's real data. Reset puts the sample data back.

## Features

**Two tracker types.** A *habit* is checked off on each scheduled day. A *streak* works in reverse: it's for quitting things, so every day counts as clean from the start date and you only log the days you slipped. A quit streak grows without any daily input. Slips logged for today are graced instead of counted, since the day isn't over.

**Per-habit schedules.** Each habit picks its own weekdays. Days off aren't counted as missed and streaks skip over them. Days before a habit started are never counted either.

**Multiple profiles.** Each profile has its own passcode and habits. Anyone with the URL can create one. The first profile is admin and can manage the others.

**View-only sharing.** You can invite another profile to watch your data for accountability. The recipient has to accept, and access is strictly read-only: mutating endpoints ignore the `?profile=` parameter entirely, so a viewer has no way to write.

**Public profiles.** A profile can opt into being readable by anyone at `/p/<id>`, with no login at all. The profile picker badges each row Private or Public, and public rows open straight into a read-only view. Only the owner can flip it, not the admin, and the same read-only rule applies: there is no write path for a visitor.

**Realtime sync.** Check in on your phone and your laptop updates immediately, over Pusher Channels. Clients patch their local state from the event instead of refetching.

**Presence.** A heartbeat records when each profile last opened the app, so both sides of a share can see if the other is active.

**Stats and export.** Streaks, completion rates and contribution heatmaps, all computed in the browser from raw check-in days. CSV and JSON export on the Overview tab.

**Offline-aware PWA.** Installable, with an online-first service worker and a static offline page.

**Tested where it counts.** `npm test` runs `node --test` with no dependencies over the pure logic: date handling, the shared habit-creation rules, streak maths, and the demo sandbox. It includes a parity suite that pins the demo's local writes to what the real endpoint derives, and an invariant test for the one bug class here that yields plausible wrong numbers rather than an error (a check-in row means *done* for a habit and *slipped* for a quit).

## Stack

| | |
|---|---|
| Framework | [Astro 5](https://astro.build) (`output: 'server'`) with `@astrojs/cloudflare` v12 |
| UI | Preact islands (`@astrojs/preact` v4), Tailwind v4 via `@tailwindcss/vite` |
| Database | [Neon](https://neon.tech) Postgres via `@neondatabase/serverless` (HTTP driver) |
| Realtime | [Pusher Channels](https://pusher.com/channels) |
| Hosting | Cloudflare Pages, Workers runtime with `nodejs_compat` |

Four version choices that look arbitrary and aren't:

* `@astrojs/cloudflare` stays on v12. That's the Astro 5 compatible line; v14+ needs Astro 7.
* `@astrojs/preact` stays on v4 for the same reason. v6 breaks the Cloudflare build with an unresolved `astro:preact:opts`.
* The Neon driver has to be the HTTP one. A TCP `pg` driver won't run on Workers.
* Image optimization is off (`passthroughImageService`) so `sharp` never gets installed. It has no Node 26 prebuild and nowhere to run on Workers.

The frontend is mid-migration. The `/profile` hub is Preact islands; `index.astro` is still a bundled vanilla JS module. Shared logic lives in `src/lib/compute.js` so the two can't drift apart.

## Layout

```
src/
  pages/
    index.astro          # the signed-in app (SSRs its own habits)
    p/[id].astro         # a public profile, read-only, no session
    profile/             # auth gate and account hub, one SSR page per tab
      index.astro        #   Overview    aggregate stats, heatmaps, export
      switch.astro       #   Switch      profile picker, invites, shared with you
      login.astro        #   Login       passcode entry
      create.astro       #   Create      new profile
      manage.astro       #   Manage      rename, passcode, shares, admin presence
      demo.astro         #   Demo        no login, writes go to localStorage
      stats.astro        #   Demo stats  admin only, demo traffic
    api/                 # habits, checkins, login/logout/session, profiles,
                         # shares, heartbeat, presence, rt-config, demo-visit
  components/
    HabitApp.astro       # the whole app body, shared by the three surfaces above
    AppHeader.astro      # shared header: logo, account chip, theme, heartbeat
    Overview.jsx         # Preact: aggregate stats, heatmap, export
    profile/*.jsx        # one island per /profile route
  layouts/
    ProfileLayout.astro  # /profile shell: header plus hub tab nav
  lib/
    db.js                # getSql(env) and query helpers, all scoped by profileId
    auth.js              # PBKDF2 hashing, signed tokens, verifyToken
    realtime.js          # Pusher REST broadcast, manually signed for workerd
    compute.js           # shared client logic: dates, stats, heatmaps, apiFetch
    render.js            # collapsed habit list markup, shared by SSR and client
    demo.js              # demo seed plus the localStorage stand-in for the API
  middleware.js          # server-side auth gate
scripts/
  init-db.mjs            # idempotent schema create, migrate and seed
  gen-splash.mjs         # generates the iOS launch images and SplashLinks.astro
test/                    # node --test over the pure logic
```

Each `/profile` route fetches its own data server-side from the session cookie and hydrates one focused island with `client:load`, so navigating between tabs never shows a spinner.

`index.astro`, `p/[id].astro` and `profile/demo.astro` all render the same `HabitApp.astro` and differ by one `mode` prop (`'app'`, `'public'`, `'demo'`), so the three surfaces cannot drift apart. The collapsed habit list is server-rendered from `lib/render.js`, which both the SSR pass and the client call, so the first paint needs no JavaScript.

## Data model

```
profiles        id, name, passcode_hash, is_admin, is_public, token_version,
                failed_attempts, locked_until, last_active_at, created_at

habits          id, profile_id →profiles, name, emoji, color, sort_order,
                kind ('normal' | 'streak'), schedule, start_date, created_at

checkins        id, habit_id →habits, day DATE, UNIQUE(habit_id, day)

profile_shares  id, owner_id →profiles, viewer_id →profiles,
                accepted_at, created_at, UNIQUE(owner_id, viewer_id)

demo_visits     id, visitor_id, created_at
```

`schedule` is a CSV of JS weekday numbers, `0`=Sun through `6`=Sat.

`is_public` is what makes a profile readable at `/p/<id>`. `demo_visits` has no foreign key on purpose: a demo visitor has no profile, just a random id their own browser holds in localStorage.

One table quirk worth knowing: a `checkins` row means *done* for a normal habit and *slipped* for a streak habit. Same storage, opposite meaning. Nothing is precomputed; all stats derive from these raw days in the browser.

Check-ins can be backfilled for today and the recent past, limited by `BACKFILL_DAYS` in `compute.js` (currently 7). The server enforces that window independently of the UI.

## Auth

Passcodes are hashed with PBKDF2-SHA256, 100k iterations and a per-profile salt, stored in the database and never in env.

1. `POST /api/login` checks the hash and returns a signed token, `<profileId>.<exp>.<tokenVersion>.<hmac>`, signed with `AUTH_SECRET`.
2. The token is also set as an httpOnly cookie. `src/middleware.js` verifies it before any HTML is sent, so a signed-out visit to `/` redirects to the gate instead of painting the app and bouncing.
3. Every data query is scoped to the authenticated `profileId`.

**Revocation** uses `token_version`, which is part of the signed payload and re-checked against the profile row on each verify (one indexed read). Changing a passcode bumps it and kills every token on every device. Deleting a profile does the same implicitly. The check fails closed: a database error means unauthenticated, never a 500 from the auth gate.

**Throttling.** Five wrong passcodes in a row lock a profile for 15 minutes and return 429. Minimum passcode length is 6.

**Session restore.** Installed PWAs and Safari's ITP sometimes drop the httpOnly cookie while localStorage keeps the token. `POST /api/session` reissues the cookie from a valid bearer token so the gate doesn't strand you on the picker.

## Local development

Needs Node 20+, a Neon database and a Pusher Channels app.

```bash
npm install
npm run db:init     # create or migrate the Neon schema, seeds if empty
npm run dev         # astro dev with HMR, reads .dev.vars
```

Secrets are read per request from the Workers runtime env (`locals.runtime.env`), never from `process.env` at module load. That means two files locally:

* `.dev.vars` is what the app reads in dev and preview, exposed through `platformProxy`.
* `.env` mirrors the same values for the plain Node `db:init` script.

Both are gitignored. Required keys:

```ini
NEON_DB=postgres://…            # Neon connection string
AUTH_SECRET=…                   # HMAC key for signing session tokens
PUSHER_APP_ID=…
PUSHER_KEY=…
PUSHER_SECRET=…
PUSHER_CLUSTER=ap2
```

In production these are Cloudflare Pages secrets:

```bash
wrangler pages secret put NEON_DB --project-name habitrack
```

### Commands

| | |
|---|---|
| `npm run dev` | Astro dev server with HMR |
| `npm run db:init` | Create or upgrade the Neon schema, safe to re-run |
| `npm run build` | Build to `dist/` |
| `npm run preview` | `wrangler pages dev dist`, the real Workers runtime locally |
| `npm run deploy` | Build and deploy to Cloudflare Pages |
| `npm test` | `node --test` over the pure logic, no DB and no network |
| `npm run splash` | Regenerate the iOS launch images and `SplashLinks.astro` |

Re-run `db:init` after any schema change. Every statement is `ALTER … IF NOT EXISTS` and backward compatible.

`npm run deploy` refuses to run unless `CLOUDFLARE_ACCOUNT_ID` is exported. Pages config cannot hold an account id, and letting wrangler choose one for you is how a deploy lands in the wrong account.

```bash
export CLOUDFLARE_ACCOUNT_ID=…
npm run deploy
```

## Gotchas

Each of these cost real debugging time and is easy to undo by accident.

* **`compute.js` was once called `analytics.js`.** Ad and privacy blockers block any file with `analytics` in the name, which broke the app for anyone running one. Don't rename it back.
* **The service worker never caches app HTML.** The app is server-rendered, auth-gated and realtime, and caching HTML broke reopen twice: stale markup pointing at hashed `/_astro` assets that 404 after a deploy, and *"a redirected response was used…"* errors when a signed-out `/` redirect got cached for a navigation. Navigations go to the network and only a static offline page is cached. Bump the `CACHE` version when editing `sw.js`.
* **Preact skips `dangerouslySetInnerHTML` when the `__html` string hasn't changed** between renders, so SSR markup sticks even after a later render computes new HTML. Set computed innerHTML through a `ref` and `useEffect` on the data dependency instead.
* **Per-habit colors are inline hex, never dynamic class names.** Tailwind can't see classes that don't appear literally in source.
* **Dates are local `YYYY-MM-DD`** via `iso()` and `addDays()`. Calling `toISOString()` on a raw date gives you a UTC off-by-one.
* **Every Neon call is a separate HTTP round trip.** Sequential awaits show up directly in time-to-first-byte. Use `Promise.all` for independent queries, and don't re-verify a token the middleware already verified.
* **Astro blocks non-GET requests without a matching `Origin` header.** Browsers always send it; `curl` tests need `-H "Origin: <base>"`.

## A note on `npm audit`

It reports high-severity advisories. They fall into two groups, and neither is reachable in this app:

* Most of them (`wrangler` → `miniflare` → `ws`/`undici`/`sharp`, plus an `esbuild` dev-server issue that only affects Windows) are local build tooling. None of it is deployed; the Workers runtime never sees it.
* The rest are Astro core advisories with no fix inside the 5.x line, and 5.x is where the Cloudflare adapter pins this project. None of the affected features are used here: no `define:vars`, no server islands, no `Astro.slots`, no spread attributes, and no `transition:*` directives.

Clearing the list means Astro 7 plus `@astrojs/cloudflare` v14, which is a deliberate upgrade rather than a patch bump.

## License

MIT, see [LICENSE](LICENSE).
