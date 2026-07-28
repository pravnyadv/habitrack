# Habitrack 🦫

A personal habit tracker — a cleaner take on [beaverhabits](https://github.com/daya0576/beaverhabits). Multi-profile, realtime cross-device sync, installable as a PWA, and deployed to the edge on Cloudflare Pages with a Neon Postgres backend.

**Live:** https://habitrack-6yj.pages.dev

---

## What it does

**Two kinds of tracker.** *Habits* are the usual thing: you check off each scheduled day. *Streaks* are the inverse — quit/abstain trackers where every day is clean by default and you only log the days you slipped. That means a quit streak accrues with zero daily interaction, which is rather the point of one. A slip logged for *today* is graced rather than counted, mirroring how habit streaks treat a day that isn't over yet.

**Per-habit scheduling.** Each habit picks its own weekdays. Non-scheduled days are rest days — they don't count as missed and streaks skip straight over them. "Active from" is the earlier of the habit's start date or its first check-in, so days before you started are never held against you.

**Multi-profile.** Each profile has its own passcode and its own habits. Profile creation is open to anyone with the URL; the first profile is admin and can manage the rest.

**View-only sharing.** Invite another profile to watch your data for accountability. Shares are accept-based (pending until the recipient agrees) and strictly read-only — the mutating endpoints never honour a `?profile=` override, so a viewer physically cannot write to your habits.

**Realtime.** Check in on your phone and your laptop updates instantly, via Pusher Channels. Clients apply remote events surgically rather than refetching.

**Presence.** A lightweight heartbeat tracks when each profile last opened the app, so both sides of a share can see whether the other is around.

**Stats.** Streaks, completion rates, and contribution heatmaps, computed client-side from each habit's raw check-in days. CSV/JSON export from the Overview tab.

**Installable PWA** with an online-first service worker and an offline fallback page.

---

## Stack

| | |
|---|---|
| Framework | [Astro 5](https://astro.build) (`output: 'server'`) + `@astrojs/cloudflare` v12 |
| UI | Preact islands (`@astrojs/preact` v4) + Tailwind v4 via `@tailwindcss/vite` |
| Database | [Neon](https://neon.tech) Postgres via `@neondatabase/serverless` (HTTP driver) |
| Realtime | [Pusher Channels](https://pusher.com/channels) (cluster set via `PUSHER_CLUSTER`) |
| Hosting | Cloudflare Pages (Workers runtime, `nodejs_compat`) |

A few version pins that look arbitrary but aren't:

- **`@astrojs/cloudflare` is pinned to v12** — the Astro-5-compatible line. v14+ requires Astro 7.
- **`@astrojs/preact` is pinned to v4** for the same reason; v6 breaks the Cloudflare build with an unresolved `astro:preact:opts`.
- **The Neon driver must stay HTTP.** A TCP `pg` driver won't run on the Workers runtime.
- **Image optimization is disabled** (`passthroughImageService`) so `sharp` never gets pulled in — it has no prebuild for Node 26 and nowhere to live on Workers.

The frontend is mid-migration: the `/profile` hub is Preact islands, while `index.astro` (the main app) is still a bundled vanilla-JS module. Shared logic lives in `src/lib/compute.js` so the two surfaces can't drift.

---

## Layout

```
src/
  pages/
    index.astro          # main app: habit list, calendar, realtime (vanilla JS)
    profile/             # the auth gate + account hub, one SSR page per tab
      index.astro        #   Overview  — aggregate stats, heatmaps, export
      switch.astro       #   Switch    — profile picker / invites / shared-with-you
      login.astro        #   Login     — passcode entry for a chosen profile
      create.astro       #   Create    — new profile
      manage.astro       #   Manage    — rename, passcode, shares, admin presence
    api/                 # habits, checkins, login/logout/session, profiles,
                         # shares, heartbeat, presence, rt-config
  components/
    AppHeader.astro      # the shared header: logo, account chip, theme, heartbeat
    Overview.jsx         # Preact: aggregate stats + heatmap + export
    profile/*.jsx        # one focused island per /profile route
  lib/
    db.js                # getSql(env) + query helpers, all scoped by profileId
    auth.js              # PBKDF2 hashing, signed tokens, verifyToken
    realtime.js          # Pusher REST broadcast (manual signing, workerd-safe)
    compute.js           # shared client logic: dates, stats, heatmaps, apiFetch
  middleware.js          # server-side auth gate for the app routes
scripts/init-db.mjs      # idempotent schema create/migrate + seed
```

Every `/profile` route SSR-fetches its own data from the session cookie and hydrates a focused island with `client:load` — so there are no loading spinners on navigation.

---

## Data model

```
profiles        id, name, passcode_hash, is_admin, token_version,
                failed_attempts, locked_until, last_active_at, created_at

habits          id, profile_id →profiles, name, emoji, color, sort_order,
                kind ('normal' | 'streak'), schedule, start_date, created_at

checkins        id, habit_id →habits, day DATE, UNIQUE(habit_id, day)

profile_shares  id, owner_id →profiles, viewer_id →profiles,
                accepted_at, created_at, UNIQUE(owner_id, viewer_id)
```

`schedule` is a CSV of JS weekday numbers (`0`=Sun … `6`=Sat). For a `normal` habit a `checkins` row means *done*; for a `streak` habit it means *slipped* — same table, inverted meaning. All stats are derived client-side from these raw days; nothing is precomputed.

Check-ins can be backfilled for today and the recent past, capped by `BACKFILL_DAYS` in `compute.js` (currently 7). The server re-checks that window independently, so it holds regardless of what the UI allows.

---

## Auth

Passcodes are hashed with PBKDF2-SHA256 (100k iterations, per-profile salt) and stored in the database — never in env.

1. `POST /api/login` verifies the hash and returns a signed token: `<profileId>.<exp>.<tokenVersion>.<hmac>`, HMAC'd with `AUTH_SECRET`.
2. The same token is set as an httpOnly cookie, and `src/middleware.js` verifies it **before any HTML is sent** — a signed-out visit to `/` 302s to the gate rather than painting the app and then bouncing.
3. Every data query is scoped to the authenticated `profileId`.

**Revocation** rides on `token_version`, which is folded into the signed payload and checked against the profile row on each verify (one indexed read). Changing a passcode bumps the version, invalidating every token issued to every device; deleting a profile does the same implicitly. The check fails closed — a database error yields *unauthenticated*, never a 500 out of the auth gate.

**Login throttling:** five consecutive wrong passcodes lock a profile for 15 minutes (HTTP 429). Passcodes are a 6-character minimum.

**PWA session restore:** installed PWAs and Safari's ITP can drop the httpOnly cookie while localStorage keeps the token. `POST /api/session` re-issues the cookie from a valid `Authorization: Bearer` token so the gate doesn't strand you on the picker.

---

## Local development

**Requirements:** Node 20+, a Neon database, a Pusher Channels app.

```bash
npm install
npm run db:init     # create/migrate schema on Neon (idempotent), seeds if empty
npm run dev         # astro dev with HMR, reads .dev.vars
```

Secrets are read from the **Workers runtime env** per request (`locals.runtime.env`), never `process.env` at module load. That means two files locally:

- **`.dev.vars`** — what the app reads in dev and preview (exposed via `platformProxy`)
- **`.env`** — mirrors the same values for the plain-Node `db:init` script

Both are gitignored. Required keys:

```ini
NEON_DB=postgres://…            # Neon connection string
AUTH_SECRET=…                   # HMAC key for signing session tokens
PUSHER_APP_ID=…
PUSHER_KEY=…
PUSHER_SECRET=…
PUSHER_CLUSTER=ap2
```

In production these live as Cloudflare Pages secrets:

```bash
wrangler pages secret put NEON_DB --project-name habitrack
```

### Commands

| | |
|---|---|
| `npm run dev` | Astro dev server with HMR |
| `npm run db:init` | Create/upgrade the Neon schema (idempotent — safe to re-run) |
| `npm run build` | Build to `dist/` |
| `npm run preview` | `wrangler pages dev dist` — the real Workers runtime, locally |
| `npm run deploy` | Build and deploy to Cloudflare Pages |

Re-run `db:init` after any schema change; every statement is `ALTER … IF NOT EXISTS` and backward-compatible.

---

## Notes from the field

Things that cost real debugging time and are easy to undo by accident:

- **`compute.js` used to be `analytics.js`.** Ad and privacy blockers block any file with `analytics` in the name, which broke the app for anyone running one. Don't rename it back.
- **The service worker never caches app HTML.** The app is server-rendered, auth-gated and realtime, and caching HTML broke reopen twice over: stale markup pointing at hashed `/_astro` assets that 404 after a deploy, and *"a redirected response was used…"* errors when a signed-out `/` (302) got cached for a navigation. Navigations go to the network; only a static offline page is cached. Bump the `CACHE` version when editing `sw.js`.
- **Preact won't re-apply `dangerouslySetInnerHTML` when the `__html` string is unchanged between renders.** The SSR markup sticks even after a later render computes new HTML. For computed innerHTML, set it through a `ref` + `useEffect` on the data dependency.
- **Per-habit colours are inline hex, never dynamic class names** — Tailwind can't see classes it doesn't find in source.
- **Dates are local `YYYY-MM-DD`** via `iso()`/`addDays()`. `toISOString()` on a raw date is a UTC off-by-one waiting to happen.
- **Each Neon call is a separate HTTP round trip.** Awaiting queries in sequence shows up directly in time-to-first-byte; fire independent ones with `Promise.all`, and don't re-verify a token the middleware already verified.
- **Astro CSRF-blocks non-GET requests without a matching `Origin`.** Browsers always send it; `curl` tests need `-H "Origin: <base>"`.

---

## Licence

Personal project, all rights reserved.
