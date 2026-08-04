# Habitrack

A personal habit tracker, a cleaner take on [beaverhabits](https://github.com/daya0576/beaverhabits). **Multi-profile** (each profile has its own passcode + habits), realtime cross-device sync, deployed on Cloudflare Pages with a Neon Postgres backend.

**Live:** https://habitrack-6yj.pages.dev

## Stack

- **Astro 5** (`output: 'server'`) with the **`@astrojs/cloudflare` v12** adapter (v12 is the Astro-5-compatible line; v14+ needs Astro 7).
- **Tailwind v4** via `@tailwindcss/vite` (no config file). Dark mode is class-based through `@custom-variant dark` in `src/styles/global.css`.
- **Neon Postgres** via `@neondatabase/serverless` (HTTP `fetch` driver that works on the Workers runtime; do NOT switch to a TCP `pg` driver).
- **Two frontend styles, mid-migration to Preact:**
  - `index.astro` (main app) is still **vanilla JS**: a bundled module `<script>` importing `src/lib/compute.js`.
  - The **`/profile` hub** (Overview / Switch / Manage tabs, + Login / Create) is built from **Preact islands** (`@astrojs/preact` **v4**, the Astro-5 line; v6 breaks the Cloudflare build with an unresolved `astro:preact:opts`). Each `.astro` route **SSR-fetches its data** (via the cookie) and hydrates a focused component with **`client:load`** and props, so there's no loading spinner. Overview is `/profile` (the default tab). Plan: migrate `index.astro` to Preact next.
- **Realtime** via Pusher Channels (`pusher` server + `pusher-js` client, cluster `ap2`).
- Image optimization disabled (`passthroughImageService`) so `sharp` is never pulled (no Node 26 prebuild, no place on Workers).

## Layout

```
src/
  pages/
    index.astro          # signed-in app: SSRs own habits + identity → <HabitApp mode="app">
    p/[id].astro         # PUBLIC profile, no session: SSRs a public profile's habits
                         # → <HabitApp mode="public" viewing={{id,name}}>; private/missing → /switch
    overview.astro       # redirect → /profile (kept for old links)
    profile/
      index.astro        # /profile = Overview tab (SSR own habits → <Overview client:load>); unauthed → /switch
      switch.astro       # SSR profiles+invites+shared → <Switch client:load>
      login.astro        # SSR target profile (?id) → <Login client:load>
      create.astro       # SSR profiles (dup check) → <Create client:load>
      manage.astro       # SSR me+profiles+shares+presence → <Manage client:load> (auth-gated)
      demo.astro         # PUBLIC demo: SSRs the hardcoded seed → <HabitApp mode="demo"> (no DB, no auth)
      demo/
        overview.astro   # PUBLIC demo Overview: SSRs the seed → <Overview mode="demo">, then the
                         # island swaps in the visitor's localStorage sandbox (no DB, no auth)
      stats.astro        # admin-only demo traffic (gated + is_admin check); plain Astro, no island
                         # (the "Demo stats" hub tab, tab="stats")
      overview.astro     # redirect → /profile
  layouts/
    ProfileLayout.astro  # /profile shell: <AppHeader> + hub tab nav when `tab` is set:
                         # Overview/Manage/Switch, plus "Demo stats" when `admin`. Every
                         # tabbed page passes `admin` so the nav doesn't change shape between
                         # tabs and non-admins never see a tab that just redirects them.
                         # `mode="demo"` (demo/overview only) stamps <html data-mode>, points
                         # Back at /profile/demo, and flips robots to index,follow.
  components/
    AppHeader.astro      # THE shared header (index + all /profile pages): logo→home, date, account
                         # chip + dropdown menu (Overview/Manage/Switch/Log out), theme toggle, and one
                         # self-contained <script> owning chip menu + theme + presence heartbeat + admin
                         # online badge. `showAdd`/`showOverview` props add the app-only buttons;
                         # `showSignIn` swaps them for a Sign in link (public view, no session).
                         # `overviewHref`/`habitsHref` retarget those two links, which is how the
                         # demo reaches its own Overview and its own home instead of /profile and /.
    HabitApp.astro       # THE whole app body (vanilla JS): Habits/Streaks tabs, list, calendar,
                         # realtime, two-track Today card, emoji picker, add buttons. Rendered by
                         # index.astro, p/[id].astro AND profile/demo.astro; one `mode` prop
                         # ('app'|'public'|'demo') picks the surface, also stamped on <html data-mode>
    Overview.jsx         # Preact: TWO sections, one per kind, each with its own cards, chip row and
                         # filter state (habits: avg/perfect/longest + aggregate heatmap; quits:
                         # clean/longest/slips + per-quit streakGraph) + CSV/JSON export (ALL
                         # habits, quits included) (SSR habits via props).
                         # `mode="demo"` reads the localStorage sandbox instead of the API and
                         # skips realtime, which is how /profile/demo/overview reuses this island.
    profile/
      ui.jsx             # shared classes, icons, presence(), <Msg>, <Confirm>
      Login.jsx Create.jsx Switch.jsx Manage.jsx   # focused Preact islands, one per route
  pages/api/
      habits.js          # GET list (own; or ?profile=<id> if public or shared; ?profile needs
                         # no session, that's the public-profile read path) / POST create
      habits/[id].js     # DELETE / PATCH (edit name/emoji/color/schedule)
      habits/reorder.js  # POST {ids:[...]} -> set sort_order (token-scoped)
      checkins.js        # POST toggle a day (token-scoped; only within the BACKFILL_DAYS window)
      login.js           # POST {profileId,passcode} -> token + sets session cookie (throttled: 5 fails -> 15min lock, 429)
      logout.js          # POST clears the session cookie
      session.js         # POST re-issues the session cookie from a Bearer token (PWA/Safari cookie loss)
      profiles.js        # GET list (public: id/name/is_public) / POST create (open, sets session cookie)
      profiles/[id].js   # DELETE (self or admin) / PATCH (rename; passcode + isPublic are self-only)
      shares.js          # GET {shared,sharedWithMe,invites} / POST invite / PATCH accept / DELETE ?viewer|?owner
      heartbeat.js       # POST bump own last_active_at (presence)
      presence.js        # GET (admin only) {online, profiles:[{name,last_active_at,online}]}
      rt-config.js       # GET public Pusher key+cluster
      demo-visit.js      # POST {visitorId} bump demo traffic (public: the demo has no session)
  middleware.js          # server-side auth gate: /,/profile/manage,/profile/stats → /profile if no
                         # cookie (/profile self-guards → /switch; /p/<id> + /profile/demo ungated)
  lib/
    db.js                # getSql(env) + query helpers (all take `sql` first, scoped by profileId)
    auth.js              # PBKDF2 hash/verify + signed tokens; verifyToken, authedProfile (header|cookie), sessionCookieOpts
    realtime.js          # broadcast(env, profileId, payload, socketId) -> Pusher REST
    compute.js           # shared client helpers: dates, COLORS, stats, heatmaps, export, connectRealtime,
                         # apiFetch, + habit-creation rules (normalizeSchedule/resolveStartDate/
                         # scheduledDays) shared by the API and the demo sandbox
    render.js            # HTML for the COLLAPSED habit list (week strip, name row, Today
                         # card, tab classes), used by BOTH the SSR frontmatter and the
                         # client so first paint needs no JS. Pure strings, `today` is
                         # always an argument. Expanded cards stay in HabitApp.
    demo.js              # demoSeed() (hardcoded demo data, generated relative to today, day-cached)
                         # + demoApi()/load/save/clear (localStorage stand-in for the write API)
                         # + trackDemoVisit()
  styles/global.css      # tailwind import, dark variant, safe-area, no-scrollbar
public/                  # icons, manifest.webmanifest, sw.js, robots.txt (blocks all)
scripts/init-db.mjs      # idempotent schema create/migrate + seed
wrangler.jsonc           # Pages config (nodejs_compat, dist), NO account_id (Pages rejects it)
```

> `compute.js` was renamed from `analytics.js` because ad/privacy blockers block any file named `analytics`.

## Environment / secrets

Read from the **Workers runtime env** per request (`locals.runtime.env`), never `process.env` at module load.

- `NEON_DB`: Postgres connection string.
- `AUTH_SECRET`: HMAC key for signing session tokens (infra key, not a passcode).
- `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER`: realtime.

`APP_PASSCODE` is legacy (only `init-db.mjs` reads it to seed the default profile's passcode).

- **Local dev:** values in `.dev.vars` (gitignored); `platformProxy` exposes them via `locals.runtime.env`.
- **Production:** Cloudflare Pages **secrets** (`wrangler pages secret put <NAME> --project-name habitrack`).
- `.env` mirrors `NEON_DB` (+ Pusher/`AUTH_SECRET`) for the plain-node `db:init` script.

## Auth model (multi-profile)

Passcodes are **hashed** (PBKDF2-SHA256 + salt) in the `profiles` table, never in env. Flow:

1. `POST /api/login {profileId, passcode}` verifies the hash → returns a **signed token** (`profileId.exp.hmac`, HMAC over `AUTH_SECRET`).
2. Client stores `habitrack_token` + `habitrack_profile` ({id,name,admin}) in localStorage; sends `Authorization: Bearer <token>` on every request.
3. `authedProfile(request, env)` verifies the token and returns the `profileId`; **all data queries are scoped to it**. Verification is HMAC + expiry **plus one cheap indexed `token_version` read** (revocation, below).

Profile creation is **open** (anyone with the URL). The first/default profile (`is_admin=true`) can delete any profile; others can only delete/manage their own. The page never server-renders data; the client loads it via the API with the token.

**Where an admin actually deletes someone else:** the trash button on each row of Manage's **"Everyone"** card (`Manage.jsx`), which confirms first and then calls `DELETE /api/profiles/<id>`. That endpoint has always accepted self-or-admin, but nothing in the UI reached the admin half, so the power described above was real and unusable. Your own row has no trash icon on purpose: deleting yourself also has to clear localStorage and navigate away, which is what **"Delete this profile"** at the bottom of the page does. The server refuses to delete the last remaining profile (400), so the roster can never end up empty. Deleted ids go into one `deleted` list in component state, because the row has to vanish from both the "Everyone" card and the share dropdown and those two are built from different props.

**Session = httpOnly cookie + server-side gate (no client-auth flicker).** Login/create set an httpOnly `habitrack_token` cookie (`sessionCookieOpts`, `secure` in prod) in addition to returning the token. `src/middleware.js` gates `/` and `/overview`: it verifies the cookie and **302s to `/profile` before any HTML is sent** if there's no valid session, so a signed-out visit never paints the app. `authedProfile(request, env)` reads the token from the `Authorization` header *or* the cookie, so same-origin fetches authenticate on the cookie alone. `/api/logout` clears it. `verifyToken(token, env)` is the shared check (HMAC + expiry + `token_version`).

**Gated pages read `Astro.locals.profileId`, they do not re-verify.** After a successful check the middleware stashes the id on `context.locals.profileId`, and `index.astro` / `manage.astro` use that instead of calling `verifyToken` again. Each `verifyToken` costs a Neon round trip for the `token_version` read, so re-verifying doubled the page's time-to-first-byte for no benefit. `locals.profileId` is only ever set after verification succeeds; ungated pages (`/profile`, `/profile/switch`) still verify for themselves.

**Token revocation (`token_version`).** Tokens embed a `token_version` inside the signed payload (`<profileId>.<exp>.<version>.<hmac>`); `verifyToken` confirms it still matches `profiles.token_version` (one indexed PK read), so a token can be invalidated server-side. **Changing a passcode bumps the version**, revoking every previously-issued token, then re-issues a fresh token+cookie for the current session (the PATCH response carries the new `token`; `Manage` stores it). Deleting a profile also kills its tokens (the row is gone → version read returns null). Legacy pre-versioning 3-part tokens are treated as version 0, so they stay valid until the next passcode change. The DB read fails **closed** (a DB error → unauthenticated, never a 500 out of the gate). Logout still only clears the cookie (per-device); it does not bump the version.

**PWA / Safari cookie loss → session restore.** Installed PWAs (iOS standalone especially) and Safari ITP can drop the httpOnly cookie while **localStorage keeps the token**, so the middleware gate 302s `/` → `/profile` even though the client is "logged in", stranding the user on the picker. Fix: `POST /api/session` re-issues the cookie from a valid `Authorization: Bearer` token (no DB). The logged-out `Switch` picker (`me=null`) checks for a localStorage token on mount and, if present, calls `/api/session` and goes to `/` (shows "Restoring your session…"); a stale token clears localStorage and falls back to the picker. **Realtime is unaffected**: Pusher uses public channels (`habitrack-<profileId>`) with just the public key+cluster (no authorizer, no cookie), and all client API calls authenticate via the Bearer header, so only the server-side navigation gate ever depended on the cookie.

**Public profiles (opt-in, read by anyone).** `profiles.is_public` (default false) makes a profile readable at **`/p/<id>`** by anyone, **signed in or not**. The owner flips it in Manage (confirmation on the way out, immediate on the way back), which also shows the copyable link. Only the owner can flip it. An admin who can rename another profile still gets a 403 on `isPublic`, since publishing someone is a privacy decision, not an admin one. The logged-out picker badges every row **Private** or **Public**: a private row taps through to `/profile/login`, a public row opens `/p/<id>` and carries a separate "Sign in" chip so the owner can still reach the passcode screen. `/p/<id>` returns a redirect to `/profile/switch` for a private *or* nonexistent id, so it can't be used to probe which ids exist. Server side: `GET /api/habits?profile=<id>` requires **no session** (that's what makes an anonymous read possible) but still goes through `canViewProfile`, which passes only if the target is public or an accepted share exists. One query covers both, and with a null caller the share `EXISTS` is simply false. **Everything else is unchanged**: mutating endpoints still ignore `?profile` and still demand a session, so an anonymous visitor physically cannot write. Public profiles stay out of search engines (`robots.txt` disallows them, plus a `noindex` meta), because public means "anyone with the link or the picker", not "indexed". `/profile/demo` is the one exception, see "Search visibility" below.

**The demo (`/profile/demo`) is writable but never touches the database.** It's the link to hand strangers. `lib/demo.js` holds a **hardcoded** seed (8 habits/quits) generated relative to today, so streaks stay current and it can't go stale or empty. Deliberately *not* sourced from a real profile: that would mean curating a prod profile forever, and letting visitors write to it would mean cleaning up after them. The page SSRs the seed into `#initial-habits`; the client forks it into `localStorage.habitrack_demo` and **`api()` is swapped for `demoApi()`**, which answers every endpoint locally with the same `{ok,status,data}` shape. So add/edit/delete/reorder/check-in all work for a visitor with no session and no writes. Realtime is off (no server-side profile to watch). Three things to keep in mind when touching this. **The habit-derivation rules are shared, not copied**: `normalizeSchedule`, `resolveStartDate` and `scheduledDays` live in `compute.js` and are called by both `api/habits.js` and `demoApi`. An earlier copy in `demoApi` had already drifted (it returned `schedule` as an array where the real endpoint returns CSV, which broke `schedOf` after a demo edit). **The sandbox is persisted by an explicit `persist()` at the five mutation sites**, not from `render()`, because `render()` also runs for pure UI (expanding a card, paging the calendar, switching tabs) and persisting there re-stringified every habit and hit localStorage synchronously on each of those. **`#initial-state` keeps the pristine seed** in the DOM, which is what Reset restores. Everything except `GET /api/habits`, `POST /api/habits` and PATCH is applied optimistically by the caller, so `demoApi` only needs to acknowledge it.

**The demo has its own Overview at `/profile/demo/overview`.** Without it a stranger could use the app but never reach the stats screen, since `showOverview` was app-only and `/profile` is auth-gated. It renders the **same `Overview.jsx` island** as the signed-in tab, switched by `mode="demo"`: the island reads `loadDemo()` instead of `GET /api/habits`, and binds no realtime (there is no server-side profile to have a channel). The page SSRs the pristine seed so it paints with content and a crawler sees it, then the island swaps in the sandbox on mount, so a visitor who edited their demo sees a brief correction rather than the seed's numbers. Two links had to become configurable for this: `AppHeader`'s `overviewHref` (so the demo's Overview button goes to its own copy, not `/profile`) and `habitsHref` (so Back from the demo overview goes to `/profile/demo`, not `/`). Both default to the old hardcoded values, so nothing else moved. `ProfileLayout` gained `mode`, which stamps `data-mode` for the same reason `HabitApp` does, and which also makes the page indexable, since it is part of the demo surface.

**The demo header shows Overview and not Sign in** (`showSignIn={mode === 'public'}`). The header's action row fits three items at 390px, and a fourth pushes it over, which is the overflow `da8f891` already fixed once. Sign in is the right one to drop: it exists so the owner of a **public profile** can reach their passcode screen, and a demo has no owner. The logo still links to `/`, which sends a signed-out visitor to the picker, so the path to an account is not lost. Adding anything else to that row means removing something first.

**Demo traffic counting.** `demo_visits (visitor_id, created_at)`, one row per visit. Identity is a `crypto.randomUUID()` in `localStorage.habitrack_demo_visitor` (no login, no IP, no fingerprint), so "unique visitors" means "browsers that kept the id". `POST /api/demo-visit` is necessarily public (the demo has no session); it charset/length-checks the id and swallows insert errors so analytics can never break the demo. One POST per tab session (`sessionStorage`), so reloads don't inflate counts. `/profile/stats` (admin-only) shows totals, a 30-day bar breakdown, and per-visitor last-seen.

**`HabitApp.astro` is the app body; three routes render it, distinguished by ONE `mode` prop** (`'app' | 'public' | 'demo'`) so there are no illegal combinations and each branch reads the mode instead of re-deriving it from a pile of booleans. `index.astro`, `p/[id].astro` and `profile/demo.astro` each SSR their own data and hand it to the same component, so the three surfaces can't drift apart. The whole starting state (`{mode, habits, profile, viewing}`) travels in **one** `<script id="initial-state" type="application/json">` and is decoded once; `mode` is also stamped on `<html data-mode>` because `AppHeader` has its own script that would otherwise re-derive the surface from localStorage and disagree (a signed-in visitor on `/p/<id>` would get their account chip *and* a Sign in button, and would heartbeat from a page that isn't their app). The client reads `habitrack_viewing` from localStorage only when the SSR state has no `viewing`. In a public view `boot()` renders the SSR'd habits immediately (they already belong to the viewed profile, so no fetch), realtime still binds (Pusher channels are public), the read-only banner is **SSR'd visible** so a public link never flashes as if it were your own app, and the iOS install hint is suppressed. `AppHeader` gets `showAdd={false}`, so anything touching `#add-btn` must stay null-safe. Read-only chrome is applied **once in `enterApp()`** (keyed on `readOnly()`), not per render: `viewing` can't change without a reload, and `render()` runs on every check-in.

**The habit list is server-rendered (`src/lib/render.js`).** The list used to appear only after a 37KB module had downloaded, parsed and run, even though the data was already in the HTML. The collapsed-card markup now lives in `render.js` and is called by **both** HabitApp's frontmatter and its client script, so the two emit identical strings and the client's first `render()` is an invisible repaint. Only the **collapsed** form is shared; expanded cards (month calendar, graphs, reorder) need client-only state and stay in HabitApp.

Three things this had to solve, all of them worth preserving:

- **Dates.** The Worker runs in UTC, so a week strip rendered server-side would be a day off for anyone whose local date differs right then, and would visibly jump when the client re-rendered. The server uses `todayInZone(Astro.locals.runtime.cf.timezone)` (Cloudflare's geo-IP zone) and falls back to `iso(new Date())`. `stats`/`streakStats`/`startOf` therefore take an optional `today` argument instead of closing over the module-level `TODAY`. Note `Intl` with `timeZone: undefined` does **not** throw, it silently uses the runtime zone, so `todayInZone` guards the empty case explicitly or the fallback becomes unreachable.
- **State the server can't know.** The tab (`habitrack_tab`), share-preview (`habitrack_viewing`) and the demo sandbox (`habitrack_demo`) all live in localStorage. The server always renders the default `normal` tab with its own data; the inline `is:inline` script in `<head>` sets `data-ssr-stale` on `<html>` **before `<body>` is parsed** when any of those differ, CSS hides the three SSR'd regions (`global.css`), and the client deletes the flag after its first render. So the wrong list is never painted, and the common case still paints instantly.
- **`created_at` is a `Date`.** `listHabits` returns it as a Date and the render helpers call `.slice()` on it, so HabitApp normalises it to an ISO string once for both the SSR pass and the embedded JSON.

**`index.astro` SSRs the initial habits.** Since middleware guarantees a valid cookie, the page frontmatter fetches the signed-in profile's habits and embeds them in a `<script id="initial-habits" type="application/json">` (with `<` escaped); the client renders from that immediately, then reconciles with a background fetch. View-mode (a client-only concept via `habitrack_viewing`) still fetches the viewed profile. **It also SSRs the profile identity (id/name/admin, cookie-derived) and the client hydrates `localStorage.habitrack_profile` from it when empty**, because iOS copies the session cookie into an installed PWA at install time but *not* localStorage, so without this the cookie is valid while the client has no profile and `boot()` bounces `/ ⇄ /profile` forever. Same-origin API calls authenticate on the cookie, so the missing localStorage token is harmless.

**The gate is a set of real routes under `/profile/`** (switch, login, create, manage), each an SSR page + focused Preact island, not a modal or client view-state. `index.astro` holds no gate. The chip menu's Manage/Switch navigate to `/profile/manage` / `/profile/switch`; Log out POSTs `/api/logout` + clears localStorage → `/profile`. After login/create/pick-self, the island navigates back to `/`. localStorage holds the non-sensitive `profile` ({id,name,admin}) for UI labels (+ a redundant token copy, pending cleanup). Note: server-side `listHabits` returns `created_at` as a `Date`, so normalize to an ISO string before passing habits as island props (`compute.js` expects strings; the JSON API path gets this for free).

**View-only sharing (accept-based).** A profile invites another to view its data (accountability). Shares start **pending** (`accepted_at IS NULL`): the recipient must accept before `canViewProfile` grants anything. `habits` GET accepts `?profile=<id>`: if present and not the caller's own id, the server checks `canViewProfile(sql, caller, target)` (public profile *or* an *accepted* `profile_shares` row) and 403s otherwise. NB: parse the param as `raw != null ? Number(raw) : null`, because `Number(null)===0` and `Number.isInteger(0)` is true, so a naive `Number(...)` wrongly treats "no param" as profile 0 and 403s own data. **Mutating endpoints never honor `?profile`**: they always scope to the caller's own id, so a viewer physically cannot write. Client: `habitrack_viewing` ({id,name}) in localStorage puts index + overview into read-only mode (banner, no add/edit/delete/toggle/reorder, cells render as inert `<div>`s); entering/leaving reloads the page so realtime rebinds to the viewed profile's channel. **The signed-in Switch tab is preview-only**: it lists just your own profile ("Signed in as"), **Invites** (accept/decline), and **Shared with you** (tap = enter preview/view mode, **no passcode**, they shared access, not their passcode). It does **not** list the full profile roster and has **no "New profile"**, because creating profiles is an onboarding action, so the roster + create button live only in the **logged-out picker** (`Switch` with `me=null`, tapping a profile → `/profile/login`). Manage screen invites (dropdown), shows pending/active, and revokes.

**Login throttle.** `profiles.failed_attempts` + `locked_until`: 5 consecutive wrong passcodes lock the profile for 15 min (login returns 429); a correct passcode clears the counter. Passcode min length is **6** (create + change). Profile names are **not unique** (ids scope everything), so the create form only soft-warns on a duplicate.

**Presence.** `profiles.last_active_at` = "last active in the app". `AppHeader`'s script `POST`s `/api/heartbeat` on load and every 45s while the tab is visible, on **every** page (app + all /profile pages), since the header is shared (so multi-device = one row, deduped by profile). "Online" = active within 120s. `GET /api/presence` (admin only) returns the online count + every profile's last-active (shown in the manage screen's "Everyone" card, which is also where an admin deletes another profile). `last_active_at` also rides along in `/api/shares` listings, so both sides of a share see each other's presence (green "online" dot or a fuzzy `timeAgo`). It is *not* exposed on the public `/api/profiles` roster. Semantic note: we intentionally track "last opened", not "last check-in": the check-in data itself already shows when someone last acted.

**Astro CSRF:** non-GET requests without a matching `Origin` header are 403'd. Browsers always send `Origin`; `curl` tests must add `-H "Origin: <base>"`. JSON bodies are exempt.

## Data model

- `profiles (id, name, passcode_hash, is_admin, is_public, failed_attempts, locked_until, last_active_at, created_at)`
  - `is_public` = anyone can read this profile at `/p/<id>`, no session. Default false.
- `habits (id, profile_id → profiles ON DELETE CASCADE, name, emoji, color, sort_order, schedule TEXT, kind TEXT, start_date DATE, created_at)`
  - `schedule` = CSV of JS weekday numbers (`0`=Sun … `6`=Sat), default `0,1,2,3,4,5,6`.
  - `kind` = `'normal'` (build a habit) or `'streak'` (quit/abstain). Default `'normal'`. See "Habit kinds" below.
  - `start_date` = when tracking began, backdated at create time. Nullable; falls back to the created date.
- `checkins (id, habit_id → habits ON DELETE CASCADE, day DATE, UNIQUE(habit_id, day))`
- `demo_visits (id, visitor_id TEXT, created_at)`: one row per `/profile/demo` visit. No FK: visitors have no profile.
- `profile_shares (id, owner_id → profiles, viewer_id → profiles, created_at, accepted_at, UNIQUE(owner_id, viewer_id))`: owner invites viewer to read-only access; `accepted_at` NULL = pending. Both FKs `ON DELETE CASCADE`.

Stats/streaks/heatmaps are computed **client-side** from each habit's `days` array. Non-scheduled days are "rest days" (not counted; streaks skip them). "Active from" = earlier of a habit's created date / first check-in; days before that are never "missed". See `compute.js`.

**Backfill window.** A check-in can be marked/unmarked for today and the recent past, capped by `BACKFILL_DAYS` (in `compute.js`, currently 7); change that one constant to widen/narrow it. The week strip renders markable days as a hollow ring (◯ = tap to complete), done days as a ✓ in the habit color, and days older than the window as a faint locked ✕; the month calendar makes older days inert `<div>`s (view-only history). `/api/checkins` re-checks the window server-side (coarse UTC guard with ±1 day of timezone slack) so it holds outside the UI.

## Habit kinds (normal vs streak)

Two tracker types share one `habits` table and one `checkins` table, with **opposite meanings for a checkin row**. Get this backwards and the stats invert silently.

- **`normal`** (build a habit): a `checkins` row means **done**. Absence on a scheduled day means missed.
- **`streak`** (quit/abstain): a `checkins` row means **slipped**. Every other day from `start_date` to today is clean by default, so the streak accrues with no daily interaction. That is the point of the kind: quitting something needs zero taps on a good day.

Consequences worth remembering:

- **Streak habits have no rest days.** `/api/habits` forces `schedule` to all seven days when `kind === 'streak'` (`habits.js:53`), because "not scheduled today" is meaningless for abstaining.
- **A slip logged for today is graced**, not counted, in `streakStats()`. The day is not over, which mirrors how normal-habit streaks treat today.
- **`startOf(habit)`** is `start_date` when set, else the created date. Days before it are never counted for either kind.
- **Creating a `normal` habit with a backdated `startDate` backfills check-ins** for every scheduled day from that date to today (`habits.js:69`), so an existing streak carries over. Creating a `streak` habit backfills nothing, since no rows means clean.
- `compute.js` exports `isStreak()`, `startOf()`, `streakStats()` and `streakGraph()`. `stats()` dispatches on kind, so call it rather than branching at the call site.
- **The Overview is two sections, one per kind**, because no card can average the kinds together: a clean day is not a completion, so a quit in "Avg completion" would put slip days into a completion rate and invert it. Habits keep avg/perfect/longest and the aggregate heatmap; quits get **Clean days / Longest / Slips** (`quitAggregate()`) and a per-quit `streakGraph()`. Each section owns its own chip row and filter state, and each renders only when that kind has rows, so the "No habits yet" empty state now appears only when there is nothing at all (before this, a quits-only profile saw it and nothing else). There is no "All quits" aggregate, so one quit is always selected: `qFilter` starts null and render falls back to `quits[0]`, which also covers the selected quit being deleted. In `quitAggregate`, clean days and slips are windowed to 12 months so they agree with the heatmap under them, while `longest` is deliberately all-time, since capping a multi-year clean run at 365 would understate the one number a quit tracker exists to show (the habits row's "Longest streak" is all-time for the same reason).
- **The export has one vocabulary per kind**, since `done`/`missed` would state the opposite of the truth for a quit. `buildExportRecords` emits `done` / `missed` / `not_scheduled` for `normal` and `slipped` / `clean` for `streak`, plus `before_created` for both, and carries a `habit_kind` column so a reader knows which set applies. Its row range also follows each kind's own stats function: `startOf()` for a quit (nothing backfills its check-ins, so `start_date` is the only record that tracking began earlier) and `activeFromOf()` for a habit, floored by the earliest check-in either way so no existing row is dropped from the file.

The app UI splits the two with a **kind switcher** (`#kind-tabs`) above the list. The active tab also decides what the `+` button creates. There are **two** add buttons: the small `#add-btn` in the header and the permanent dashed `#add-btn-bottom` under the list (people were missing the header one). The bottom one is always visible except in read-only views, and `render()` sets its label from the active tab. It replaced the old empty-state-only button, so the empty state now has text only. The Today card is **two-track**: one ring for habits due today, one for quits still clean today, each rendered only if that track has anything to show.

## Realtime

On any check-in / add / delete / edit (`update`) / reorder, the endpoint calls `broadcast(env, profileId, payload, socketId)` → a signed Pusher REST trigger (manual `node:crypto` md5+hmac, works on workerd) to channel **`habitrack-<profileId>`**, excluding the originating socket. Payload `type`s: `checkin`, `add`, `delete`, `update` (carries the full habit sans `days`), `reorder` (carries `ids`). Clients subscribe to their own profile's channel and `applyRemote()` mutates local state surgically (no refetch). Dropped-socket safety net: `pusher-js` auto-reconnects and resubscribes, and both surfaces refetch on `visibilitychange`/`pageshow` (and reload on a day rollover), so a returning tab reconciles any missed events.

## PWA

`public/manifest.webmanifest` + icons + `public/sw.js` make it installable. iOS install is Share → Add to Home Screen (the `#ios-install` hint banner); no in-app install button (rely on the browser's own install control).

**Search visibility: only the demo is indexable.** `robots.txt` disallows everything and then allows `/profile/demo`, which by prefix also covers `/profile/demo/overview`. `HabitApp.astro` and `ProfileLayout.astro` both emit `index, follow` for `mode === 'demo'` and `noindex, nofollow` otherwise. All three have to agree, so change them together or not at all. The reasoning: the app is a signed-in surface, and public profiles at `/p/<id>` are "anyone with the link", which is not the same as consenting to be indexed. The demo is hardcoded sample data with no session and nothing real to leak, and it is the link worth being findable. The demo also carries its own `<meta name="description">` for the same reason.

**iOS launch images (`public/splash/`, generated).** An installed iOS web app shows a blank **white** screen for the entire cold start unless it is handed an `apple-touch-startup-image` matching the device exactly; every other platform derives one from the manifest. `npm run splash` (`scripts/gen-splash.mjs`) owns a device table and emits both the PNGs and `src/components/SplashLinks.astro`, so the images and their media queries cannot drift. Add new hardware to `DEVICES` and re-run; output is byte-deterministic, so re-running never churns the diff. `SplashLinks` is included by `HabitApp.astro` **and** `ProfileLayout.astro`, since a launch can resume on any page.

The images are a **flat fill** in the app's own background colour (`#f8fafc` / `#020617`, matching the `theme-color` metas and the `<body>` classes), not a logo splash. That follows Apple's guidance that a launch screen should resemble the app's first frame rather than advertise it: the handoff is invisible instead of a branded card that flashes away. It also means no image library, which matters because `sharp` is deliberately absent from this project: the PNGs are written by hand with `node:zlib` as 1-bit paletted images, so each is under 500 bytes (24 files, ~10KB total, and a device only ever downloads the one that matches).

**Cache headers (`public/_headers`).** Cloudflare Pages defaults every static asset to `max-age=0, must-revalidate`, so before this file existed a cold PWA launch revalidated the CSS and the JS bundle over the network **before it could paint** (2 blocking requests / 75KB on the app, 3 / 45KB on the gate). `/_astro/*` is now `max-age=31536000, immutable`, which is safe precisely because the filenames are content-hashed. `sw.js` and `offline.html` stay `must-revalidate` (cache the SW and a broken one can never be replaced); the manifest gets an hour and the icons a day, since their names are stable. This only applies to paths in `dist/_routes.json`'s `exclude` list; SSR pages come from the Worker and are untouched.

**Service worker (online-first).** The app is server-rendered/auth-gated/realtime, so the SW **never caches app HTML**. Caching it broke reopen two ways: stale HTML pointing at old hashed `/_astro` assets (404 after a deploy → blank app), and *"a redirected response was used…"* errors when a signed-out `/` (302 → `/profile`) got cached/returned for a navigation. Strategy: **navigations go to the network** (via `navigationPreload` when supported; iOS falls back to `fetch`), redirected responses are handed back as a clean copy (avoids the navigation error), and network failure serves a static `public/offline.html`. **`/_astro/*` is cache-first** (the one thing the SW does cache): content-hashed filenames mean a stale entry is never requested again, so this is safe for exactly the reason caching HTML was not, and it keeps a cold launch off the network for everything but the HTML. API calls and non-hashed files pass through untouched. Entries accumulate across deploys within one `CACHE` version; bump the version (`habitrack-vN`) when changing the SW and `activate` purges them. `skipWaiting()` + `clients.claim()` take over on next launch.

**Reopen auto-refresh (no stale data).** A long-lived PWA stays in memory for days with no pull-to-refresh, so pages that render from an SSR snapshot and only refetch on realtime events go stale (the Overview "all habits" graph looked empty until you toggled a chip). Both surfaces now **fetch fresh on mount and on `visibilitychange`/bfcache restore, and reload outright when the day rolled over**. Two traps this fixed: (a) the Overview only refetched on Pusher events, so add a mount/visibility refetch; (b) index's `refresh()` bailed on `if (!token) return`, which is *always* true in a PWA (no localStorage token), so its foreground refresh never ran. Dropped the guard, since same-origin cookie auth works.

## Commands

```bash
npm test           # node --test over test/: pure logic, no DB, no network
npm run dev        # astro dev (HMR), uses .dev.vars
npm run db:init    # create/upgrade schema on Neon (idempotent), seeds if empty
npm run build      # astro build → dist/
npm run preview    # wrangler pages dev dist (real Workers runtime, local)
npm run deploy     # build + deploy to Cloudflare Pages (needs CLOUDFLARE_ACCOUNT_ID exported)
```

## Tests

`npm test` runs `node --test` over `test/` (no dependencies, no DB, no network). It covers the **pure logic only**: date arithmetic, the shared habit-creation rules, `stats()`/`streakStats()`, the demo sandbox, and the shared list markup in `render.js` (read-only vs writable, the backfill window, rest days, escaping). Endpoints, SSR pages and the DOM are not covered and are still verified by hand.

Fixtures are built relative to `compute.js`'s own `TODAY`, so the suite is deterministic on any day and in any timezone. Four suites are worth keeping alive as the app changes:

- **The kind-inversion invariant** (`compute.test.js`) asserts that the *same* `days` array reads as 3 days done for a `normal` habit and 3 slips for a `streak`. That inversion is the one bug in this codebase that produces plausible-looking wrong numbers instead of an error.
- **`quitAggregate` inversion** (`compute.test.js`) pins the Overview's Quits cards: a slip must cost a clean day rather than add one, `longest` is not capped by the 12-month window, and clean/slips are.
- **Export inversion** (`compute.test.js`, `buildExportRecords`) is the same invariant at the file boundary: one check-in date exports as `done` for a habit and `slipped` for a quit, an unmarked quit day is `clean` rather than `missed`, and a quit's backdated `start_date` is not truncated to its created day. The export is where a wrong reading leaves the app and lands in someone's spreadsheet.
- **`demoApi` create parity** (`demo.test.js`) derives what `POST /api/habits` would return straight from `normalizeSchedule`/`resolveStartDate`/`scheduledDays` and requires the sandbox to agree across 12 input shapes. The rules are shared now, but this is what catches it if someone re-inlines them.

The suite was mutation-checked: reverting the CSV fix, the weekday filter, the backdate cap, the streak-forces-daily rule, the today's-slip grace, the seed's defensive copy, or any of the four export-inversion rules each fails at least one test.

## Agent guardrails

`.claude/settings.json` denies **reads** of `.env`, `.env.*` and `.dev.vars`. Those files hold the live Neon connection string, `AUTH_SECRET` and the Pusher secret, and nothing an agent legitimately does here needs their contents: the app reads them through `locals.runtime.env` at runtime, and `db:init` through `process.env`.

A deny rule cannot be overridden by asking, so if you ever genuinely need to change a value in those files, do it yourself or drop the rule first. `CLAUDE.local.md` (gitignored) covers what the rule does and does not enforce, plus the machine-specific setup that has no business in a public repo.

## Conventions / gotchas

- New API route → `const profileId = await authedProfile(request, locals.runtime?.env); if (!profileId) return unauthorized();` then scope all queries by `profileId`.
- DB helpers take `sql` first and (for data) `profileId` second; `getSql(locals.runtime?.env)` in the endpoint.
- Per-habit color is inline hex from the `COLORS`/`COLORS_DARK` maps (Tailwind can't see dynamic classes): inline `style`, never dynamic class names.
- Dates are local `YYYY-MM-DD` via `iso()`/`addDays()`; avoid `toISOString()` on raw dates (UTC off-by-one).
- Client scripts are bundled modules importing `compute.js`, so keep shared logic there so index + overview never diverge.
- All client HTTP goes through `apiFetch` (compute.js), wrapped per-page as `api(path, {method,body})` bound to the live token/socketId. Returns `{ok,status,data}`. Don't hand-roll `fetch` + headers + `JSON.stringify`.
- DDL can't bind params (`sql\`... ${x}\``); inline safe literals via `sql.query('... ' + x)` in `init-db.mjs`.
- `npm run deploy` fails unless `CLOUDFLARE_ACCOUNT_ID` is exported, so it can never pick the wrong Cloudflare account on its own. The id is in `CLAUDE.local.md` (gitignored).
- After schema changes, re-run `npm run db:init` (all `ALTER … IF NOT EXISTS`, backward-compatible).
- **Preact won't re-apply `dangerouslySetInnerHTML` after hydration when the `__html` string is unchanged between renders**: the SSR markup sticks even though a later render computed new HTML (this is why the Overview heatmap stayed at the stale `0`/empty snapshot until toggling a chip changed the string). For imperative/computed innerHTML, set it via a `ref` + `useEffect` on the data dep (e.g. `heatRef.current.innerHTML = agg.heat` on `[agg]`), don't rely on `dangerouslySetInnerHTML` alone.
- **Every Neon call is one HTTP round trip**, so sequential `await`s land directly in time-to-first-byte. Fire independent queries with `Promise.all`, and never re-run a check the middleware already did. Measured on the gated pages: 4 serial round trips to 2 took `/` from 286ms to 146ms.
- **Form controls need a 16px font floor on touch** (`global.css:38`). iOS Safari auto-zooms when a focused control is smaller and never zooms back out. Don't set `text-sm` on an `<input>` without checking that rule still covers it.
- The emoji picker (`EMOJIS` in `index.astro`) is a `[emoji, keywords]` array filtered by a search box. Adding an emoji means adding its keywords too, or it becomes unsearchable.
