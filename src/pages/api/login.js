import { getSql, getProfile, recordFailedLogin, resetFailedLogin } from '../../lib/db.js';
import { verifyPasscode, signToken, TOKEN_COOKIE, sessionCookieOpts } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Brute-force throttle: this many consecutive wrong passcodes locks the profile
// for LOCK_SECONDS. A correct passcode clears the counter.
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 15 * 60;

export async function POST({ request, locals, cookies }) {
  const env = locals.runtime?.env;
  const sql = getSql(env);
  const body = await request.json().catch(() => ({}));
  const profileId = Number(body.profileId);
  const passcode = String(body.passcode || '');
  if (!profileId || !passcode) return json({ error: 'profileId and passcode required' }, 400);

  const profile = await getProfile(sql, profileId);
  // Uniform 401 whether the profile exists or not (don't leak which ids are real).
  if (!profile) return json({ error: 'Wrong passcode' }, 401);

  if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
    return json({ error: 'Too many attempts. Try again later.', lockedUntil: profile.locked_until }, 429);
  }

  if (!(await verifyPasscode(passcode, profile.passcode_hash))) {
    const lockedUntil = await recordFailedLogin(sql, profile.id, MAX_ATTEMPTS, LOCK_SECONDS);
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      return json({ error: 'Too many attempts. Try again later.', lockedUntil }, 429);
    }
    return json({ error: 'Wrong passcode' }, 401);
  }

  await resetFailedLogin(sql, profile.id);
  const token = await signToken(profile.id, env, { tokenVersion: profile.token_version });
  cookies.set(TOKEN_COOKIE, token, sessionCookieOpts);
  return json({ token, id: profile.id, name: profile.name, admin: !!profile.is_admin });
}
