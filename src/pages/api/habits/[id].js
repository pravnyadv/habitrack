import { getSql, deleteHabit, updateHabit } from '../../../lib/db.js';
import { authedProfile, unauthorized } from '../../../lib/auth.js';
import { broadcast } from '../../../lib/realtime.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function DELETE({ params, request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const id = Number(params.id);
  await deleteHabit(getSql(env), profileId, id);
  await broadcast(env, profileId, { type: 'delete', id }, request.headers.get('x-socket-id'));
  return json({ ok: true });
}

// Edit any subset of name / emoji / color / schedule.
export async function PATCH({ params, request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const body = await request.json().catch(() => ({}));

  const fields = {};
  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) return json({ error: 'Name is required' }, 400);
    fields.name = name;
  }
  if (body.emoji != null) fields.emoji = String(body.emoji).trim() || '✅';
  if (body.color != null) fields.color = String(body.color).trim() || 'emerald';
  if (body.schedule != null) {
    let sched = Array.isArray(body.schedule)
      ? [...new Set(body.schedule.map(Number).filter((n) => n >= 0 && n <= 6))].sort()
      : [];
    if (sched.length === 0) sched = [0, 1, 2, 3, 4, 5, 6];
    fields.schedule = sched.join(',');
  }
  if (!Object.keys(fields).length) return json({ error: 'Nothing to update' }, 400);

  const id = Number(params.id);
  const habit = await updateHabit(getSql(env), profileId, id, fields);
  if (!habit) return json({ error: 'Not found' }, 404);
  await broadcast(env, profileId, { type: 'update', habit }, request.headers.get('x-socket-id'));
  return json(habit);
}
