import { getSql, getProfile, listPresence } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// A profile counts as online if it was active within this window. Should be
// comfortably larger than the client heartbeat interval (~45s).
const ONLINE_WINDOW_SECONDS = 120;

// GET (admin only): { online: <count>, profiles: [{id,name,last_active_at,online}] }.
// online counts distinct profiles, so the same profile on several devices is one.
export async function GET({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  if (!me) return unauthorized();
  const sql = getSql(env);
  const caller = await getProfile(sql, me);
  if (!caller?.is_admin) return json({ error: 'Forbidden' }, 403);

  const profiles = await listPresence(sql, ONLINE_WINDOW_SECONDS);
  const online = profiles.filter((p) => p.online).length;
  return json({ online, profiles });
}
