import { getSql, listHabits, createHabit, canViewProfile, backfillCheckins } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';
import { broadcast } from '../../lib/realtime.js';
import { iso, normalizeSchedule, resolveStartDate, scheduledDays } from '../../lib/compute.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// GET own habits, or another profile's when ?profile=<id> is set and that profile
// is either public or has shared view access with the caller. Read-only either way
// (this endpoint never writes); mutations only ever use the caller's own id.
//
// A ?profile= request needs no session at all. That's what makes a public profile
// readable by an anonymous visitor at /p/<id>. `canViewProfile` still gates it, and
// with no caller only a public target passes. Without ?profile= a session is
// required, since "own habits" is meaningless otherwise.
export async function GET({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  const sql = getSql(env);
  const raw = new URL(request.url).searchParams.get('profile');
  const target = raw != null ? Number(raw) : null;
  const hasTarget = Number.isInteger(target);
  if (!me && !hasTarget) return unauthorized();
  let scope = me;
  if (hasTarget && target !== me) {
    if (!(await canViewProfile(sql, me, target))) return json({ error: 'Forbidden' }, 403);
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

  // Cap length. An emoji (incl. ZWJ sequences) never needs many chars; this
  // stops junk/markup being stored. Output is HTML-escaped at render too.
  const emoji = ((body.emoji || '✅').trim() || '✅').slice(0, 16);
  const color = (body.color || 'emerald').trim() || 'emerald';

  // kind: 'streak' (quit/abstain) or 'normal' (build). The schedule/start/backfill
  // rules live in compute.js so the demo sandbox derives habits identically.
  const kind = body.kind === 'streak' ? 'streak' : 'normal';
  const today = iso(new Date());
  const sched = normalizeSchedule(body.schedule, kind);
  const startDate = resolveStartDate(body.startDate, today);

  const habit = await createHabit(sql, profileId, name, emoji, color, sched.join(','), kind, startDate);

  // Normal habit + backdated start → seed the existing streak by marking every
  // scheduled day from startDate..today as done. Streak habits store only slips,
  // so they start empty (clean is the computed default).
  let days = [];
  if (kind === 'normal' && startDate) {
    days = scheduledDays(startDate, today, sched);
    await backfillCheckins(sql, habit.id, days);
  }

  const full = { ...habit, days };
  await broadcast(env, profileId, { type: 'add', habit: full }, request.headers.get('x-socket-id'));
  return json(full, 201);
}
