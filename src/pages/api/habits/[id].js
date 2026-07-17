import { getSql, deleteHabit, renameHabit } from '../../../lib/db.js';
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

export async function PATCH({ params, request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) return json({ error: 'Name is required' }, 400);
  const id = Number(params.id);
  const habit = await renameHabit(getSql(env), profileId, id, name);
  await broadcast(env, profileId, { type: 'rename', id, name }, request.headers.get('x-socket-id'));
  return json(habit);
}
