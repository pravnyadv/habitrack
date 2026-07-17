import { getSql, listProfiles, createProfile } from '../../lib/db.js';
import { hashPasscode, signToken } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Public: names + ids only, for the gate's profile picker.
export async function GET({ locals }) {
  const profiles = await listProfiles(getSql(locals.runtime?.env));
  return json(profiles);
}

// Open creation (guarded only by the unguessable URL). Creates a profile with a
// hashed passcode and auto-logs-in by returning a token.
export async function POST({ request, locals }) {
  const env = locals.runtime?.env;
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const passcode = String(body.passcode || '');
  if (!name) return json({ error: 'Name is required' }, 400);
  if (passcode.length < 4) return json({ error: 'Passcode must be at least 4 characters' }, 400);

  const profile = await createProfile(getSql(env), name, await hashPasscode(passcode));
  const token = await signToken(profile.id, env);
  return json({ token, id: profile.id, name: profile.name, admin: !!profile.is_admin }, 201);
}
