import { getSql, toggleCheckin } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';
import { broadcast } from '../../lib/realtime.js';
import { BACKFILL_DAYS } from '../../lib/compute.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function POST({ request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const habitId = Number(body.habitId);
  const day = String(body.day || '');
  if (!habitId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return json({ error: 'habitId and day (YYYY-MM-DD) are required' }, 400);
  }
  // Backfill window (coarse UTC guard; the UI enforces the exact local window).
  // ±1 day of slack absorbs the client/server timezone gap near midnight.
  const todayUTC = new Date(); todayUTC.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.round((todayUTC - new Date(day + 'T00:00:00Z')) / 86400000);
  if (diffDays < -1 || diffDays > BACKFILL_DAYS) {
    return json({ error: `You can only mark the last ${BACKFILL_DAYS} days.` }, 403);
  }
  const result = await toggleCheckin(getSql(env), profileId, habitId, day);
  if (!result) return json({ error: 'Not found' }, 404);
  await broadcast(env, profileId, { type: 'checkin', habitId, day, checked: result.checked }, request.headers.get('x-socket-id'));
  return json(result);
}
