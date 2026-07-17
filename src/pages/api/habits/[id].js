import { getSql, deleteHabit, renameHabit } from '../../../lib/db.js';
import { isAuthed, unauthorized } from '../../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function DELETE({ params, request, locals }) {
  if (!isAuthed(request, locals.runtime?.env)) return unauthorized();
  const sql = getSql(locals.runtime?.env);
  await deleteHabit(sql, Number(params.id));
  return json({ ok: true });
}

export async function PATCH({ params, request, locals }) {
  if (!isAuthed(request, locals.runtime?.env)) return unauthorized();
  const sql = getSql(locals.runtime?.env);
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) return json({ error: 'Name is required' }, 400);
  const habit = await renameHabit(sql, Number(params.id), name);
  return json(habit);
}
