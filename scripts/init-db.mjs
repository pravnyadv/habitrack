import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

// Same format as src/lib/auth.js (PBKDF2-SHA256, 100k iterations) so a passcode
// hashed here verifies at login on the Workers side.
function hashPasscode(passcode) {
  const iter = 100000;
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(passcode, salt, iter, 32, 'sha256');
  return `pbkdf2$${iter}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

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

// Profiles: each has its own passcode (hashed) and its own habits.
await sql`
  CREATE TABLE IF NOT EXISTS profiles (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    passcode_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

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

// View-only sharing: owner_id grants viewer_id read access to their profile.
await sql`
  CREATE TABLE IF NOT EXISTS profile_shares (
    id         SERIAL PRIMARY KEY,
    owner_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    viewer_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_id, viewer_id)
  )
`;
// A share is pending until the recipient accepts it (accepted_at set). New rows
// are created NULL (pending). No grandfathering — this must stay idempotent, and
// a blanket UPDATE would auto-accept real pending invites on every re-run.
await sql`ALTER TABLE profile_shares ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`;

// Frequency: CSV of JS weekday numbers (0=Sun … 6=Sat) the habit is scheduled on.
await sql`ALTER TABLE habits ADD COLUMN IF NOT EXISTS schedule TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6'`;

// --- Multi-profile migration (backward-compatible) ------------------------
// Ensure a default profile exists (seeded with the current shared passcode) so
// existing habits and the currently-deployed app keep working.
const DEFAULT_NAME = 'Praveen';
const DEFAULT_PASSCODE = process.env.APP_PASSCODE || 'habits2026';
let [defaultProfile] = await sql`SELECT id FROM profiles ORDER BY id ASC LIMIT 1`;
if (!defaultProfile) {
  console.log('Creating default profile…');
  [defaultProfile] = await sql`
    INSERT INTO profiles (name, passcode_hash)
    VALUES (${DEFAULT_NAME}, ${hashPasscode(DEFAULT_PASSCODE)})
    RETURNING id
  `;
}
const defaultId = defaultProfile.id;

// Admin flag: the first/default profile is admin (can delete any profile).
await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`;
await sql`UPDATE profiles SET is_admin = true WHERE id = ${defaultId}`;

// Login throttling: count consecutive failures; lock the profile until a time.
await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0`;
await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`;

// Presence: last time this profile was active in the app (heartbeat). Powers the
// admin "online now" count and the per-profile "last active" shown within shares.
await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ`;

// Token revocation: bumped on passcode change; a token is valid only while its
// embedded version matches. Legacy pre-versioning tokens count as 0.
await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`;

// Add habits.profile_id with the default profile as the column default, so old
// code that inserts without it still lands in the default profile.
await sql`ALTER TABLE habits ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE`;
// DDL can't bind params — defaultId is our own integer, safe to inline.
await sql.query(`ALTER TABLE habits ALTER COLUMN profile_id SET DEFAULT ${defaultId}`);
await sql`UPDATE habits SET profile_id = ${defaultId} WHERE profile_id IS NULL`;
await sql`CREATE INDEX IF NOT EXISTS idx_habits_profile ON habits (profile_id)`;

// Seed starter habits only for a brand-new DB (no habits at all).
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
    await sql`INSERT INTO habits (name, emoji, color, profile_id) VALUES (${name}, ${emoji}, ${color}, ${defaultId})`;
  }
}

console.log('Done ✅');
