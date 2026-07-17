import { getSql, reorderHabits } from '../../../lib/db.js';
import { authedProfile, unauthorized } from '../../../lib/auth.js';
import { broadcast } from '../../../lib/realtime.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// POST {ids: [...]} — persist the habit order (sort_order = position). Scoped to
// the caller's own habits; ids from other profiles simply don't match.
export async function POST({ request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : null;
  if (!ids || !ids.length) return json({ error: 'ids array is required' }, 400);
  await reorderHabits(getSql(env), profileId, ids);
  await broadcast(env, profileId, { type: 'reorder', ids }, request.headers.get('x-socket-id'));
  return json({ ok: true });
}
