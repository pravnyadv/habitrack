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

// Public list (no hashes) for the gate's profile picker.
export async function listProfiles(sql) {
  return sql`SELECT id, name FROM profiles ORDER BY id ASC`;
}

export async function getProfile(sql, id) {
  const rows = await sql`SELECT id, name, passcode_hash, is_admin FROM profiles WHERE id = ${id}`;
  return rows[0] || null;
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

// Update name and/or passcode_hash (only the fields provided).
export async function updateProfile(sql, id, { name, passcodeHash }) {
  if (name != null && passcodeHash != null) {
    await sql`UPDATE profiles SET name = ${name}, passcode_hash = ${passcodeHash} WHERE id = ${id}`;
  } else if (name != null) {
    await sql`UPDATE profiles SET name = ${name} WHERE id = ${id}`;
  } else if (passcodeHash != null) {
    await sql`UPDATE profiles SET passcode_hash = ${passcodeHash} WHERE id = ${id}`;
  }
  const rows = await sql`SELECT id, name FROM profiles WHERE id = ${id}`;
  return rows[0] || null;
}

// --- Data helpers (all scoped to a profile) ---------------------------------

// Cheap per-profile "revision" signal for cross-device sync.
export async function getVersion(sql, profileId) {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*) FROM habits WHERE profile_id = ${profileId})                        AS hc,
      (SELECT COALESCE(MAX(id), 0) FROM habits WHERE profile_id = ${profileId})            AS hm,
      (SELECT COALESCE(SUM(char_length(name)), 0) FROM habits WHERE profile_id = ${profileId}) AS hn,
      (SELECT COUNT(*) FROM checkins c JOIN habits h ON h.id = c.habit_id WHERE h.profile_id = ${profileId})        AS cc,
      (SELECT COALESCE(MAX(c.id), 0) FROM checkins c JOIN habits h ON h.id = c.habit_id WHERE h.profile_id = ${profileId}) AS cm
  `;
  const r = rows[0];
  return `${r.hc}.${r.hm}.${r.hn}.${r.cc}.${r.cm}`;
}

export async function listHabits(sql, profileId) {
  return sql`
    SELECT h.id, h.name, h.emoji, h.color, h.schedule, h.created_at,
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

export async function createHabit(sql, profileId, name, emoji, color, schedule) {
  const rows = await sql`
    INSERT INTO habits (profile_id, name, emoji, color, schedule)
    VALUES (${profileId}, ${name}, ${emoji}, ${color}, ${schedule})
    RETURNING id, name, emoji, color, schedule, created_at
  `;
  return rows[0];
}

export async function deleteHabit(sql, profileId, id) {
  await sql`DELETE FROM habits WHERE id = ${id} AND profile_id = ${profileId}`;
}

export async function renameHabit(sql, profileId, id, name) {
  const rows = await sql`
    UPDATE habits SET name = ${name} WHERE id = ${id} AND profile_id = ${profileId}
    RETURNING id, name, emoji, color
  `;
  return rows[0];
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
