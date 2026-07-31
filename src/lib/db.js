import { neon } from '@neondatabase/serverless';

// On Cloudflare the connection string arrives via the Worker runtime env
// (Astro.locals.runtime.env). Locally (astro dev) platformProxy loads it from
// .dev.vars; import.meta.env is the final fallback for plain node dev.
export function getSql(env) {
  const url =
    env?.NEON_DB ||
    (typeof process !== 'undefined' ? process.env?.NEON_DB : undefined) ||
    import.meta.env.NEON_DB;
  if (!url) throw new Error('NEON_DB connection string is not set.');
  return neon(url);
}

// --- Profiles ---------------------------------------------------------------

// Public list (no hashes) for the gate's profile picker. `is_public` rides along
// so the picker can badge each row and send public ones straight to /p/<id>.
export async function listProfiles(sql) {
  return sql`SELECT id, name, is_public FROM profiles ORDER BY id ASC`;
}

export async function getProfile(sql, id) {
  const rows = await sql`SELECT id, name, passcode_hash, is_admin, is_public, failed_attempts, locked_until, token_version FROM profiles WHERE id = ${id}`;
  return rows[0] || null;
}

// Name + id, but only when the profile is public. Returns null for a private or
// missing profile, so /p/<id> can't be used to probe which ids exist.
export async function getPublicProfile(sql, id) {
  const rows = await sql`SELECT id, name FROM profiles WHERE id = ${id} AND is_public`;
  return rows[0] || null;
}

// Just the token_version (cheap, indexed by PK) — used by verifyToken to check a
// token hasn't been revoked. Returns null if the profile no longer exists.
export async function getTokenVersion(sql, id) {
  const rows = await sql`SELECT token_version FROM profiles WHERE id = ${id}`;
  return rows.length ? rows[0].token_version : null;
}

// Invalidate every existing token for this profile by bumping its version
// (called on passcode change). Returns the new version so a fresh token can be
// minted for the current session.
export async function bumpTokenVersion(sql, id) {
  const rows = await sql`UPDATE profiles SET token_version = token_version + 1 WHERE id = ${id} RETURNING token_version`;
  return rows[0]?.token_version ?? 0;
}

// Login throttling: bump the failure count, locking the profile once it hits the
// threshold. Returns the (possibly new) locked_until so the caller can report it.
export async function recordFailedLogin(sql, id, threshold, lockSeconds) {
  const rows = await sql`
    UPDATE profiles
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= ${threshold}
                            THEN now() + ${lockSeconds} * interval '1 second'
                            ELSE locked_until END
    WHERE id = ${id}
    RETURNING locked_until
  `;
  return rows[0]?.locked_until || null;
}

export async function resetFailedLogin(sql, id) {
  await sql`UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = ${id}`;
}

// Presence: mark this profile active now (heartbeat).
export async function touchProfile(sql, id) {
  await sql`UPDATE profiles SET last_active_at = now() WHERE id = ${id}`;
}

// Admin view: every profile with its last-active time and an online flag
// (active within the last `windowSeconds`). Most-recently-active first.
export async function listPresence(sql, windowSeconds) {
  return sql`
    SELECT id, name, last_active_at,
           (last_active_at IS NOT NULL AND last_active_at > now() - ${windowSeconds} * interval '1 second') AS online
    FROM profiles
    ORDER BY last_active_at DESC NULLS LAST
  `;
}

export async function createProfile(sql, name, passcodeHash) {
  const rows = await sql`
    INSERT INTO profiles (name, passcode_hash)
    VALUES (${name}, ${passcodeHash})
    RETURNING id, name, is_admin
  `;
  return rows[0];
}

export async function countProfiles(sql) {
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM profiles`;
  return count;
}

export async function deleteProfile(sql, id) {
  await sql`DELETE FROM profiles WHERE id = ${id}`;
}

// Update any subset of {name, passcodeHash, isPublic} in one statement. Column
// names come from a fixed whitelist (never user input); values are parameterized.
export async function updateProfile(sql, id, fields) {
  const COLUMNS = { name: 'name', passcodeHash: 'passcode_hash', isPublic: 'is_public' };
  const sets = [];
  const vals = [];
  for (const [key, col] of Object.entries(COLUMNS)) {
    if (fields[key] != null) { vals.push(fields[key]); sets.push(`${col} = $${vals.length}`); }
  }
  if (!sets.length) return null;
  vals.push(id);
  const rows = await sql.query(
    `UPDATE profiles SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING id, name, is_public`,
    vals
  );
  return rows[0] || null;
}

// --- Profile sharing (view-only access) -------------------------------------

// Viewers this owner has granted read access to (with pending/accepted status).
export async function listShareViewers(sql, ownerId) {
  return sql`
    SELECT p.id, p.name, p.last_active_at, (s.accepted_at IS NOT NULL) AS accepted
    FROM profile_shares s JOIN profiles p ON p.id = s.viewer_id
    WHERE s.owner_id = ${ownerId}
    ORDER BY p.name ASC
  `;
}

// Owners who have shared their profile with this viewer (with accepted status,
// so the caller can split active shares from pending invites).
export async function listSharedWithViewer(sql, viewerId) {
  return sql`
    SELECT p.id, p.name, p.last_active_at, (s.accepted_at IS NOT NULL) AS accepted
    FROM profile_shares s JOIN profiles p ON p.id = s.owner_id
    WHERE s.viewer_id = ${viewerId}
    ORDER BY p.name ASC
  `;
}

// Create a pending share (accepted_at stays NULL until the viewer accepts).
export async function createShare(sql, ownerId, viewerId) {
  await sql`
    INSERT INTO profile_shares (owner_id, viewer_id)
    VALUES (${ownerId}, ${viewerId})
    ON CONFLICT (owner_id, viewer_id) DO NOTHING
  `;
}

// Viewer accepts a pending invite from ownerId.
export async function acceptShare(sql, ownerId, viewerId) {
  await sql`
    UPDATE profile_shares SET accepted_at = now()
    WHERE owner_id = ${ownerId} AND viewer_id = ${viewerId} AND accepted_at IS NULL
  `;
}

export async function deleteShare(sql, ownerId, viewerId) {
  await sql`DELETE FROM profile_shares WHERE owner_id = ${ownerId} AND viewer_id = ${viewerId}`;
}

// True if viewerId may read ownerId's data: either ownerId is public (anyone,
// including an anonymous caller with viewerId = null) or an *accepted* share
// exists. One round trip covers both — the EXISTS is simply false for a null
// viewer, so anonymous callers can only ever reach public profiles.
export async function canViewProfile(sql, viewerId, ownerId) {
  const rows = await sql`
    SELECT 1 FROM profiles p
    WHERE p.id = ${ownerId}
      AND (p.is_public OR EXISTS (
        SELECT 1 FROM profile_shares s
        WHERE s.owner_id = p.id AND s.viewer_id = ${viewerId} AND s.accepted_at IS NOT NULL
      ))
  `;
  return rows.length > 0;
}

// --- Demo visits ------------------------------------------------------------

export async function recordDemoVisit(sql, visitorId) {
  await sql`INSERT INTO demo_visits (visitor_id) VALUES (${visitorId})`;
}

// Everything the stats page shows, one round trip per query (the page fires them in
// parallel): totals, a per-day breakdown, and per-visitor visit counts.
export async function demoVisitTotals(sql) {
  const rows = await sql`
    SELECT COUNT(*)::int AS visits,
           COUNT(DISTINCT visitor_id)::int AS visitors,
           MIN(created_at) AS first_visit,
           MAX(created_at) AS last_visit
    FROM demo_visits
  `;
  return rows[0];
}

export async function demoVisitsByDay(sql, days = 30) {
  return sql`
    SELECT created_at::date::text AS day,
           COUNT(*)::int AS visits,
           COUNT(DISTINCT visitor_id)::int AS visitors
    FROM demo_visits
    WHERE created_at > now() - ${days} * interval '1 day'
    GROUP BY 1
    ORDER BY 1 DESC
  `;
}

export async function demoVisitors(sql, limit = 50) {
  return sql`
    SELECT visitor_id,
           COUNT(*)::int AS visits,
           MAX(created_at) AS last_seen
    FROM demo_visits
    GROUP BY visitor_id
    ORDER BY MAX(created_at) DESC
    LIMIT ${limit}
  `;
}

// --- Data helpers (all scoped to a profile) ---------------------------------

export async function listHabits(sql, profileId) {
  return sql`
    SELECT h.id, h.name, h.emoji, h.color, h.schedule, h.kind,
           h.start_date::text AS start_date, h.created_at,
           COALESCE(
             (SELECT json_agg(c.day ORDER BY c.day)
              FROM checkins c
              WHERE c.habit_id = h.id),
             '[]'::json
           ) AS days
    FROM habits h
    WHERE h.profile_id = ${profileId}
    ORDER BY h.sort_order ASC, h.created_at ASC
  `;
}

export async function createHabit(sql, profileId, name, emoji, color, schedule, kind = 'normal', startDate = null) {
  const rows = await sql`
    INSERT INTO habits (profile_id, name, emoji, color, schedule, kind, start_date)
    VALUES (${profileId}, ${name}, ${emoji}, ${color}, ${schedule}, ${kind}, ${startDate})
    RETURNING id, name, emoji, color, schedule, kind, start_date::text AS start_date, created_at
  `;
  return rows[0];
}

// Seed check-ins for many days at once (used to backfill an existing streak on a
// normal habit at creation). Idempotent — duplicate (habit, day) rows are ignored.
export async function backfillCheckins(sql, habitId, days) {
  if (!days.length) return;
  await sql`
    INSERT INTO checkins (habit_id, day)
    SELECT ${habitId}, d::date FROM unnest(${days}::text[]) AS d
    ON CONFLICT (habit_id, day) DO NOTHING
  `;
}

export async function deleteHabit(sql, profileId, id) {
  await sql`DELETE FROM habits WHERE id = ${id} AND profile_id = ${profileId}`;
}

// Update any subset of {name, emoji, color, schedule} for one of this profile's
// habits. Column names come from a fixed whitelist (never user input); values
// are parameterized. Returns the updated row, or null if nothing/not found.
export async function updateHabit(sql, profileId, id, fields) {
  const WHITELIST = ['name', 'emoji', 'color', 'schedule'];
  const sets = [];
  const vals = [];
  for (const col of WHITELIST) {
    if (fields[col] != null) { vals.push(fields[col]); sets.push(`${col} = $${vals.length}`); }
  }
  if (!sets.length) return null;
  vals.push(id, profileId);
  const rows = await sql.query(
    `UPDATE habits SET ${sets.join(', ')}
     WHERE id = $${vals.length - 1} AND profile_id = $${vals.length}
     RETURNING id, name, emoji, color, schedule, created_at`,
    vals
  );
  return rows[0] || null;
}

// Set explicit sort_order = position for this profile's habits, in the given id
// order. One atomic statement (a VALUES list joined by id) instead of N UPDATEs —
// no partial reorder on failure, one round-trip. Ids not owned by the profile
// simply don't match. Callers pass already-integer ids (see reorder.js).
export async function reorderHabits(sql, profileId, ids) {
  if (!ids.length) return;
  const tuples = ids.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(', ');
  const vals = [];
  ids.forEach((id, i) => vals.push(id, i));
  vals.push(profileId);
  await sql.query(
    `UPDATE habits AS h SET sort_order = v.pos
     FROM (VALUES ${tuples}) AS v(id, pos)
     WHERE h.id = v.id AND h.profile_id = $${vals.length}`,
    vals
  );
}

// Toggle a check-in, but only if the habit belongs to this profile (guards
// against a token for one profile touching another's data).
// Returns { checked: boolean } or null if the habit isn't in this profile.
export async function toggleCheckin(sql, profileId, habitId, day) {
  const owned = await sql`SELECT 1 FROM habits WHERE id = ${habitId} AND profile_id = ${profileId}`;
  if (!owned.length) return null;
  const existing = await sql`SELECT 1 FROM checkins WHERE habit_id = ${habitId} AND day = ${day}`;
  if (existing.length) {
    await sql`DELETE FROM checkins WHERE habit_id = ${habitId} AND day = ${day}`;
    return { checked: false };
  }
  await sql`
    INSERT INTO checkins (habit_id, day) VALUES (${habitId}, ${day})
    ON CONFLICT (habit_id, day) DO NOTHING
  `;
  return { checked: true };
}
