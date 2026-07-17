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

// --- Data helpers -----------------------------------------------------------

export async function listHabits(sql) {
  return sql`
    SELECT h.id, h.name, h.emoji, h.color, h.schedule, h.created_at,
           COALESCE(
             (SELECT json_agg(c.day ORDER BY c.day)
              FROM checkins c
              WHERE c.habit_id = h.id),
             '[]'::json
           ) AS days
    FROM habits h
    ORDER BY h.sort_order ASC, h.created_at ASC
  `;
}

export async function createHabit(sql, name, emoji, color, schedule) {
  const rows = await sql`
    INSERT INTO habits (name, emoji, color, schedule)
    VALUES (${name}, ${emoji}, ${color}, ${schedule})
    RETURNING id, name, emoji, color, schedule, created_at
  `;
  return rows[0];
}

export async function deleteHabit(sql, id) {
  await sql`DELETE FROM habits WHERE id = ${id}`;
}

export async function renameHabit(sql, id, name) {
  const rows = await sql`
    UPDATE habits SET name = ${name} WHERE id = ${id}
    RETURNING id, name, emoji, color
  `;
  return rows[0];
}

// Toggle a check-in for a given habit + ISO date (YYYY-MM-DD).
// Returns { checked: boolean }.
export async function toggleCheckin(sql, habitId, day) {
  const existing = await sql`
    SELECT 1 FROM checkins WHERE habit_id = ${habitId} AND day = ${day}
  `;
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
