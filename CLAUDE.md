# Habitrack

A personal habit tracker — a cleaner take on [beaverhabits](https://github.com/daya0576/beaverhabits). **Multi-profile** (each profile has its own passcode + habits), realtime cross-device sync, deployed on Cloudflare Pages with a Neon Postgres backend.

**Live:** https://habitrack-6yj.pages.dev (Cloudflare account: **Praveen**)

## Stack

- **Astro 5** (`output: 'server'`) with the **`@astrojs/cloudflare` v12** adapter (v12 is the Astro-5-compatible line; v14+ needs Astro 7).
- **Tailwind v4** via `@tailwindcss/vite` (no config file). Dark mode is class-based through `@custom-variant dark` in `src/styles/global.css`.
- **Neon Postgres** via `@neondatabase/serverless` (HTTP `fetch` driver — works on the Workers runtime; do NOT switch to a TCP `pg` driver).
- Frontend is **vanilla JS** in `src/pages/index.astro` + `src/pages/overview.astro` (bundled module `<script>`s that import `src/lib/compute.js`). No framework.
- **Realtime** via Pusher Channels (`pusher` server + `pusher-js` client, cluster `ap2`).
- Image optimization disabled (`passthroughImageService`) so `sharp` is never pulled (no Node 26 prebuild, no place on Workers).

## Layout

```
src/
  pages/
    index.astro          # main app: gate (profiles), habit list, calendar, install btn
    overview.astro       # /overview route: aggregate stats + heatmap + CSV/JSON export
    api/
      habits.js          # GET list / POST create        (token-scoped)
      habits/[id].js     # DELETE / PATCH                 (token-scoped)
      checkins.js        # POST toggle a day              (token-scoped)
      version.js         # GET per-profile revision (sync poll safety net)
      login.js           # POST {profileId,passcode} -> token
      profiles.js        # GET list (public) / POST create (open)
      profiles/[id].js   # DELETE (self or admin) / PATCH (rename, change passcode)
      rt-config.js       # GET public Pusher key+cluster
  lib/
    db.js                # getSql(env) + query helpers (all take `sql` first, scoped by profileId)
    auth.js              # PBKDF2 passcode hash/verify + signed-token (authedProfile/signToken)
    realtime.js          # broadcast(env, profileId, payload, socketId) -> Pusher REST
    compute.js           # shared client helpers: dates, COLORS, stats, heatmaps, export, connectRealtime
  styles/global.css      # tailwind import, dark variant, safe-area, no-scrollbar
public/                  # icons, manifest.webmanifest, sw.js, robots.txt (blocks all)
scripts/init-db.mjs      # idempotent schema create/migrate + seed
wrangler.jsonc           # Pages config (nodejs_compat, dist) — NO account_id (Pages rejects it)
```

> `compute.js` was renamed from `analytics.js` — ad/privacy blockers block any file named `analytics`.

## Environment / secrets

Read from the **Workers runtime env** per request (`locals.runtime.env`), never `process.env` at module load.

- `NEON_DB` — Postgres connection string.
- `AUTH_SECRET` — HMAC key for signing session tokens (infra key, not a passcode).
- `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` — realtime.

`APP_PASSCODE` is legacy (only `init-db.mjs` reads it to seed the default profile's passcode).

- **Local dev:** values in `.dev.vars` (gitignored); `platformProxy` exposes them via `locals.runtime.env`.
- **Production:** Cloudflare Pages **secrets** (`wrangler pages secret put <NAME> --project-name habitrack`).
- `.env` mirrors `NEON_DB` (+ Pusher/`AUTH_SECRET`) for the plain-node `db:init` script.

## Auth model (multi-profile)

Passcodes are **hashed** (PBKDF2-SHA256 + salt) in the `profiles` table — never in env. Flow:

1. `POST /api/login {profileId, passcode}` verifies the hash → returns a **signed token** (`profileId.exp.hmac`, HMAC over `AUTH_SECRET`).
2. Client stores `habitrack_token` + `habitrack_profile` ({id,name,admin}) in localStorage; sends `Authorization: Bearer <token>` on every request.
3. `authedProfile(request, env)` verifies the token (cheap, no DB) and returns the `profileId`; **all data queries are scoped to it**.

Profile creation is **open** (anyone with the URL). The first/default profile (`is_admin=true`) can delete any profile; others can only delete/manage their own. The page never server-renders data — the client loads it via the API with the token.

**Astro CSRF:** non-GET requests without a matching `Origin` header are 403'd. Browsers always send `Origin`; `curl` tests must add `-H "Origin: <base>"`. JSON bodies are exempt.

## Data model

- `profiles (id, name, passcode_hash, is_admin, created_at)`
- `habits (id, profile_id → profiles ON DELETE CASCADE, name, emoji, color, sort_order, schedule TEXT, created_at)`
  - `schedule` = CSV of JS weekday numbers (`0`=Sun … `6`=Sat), default `0,1,2,3,4,5,6`.
- `checkins (id, habit_id → habits ON DELETE CASCADE, day DATE, UNIQUE(habit_id, day))`

Stats/streaks/heatmaps are computed **client-side** from each habit's `days` array. Non-scheduled days are "rest days" (not counted; streaks skip them). "Active from" = earlier of a habit's created date / first check-in — days before that are never "missed". See `compute.js`.

## Realtime

On any check-in/add/delete/rename, the endpoint calls `broadcast(env, profileId, payload, socketId)` → a signed Pusher REST trigger (manual `node:crypto` md5+hmac, works on workerd) to channel **`habitrack-<profileId>`**, excluding the originating socket. Clients subscribe to their own profile's channel and `applyRemote()` mutates local state surgically (no refetch). A slow per-profile version-poll (`/api/version`) is the dropped-socket safety net.

## PWA

`public/manifest.webmanifest` + icons + `public/sw.js` (minimal network-first SW) make it installable. In-app install button (`#install-btn`) uses `beforeinstallprompt` (Chromium only; iOS is Share → Add to Home Screen). `robots.txt` blocks all; `noindex` meta.

## Commands

```bash
npm run dev        # astro dev (HMR) — uses .dev.vars
npm run db:init    # create/upgrade schema on Neon (idempotent), seeds if empty
npm run build      # astro build → dist/
npm run preview    # wrangler pages dev dist (real Workers runtime, local)
npm run deploy     # build + deploy to Cloudflare Pages (Praveen account, pinned via CLOUDFLARE_ACCOUNT_ID)
```

## Conventions / gotchas

- New API route → `const profileId = await authedProfile(request, locals.runtime?.env); if (!profileId) return unauthorized();` then scope all queries by `profileId`.
- DB helpers take `sql` first and (for data) `profileId` second; `getSql(locals.runtime?.env)` in the endpoint.
- Per-habit color is inline hex from the `COLORS`/`COLORS_DARK` maps (Tailwind can't see dynamic classes) — inline `style`, never dynamic class names.
- Dates are local `YYYY-MM-DD` via `iso()`/`addDays()` — avoid `toISOString()` on raw dates (UTC off-by-one).
- Client scripts are bundled modules importing `compute.js` — keep shared logic there so index + overview never diverge.
- DDL can't bind params (`sql\`... ${x}\``); inline safe literals via `sql.query('... ' + x)` in `init-db.mjs`.
- Deploys target the **Praveen** Cloudflare account. Never deploy to Masa.
- After schema changes, re-run `npm run db:init` (all `ALTER … IF NOT EXISTS`, backward-compatible).
