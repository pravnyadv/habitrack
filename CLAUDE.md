# Habitrack

A personal habit tracker — a cleaner take on [beaverhabits](https://github.com/daya0576/beaverhabits). **Multi-profile** (each profile has its own passcode + habits), realtime cross-device sync, deployed on Cloudflare Pages with a Neon Postgres backend.

**Live:** https://habitrack-6yj.pages.dev (Cloudflare account: **Praveen**)

## Stack

- **Astro 5** (`output: 'server'`) with the **`@astrojs/cloudflare` v12** adapter (v12 is the Astro-5-compatible line; v14+ needs Astro 7).
- **Tailwind v4** via `@tailwindcss/vite` (no config file). Dark mode is class-based through `@custom-variant dark` in `src/styles/global.css`.
- **Neon Postgres** via `@neondatabase/serverless` (HTTP `fetch` driver — works on the Workers runtime; do NOT switch to a TCP `pg` driver).
- **Two frontend styles, mid-migration to Preact:**
  - `index.astro` (main app) is still **vanilla JS** — a bundled module `<script>` importing `src/lib/compute.js`.
  - The **`/profile` hub** (Overview / Switch / Manage tabs, + Login / Create) is built from **Preact islands** (`@astrojs/preact` **v4** — the Astro-5 line; v6 breaks the Cloudflare build with an unresolved `astro:preact:opts`). Each `.astro` route **SSR-fetches its data** (via the cookie) and hydrates a focused component with **`client:load`** and props — so there's no loading spinner. Overview is `/profile` (the default tab). Plan: migrate `index.astro` to Preact next.
- **Realtime** via Pusher Channels (`pusher` server + `pusher-js` client, cluster `ap2`).
- Image optimization disabled (`passthroughImageService`) so `sharp` is never pulled (no Node 26 prebuild, no place on Workers).

## Layout

```
src/
  pages/
    index.astro          # main app (vanilla): habit list, calendar, realtime. SSRs own habits (no flash)
    overview.astro       # redirect → /profile (kept for old links)
    profile/
      index.astro        # /profile = Overview tab (SSR own habits → <Overview client:load>); unauthed → /switch
      switch.astro       # SSR profiles+invites+shared → <Switch client:load>
      login.astro        # SSR target profile (?id) → <Login client:load>
      create.astro       # SSR profiles (dup check) → <Create client:load>
      manage.astro       # SSR me+profiles+shares+presence → <Manage client:load> (auth-gated)
      overview.astro     # redirect → /profile
  layouts/
    ProfileLayout.astro  # /profile shell: <AppHeader> + Overview/Manage/Switch tab nav (when `tab` set)
  components/
    AppHeader.astro      # THE shared header (index + all /profile pages): 🦫 logo→home, date, account
                         # chip + dropdown menu (Overview/Manage/Switch/Log out), theme toggle, and one
                         # self-contained <script> owning chip menu + theme + presence heartbeat + admin
                         # online badge. `showAdd`/`showOverview` props add the app-only buttons.
    Overview.jsx         # Preact: aggregate stats + heatmap + CSV/JSON export (SSR habits via props)
    profile/
      ui.jsx             # shared classes, icons, presence(), <Msg>, <Confirm>
      Login.jsx Create.jsx Switch.jsx Manage.jsx   # focused Preact islands, one per route
  pages/api/
      habits.js          # GET list (own, or ?profile=<id> if shared) / POST create
      habits/[id].js     # DELETE / PATCH (edit name/emoji/color/schedule)
      habits/reorder.js  # POST {ids:[...]} -> set sort_order (token-scoped)
      checkins.js        # POST toggle a day              (token-scoped)
      version.js         # GET revision (own, or ?profile=<id> if shared)
      login.js           # POST {profileId,passcode} -> token + sets session cookie (throttled: 5 fails -> 15min lock, 429)
      logout.js          # POST clears the session cookie
      session.js         # POST re-issues the session cookie from a Bearer token (PWA/Safari cookie loss)
      profiles.js        # GET list (public) / POST create (open, sets session cookie)
      profiles/[id].js   # DELETE (self or admin) / PATCH (rename, change passcode)
      shares.js          # GET {shared,sharedWithMe,invites} / POST invite / PATCH accept / DELETE ?viewer|?owner
      heartbeat.js       # POST bump own last_active_at (presence)
      presence.js        # GET (admin only) {online, profiles:[{name,last_active_at,online}]}
      rt-config.js       # GET public Pusher key+cluster
  middleware.js          # server-side auth gate: /,/profile/manage → redirect /profile if no cookie (/profile self-guards → /switch)
  lib/
    db.js                # getSql(env) + query helpers (all take `sql` first, scoped by profileId)
    auth.js              # PBKDF2 hash/verify + signed tokens; verifyToken, authedProfile (header|cookie), sessionCookieOpts
    realtime.js          # broadcast(env, profileId, payload, socketId) -> Pusher REST
    compute.js           # shared client helpers: dates, COLORS, stats, heatmaps, export, connectRealtime, apiFetch
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

**Session = httpOnly cookie + server-side gate (no client-auth flicker).** Login/create set an httpOnly `habitrack_token` cookie (`sessionCookieOpts`, `secure` in prod) in addition to returning the token. `src/middleware.js` gates `/` and `/overview`: it verifies the cookie and **302s to `/profile` before any HTML is sent** if there's no valid session — so a signed-out visit never paints the app. `authedProfile(request, env)` reads the token from the `Authorization` header *or* the cookie, so same-origin fetches authenticate on the cookie alone. `/api/logout` clears it. `verifyToken(token, env)` is the shared HMAC check (no DB).

**PWA / Safari cookie loss → session restore.** Installed PWAs (iOS standalone especially) and Safari ITP can drop the httpOnly cookie while **localStorage keeps the token** — so the middleware gate 302s `/` → `/profile` even though the client is "logged in", stranding the user on the picker. Fix: `POST /api/session` re-issues the cookie from a valid `Authorization: Bearer` token (no DB). The logged-out `Switch` picker (`me=null`) checks for a localStorage token on mount and, if present, calls `/api/session` and goes to `/` (shows "Restoring your session…"); a stale token clears localStorage and falls back to the picker. **Realtime is unaffected** — Pusher uses public channels (`habitrack-<profileId>`) with just the public key+cluster (no authorizer, no cookie), and all client API calls authenticate via the Bearer header, so only the server-side navigation gate ever depended on the cookie.

**`index.astro` SSRs the initial habits.** Since middleware guarantees a valid cookie, the page frontmatter fetches the signed-in profile's habits and embeds them in a `<script id="initial-habits" type="application/json">` (with `<` escaped); the client renders from that immediately, then reconciles with a background fetch. View-mode (a client-only concept via `habitrack_viewing`) still fetches the viewed profile.

**The gate is a set of real routes under `/profile/`** (switch, login, create, manage) — each an SSR page + focused Preact island, not a modal or client view-state. `index.astro` holds no gate. The chip menu's Manage/Switch navigate to `/profile/manage` / `/profile/switch`; Log out POSTs `/api/logout` + clears localStorage → `/profile`. After login/create/pick-self, the island navigates back to `/`. localStorage holds the non-sensitive `profile` ({id,name,admin}) for UI labels (+ a redundant token copy, pending cleanup). Note: server-side `listHabits` returns `created_at` as a `Date` — normalize to an ISO string before passing habits as island props (`compute.js` expects strings; the JSON API path gets this for free).

**View-only sharing (accept-based).** A profile invites another to view its data (accountability). Shares start **pending** (`accepted_at IS NULL`) — the recipient must accept before `canView` grants anything. `habits`/`version` GET accept `?profile=<id>`: if present and not the caller's own id, the server checks `canView(sql, caller, target)` (an *accepted* `profile_shares` row) and 403s otherwise. NB: parse the param as `raw != null ? Number(raw) : null` — `Number(null)===0` and `Number.isInteger(0)` is true, so a naive `Number(...)` wrongly treats "no param" as profile 0 and 403s own data. **Mutating endpoints never honor `?profile`** — they always scope to the caller's own id, so a viewer physically cannot write. Client: `habitrack_viewing` ({id,name}) in localStorage puts index + overview into read-only mode (banner, no add/edit/delete/toggle/reorder, cells render as inert `<div>`s); entering/leaving reloads the page so realtime rebinds to the viewed profile's channel. **The signed-in Switch tab is preview-only**: it lists just your own profile ("Signed in as"), **Invites** (accept/decline), and **Shared with you** (tap = enter preview/view mode, **no passcode** — they shared access, not their passcode). It does **not** list the full profile roster and has **no "New profile"** — creating profiles is an onboarding action, so the roster + create button live only in the **logged-out picker** (`Switch` with `me=null`, tapping a profile → `/profile/login`). Manage screen invites (dropdown), shows pending/active, and revokes.

**Login throttle.** `profiles.failed_attempts` + `locked_until`: 5 consecutive wrong passcodes lock the profile for 15 min (login returns 429); a correct passcode clears the counter. Passcode min length is **6** (create + change). Profile names are **not unique** (ids scope everything) — the create form only soft-warns on a duplicate.

**Presence.** `profiles.last_active_at` = "last active in the app". `AppHeader`'s script `POST`s `/api/heartbeat` on load and every 45s while the tab is visible — on **every** page (app + all /profile pages), since the header is shared (so multi-device = one row, deduped by profile). "Online" = active within 120s. `GET /api/presence` (admin only) returns the online count + every profile's last-active (shown in the manage screen's admin block). `last_active_at` also rides along in `/api/shares` listings, so both sides of a share see each other's presence (green "online" dot or a fuzzy `timeAgo`). It is *not* exposed on the public `/api/profiles` roster. Semantic note: we intentionally track "last opened", not "last check-in" — the check-in data itself already shows when someone last acted.

**Astro CSRF:** non-GET requests without a matching `Origin` header are 403'd. Browsers always send `Origin`; `curl` tests must add `-H "Origin: <base>"`. JSON bodies are exempt.

## Data model

- `profiles (id, name, passcode_hash, is_admin, failed_attempts, locked_until, last_active_at, created_at)`
- `habits (id, profile_id → profiles ON DELETE CASCADE, name, emoji, color, sort_order, schedule TEXT, created_at)`
  - `schedule` = CSV of JS weekday numbers (`0`=Sun … `6`=Sat), default `0,1,2,3,4,5,6`.
- `checkins (id, habit_id → habits ON DELETE CASCADE, day DATE, UNIQUE(habit_id, day))`
- `profile_shares (id, owner_id → profiles, viewer_id → profiles, created_at, accepted_at, UNIQUE(owner_id, viewer_id))` — owner invites viewer to read-only access; `accepted_at` NULL = pending. Both FKs `ON DELETE CASCADE`.

Stats/streaks/heatmaps are computed **client-side** from each habit's `days` array. Non-scheduled days are "rest days" (not counted; streaks skip them). "Active from" = earlier of a habit's created date / first check-in — days before that are never "missed". See `compute.js`.

## Realtime

On any check-in / add / delete / edit (`update`) / reorder, the endpoint calls `broadcast(env, profileId, payload, socketId)` → a signed Pusher REST trigger (manual `node:crypto` md5+hmac, works on workerd) to channel **`habitrack-<profileId>`**, excluding the originating socket. Payload `type`s: `checkin`, `add`, `delete`, `update` (carries the full habit sans `days`), `reorder` (carries `ids`). Clients subscribe to their own profile's channel and `applyRemote()` mutates local state surgically (no refetch). A slow per-profile version-poll (`/api/version`) is the dropped-socket safety net.

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
- All client HTTP goes through `apiFetch` (compute.js), wrapped per-page as `api(path, {method,body})` bound to the live token/socketId — returns `{ok,status,data}`. Don't hand-roll `fetch` + headers + `JSON.stringify`.
- DDL can't bind params (`sql\`... ${x}\``); inline safe literals via `sql.query('... ' + x)` in `init-db.mjs`.
- Deploys target the **Praveen** Cloudflare account. Never deploy to Masa.
- After schema changes, re-run `npm run db:init` (all `ALTER … IF NOT EXISTS`, backward-compatible).
