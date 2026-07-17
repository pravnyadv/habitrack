import { getSql, listHabits, createHabit } from '../../lib/db.js';
import { isAuthed, unauthorized } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function GET({ request, locals }) {
  if (!isAuthed(request, locals.runtime?.env)) return unauthorized();
  const sql = getSql(locals.runtime?.env);
  const habits = await listHabits(sql);
  return json(habits);
}

export async function POST({ request, locals }) {
  if (!isAuthed(request, locals.runtime?.env)) return unauthorized();
  const sql = getSql(locals.runtime?.env);
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

  const habit = await createHabit(sql, name, emoji, color, sched.join(','));
  return json({ ...habit, days: [] }, 201);
}
