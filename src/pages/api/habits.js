import { getSql, listHabits, createHabit } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';
import { broadcast } from '../../lib/realtime.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function GET({ request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const habits = await listHabits(getSql(env), profileId);
  return json(habits);
}

export async function POST({ request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const sql = getSql(env);
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) return json({ error: 'Name is required' }, 400);

  const emoji = (body.emoji || '✅').trim() || '✅';
  const color = (body.color || 'emerald').trim() || 'emerald';

  // schedule: array of weekday numbers (0=Sun … 6=Sat); default every day
  let sched = Array.isArray(body.schedule)
    ? [...new Set(body.schedule.map(Number).filter((n) => n >= 0 && n <= 6))].sort()
    : [0, 1, 2, 3, 4, 5, 6];
  if (sched.length === 0) sched = [0, 1, 2, 3, 4, 5, 6];

  const habit = await createHabit(sql, profileId, name, emoji, color, sched.join(','));
  const full = { ...habit, days: [] };
  await broadcast(env, profileId, { type: 'add', habit: full }, request.headers.get('x-socket-id'));
  return json(full, 201);
}
