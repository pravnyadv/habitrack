import { getSql, touchProfile } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';

// POST: mark the authed profile active now. Called on app load and periodically
// while the tab is visible. Cheap single UPDATE; presence is derived from it.
export async function POST({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  if (!me) return unauthorized();
  await touchProfile(getSql(env), me);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
