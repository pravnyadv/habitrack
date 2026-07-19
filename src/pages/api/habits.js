import { getSql, listHabits, createHabit, canView, backfillCheckins } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';
import { broadcast } from '../../lib/realtime.js';
import { iso, addDays, dow } from '../../lib/compute.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// GET own habits, or another profile's when ?profile=<id> is set and that
// profile has shared view access with the caller. Read-only either way (this
// endpoint never writes); mutations only ever use the caller's own id.
export async function GET({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  if (!me) return unauthorized();
  const sql = getSql(env);
  const raw = new URL(request.url).searchParams.get('profile');
  const target = raw != null ? Number(raw) : null;
  let scope = me;
  if (target != null && Number.isInteger(target) && target !== me) {
    if (!(await canView(sql, me, target))) return json({ error: 'Forbidden' }, 403);
    scope = target;
  }
  const habits = await listHabits(sql, scope);
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

  // Cap length — an emoji (incl. ZWJ sequences) never needs many chars; this
  // stops junk/markup being stored. Output is HTML-escaped at render too.
  const emoji = ((body.emoji || '✅').trim() || '✅').slice(0, 16);
  const color = (body.color || 'emerald').trim() || 'emerald';

  // kind: 'streak' (quit/abstain) or 'normal' (build). Streak habits have no rest
  // days — abstinence is every day — so their schedule is forced to daily.
  const kind = body.kind === 'streak' ? 'streak' : 'normal';

  // schedule: array of weekday numbers (0=Sun … 6=Sat); default every day
  let sched = Array.isArray(body.schedule)
    ? [...new Set(body.schedule.map(Number).filter((n) => n >= 0 && n <= 6))].sort()
    : [0, 1, 2, 3, 4, 5, 6];
  if (sched.length === 0 || kind === 'streak') sched = [0, 1, 2, 3, 4, 5, 6];

  // Backdated start (existing streak). Accept a valid past date, capped ~3y back.
  const today = iso(new Date());
  const rawStart = String(body.startDate || '').trim();
  let startDate = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawStart) && rawStart <= today && rawStart >= addDays(today, -366 * 3)) {
    startDate = rawStart;
  }

  const habit = await createHabit(sql, profileId, name, emoji, color, sched.join(','), kind, startDate);

  // Normal habit + backdated start → seed the existing streak by marking every
  // scheduled day from startDate..today as done. Streak habits store only slips,
  // so they start empty (clean is the computed default).
  let days = [];
  if (kind === 'normal' && startDate) {
    const schedSet = new Set(sched);
    for (let d = startDate; d <= today; d = addDays(d, 1)) if (schedSet.has(dow(d))) days.push(d);
    await backfillCheckins(sql, habit.id, days);
  }

  const full = { ...habit, days };
  await broadcast(env, profileId, { type: 'add', habit: full }, request.headers.get('x-socket-id'));
  return json(full, 201);
}
