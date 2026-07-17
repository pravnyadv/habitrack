import { getSql, getVersion } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function GET({ request, locals }) {
  const env = locals.runtime?.env;
  const profileId = await authedProfile(request, env);
  if (!profileId) return unauthorized();
  const version = await getVersion(getSql(env), profileId);
  return json({ version });
}
