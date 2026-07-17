import { getSql, getVersion, canView } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

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
  const version = await getVersion(sql, scope);
  return json({ version });
}
