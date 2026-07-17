import { getSql, getProfile } from '../../lib/db.js';
import { verifyPasscode, signToken } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function POST({ request, locals }) {
  const env = locals.runtime?.env;
  const body = await request.json().catch(() => ({}));
  const profileId = Number(body.profileId);
  const passcode = String(body.passcode || '');
  if (!profileId || !passcode) return json({ error: 'profileId and passcode required' }, 400);

  const profile = await getProfile(getSql(env), profileId);
  if (!profile || !(await verifyPasscode(passcode, profile.passcode_hash))) {
    return json({ error: 'Wrong passcode' }, 401);
  }
  const token = await signToken(profile.id, env);
  return json({ token, id: profile.id, name: profile.name, admin: !!profile.is_admin });
}
