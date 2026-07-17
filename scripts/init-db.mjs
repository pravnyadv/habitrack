import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

// Load .env (simple parser, no dependency)
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const sql = neon(process.env.NEON_DB);

console.log('Creating schema…');

await sql`
  CREATE TABLE IF NOT EXISTS habits (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT NOT NULL DEFAULT '✅',
    color       TEXT NOT NULL DEFAULT 'emerald',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS checkins (
    id        SERIAL PRIMARY KEY,
    habit_id  INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    day       DATE NOT NULL,
    UNIQUE (habit_id, day)
  )
`;

await sql`CREATE INDEX IF NOT EXISTS idx_checkins_habit_day ON checkins (habit_id, day)`;

// Frequency: CSV of JS weekday numbers (0=Sun … 6=Sat) the habit is scheduled on.
await sql`ALTER TABLE habits ADD COLUMN IF NOT EXISTS schedule TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6'`;

// Seed a few starter habits only if the table is empty.
const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM habits`;
if (count === 0) {
  console.log('Seeding starter habits…');
  const seed = [
    ['Drink water', '💧', 'sky'],
    ['Read 20 min', '📖', 'amber'],
    ['Exercise', '🏃', 'rose'],
    ['Meditate', '🧘', 'violet'],
  ];
  for (const [name, emoji, color] of seed) {
    await sql`INSERT INTO habits (name, emoji, color) VALUES (${name}, ${emoji}, ${color})`;
  }
}

console.log('Done ✅');
