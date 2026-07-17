import { getSql, toggleCheckin } from '../../lib/db.js';
import { isAuthed, unauthorized } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function POST({ request, locals }) {
  if (!isAuthed(request, locals.runtime?.env)) return unauthorized();
  const sql = getSql(locals.runtime?.env);
  const body = await request.json().catch(() => ({}));
  const habitId = Number(body.habitId);
  const day = String(body.day || '');
  if (!habitId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return json({ error: 'habitId and day (YYYY-MM-DD) are required' }, 400);
  }
  const result = await toggleCheckin(sql, habitId, day);
  return json(result);
}
