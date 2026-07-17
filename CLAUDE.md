# Habitrack

A simple, personal habit tracker — a cleaner take on [beaverhabits](https://github.com/daya0576/beaverhabits). Single user, passcode-gated, deployed on Cloudflare Pages with a Neon Postgres backend.

**Live:** https://habitrack-6yj.pages.dev (Cloudflare account: **Praveen**)

## Stack

- **Astro 5** (`output: 'server'`) with the **`@astrojs/cloudflare` v12** adapter (v12 is the Astro-5-compatible line; v14+ needs Astro 7).
- **Tailwind v4** via `@tailwindcss/vite` (no config file). Dark mode is class-based through `@custom-variant dark` in `src/styles/global.css`.
- **Neon Postgres** via `@neondatabase/serverless` (HTTP `fetch` driver — works on the Workers runtime; do NOT switch to a TCP `pg` driver).
- Frontend is **vanilla JS inside `src/pages/index.astro`** (one `<script is:inline>`). No framework, no build-time JS beyond Astro/Vite.
- Image optimization is disabled (`passthroughImageService`) so `sharp` is never pulled — it has no Node 26 prebuilt and no place on Workers anyway.

## Layout

```
src/
  pages/
    index.astro          # entire UI + client JS (gate, grid, calendar, stats, github graph)
    api/
      habits.js          # GET list / POST create
      habits/[id].js     # DELETE / PATCH
      checkins.js        # POST toggle a day
  lib/
    db.js                # getSql(env) + query helpers (all take `sql` as 1st arg)
    auth.js              # passcode gate: isAuthed(request, env), UNAUTHORIZED
  styles/global.css      # tailwind import, dark variant, safe-area, no-scrollbar
public/                  # icons, manifest.webmanifest, robots.txt (blocks all)
scripts/init-db.mjs      # idempotent schema create + seed
wrangler.jsonc           # Pages config (account_id, nodejs_compat, dist)
```

## Environment / secrets

Read from the **Workers runtime env** per request, never `process.env` at module load.

- `NEON_DB` — Postgres connection string.
- `APP_PASSCODE` — the shared passcode gate (currently `habits20206`).

Access pattern: endpoints get `locals.runtime.env`; pass it to `getSql(env)` / `isAuthed(request, env)`.

- **Local dev:** values live in `.dev.vars` (gitignored). `platformProxy` exposes them via `locals.runtime.env`.
- **Production:** set as Cloudflare Pages **secrets** (`wrangler pages secret put <NAME>`), NOT in `wrangler.jsonc`.
- `.env` holds `NEON_DB` for `npm run db:init` only (plain node script).

## Auth model

Passcode-gated, single user. The **API enforces it server-side** — every route returns 401 unless the `x-passcode` header matches `APP_PASSCODE`. The page does **not** server-render habit data; the client loads it via `/api/habits` with the header. Passcode is kept in `localStorage` (`habitrack_passcode`) so there's no re-entry. A 401 clears it and re-shows the gate. This means an unguessable URL alone is not the protection — the passcode is.

## Data model

- `habits (id, name, emoji, color, sort_order, schedule TEXT, created_at)`
  - `schedule` = CSV of JS weekday numbers (`0`=Sun … `6`=Sat), default `0,1,2,3,4,5,6`.
- `checkins (id, habit_id → habits ON DELETE CASCADE, day DATE, UNIQUE(habit_id, day))`

Stats/streaks/heatmaps are computed **client-side** from the `days` array (last 400 days) returned by `listHabits`. Non-scheduled days are "rest days": not counted, streaks skip over them without breaking. See `stats(habit)` and `schedOf(h)`/`dow()` in `index.astro`.

## Commands

```bash
npm run dev        # astro dev (HMR) — uses .dev.vars
npm run db:init    # create/upgrade schema on Neon (idempotent), seeds if empty
npm run build      # astro build → dist/
npm run preview    # wrangler pages dev dist (real Workers runtime, local)
npm run deploy     # build + deploy to Cloudflare Pages (Praveen account)
```

Set a production secret: `echo "<value>" | wrangler pages secret put <NAME> --project-name habitrack`

## Conventions / gotchas

- New DB query helper → export from `db.js` taking `sql` as the first arg; call `getSql(locals.runtime?.env)` in the endpoint.
- New API route → guard with `if (!isAuthed(request, locals.runtime?.env)) return UNAUTHORIZED;` first.
- Per-habit color is inline hex from the `COLORS` map (Tailwind can't see dynamic classes) — keep using inline `style`, not dynamic class names.
- Dates are handled as local `YYYY-MM-DD` strings via the `iso()`/`addDays()` helpers — avoid `toISOString()` on raw dates (UTC off-by-one).
- Deploys target the **Praveen** Cloudflare account (`account_id` pinned in `wrangler.jsonc`). Never deploy to Masa.
- After schema changes, re-run `npm run db:init` (uses `ALTER TABLE … IF NOT EXISTS`).
