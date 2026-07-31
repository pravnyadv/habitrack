import { getSql, getProfile, deleteProfile, updateProfile, countProfiles, bumpTokenVersion } from '../../../lib/db.js';
import { authedProfile, unauthorized, verifyPasscode, hashPasscode, signToken, TOKEN_COOKIE, sessionCookieOpts } from '../../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function DELETE({ params, request, locals }) {
  const env = locals.runtime?.env;
  const callerId = await authedProfile(request, env);
  if (!callerId) return unauthorized();
  const sql = getSql(env);
  const target = Number(params.id);

  const caller = await getProfile(sql, callerId);
  const isSelf = callerId === target;
  if (!isSelf && !caller?.is_admin) return json({ error: 'Forbidden' }, 403);

  if ((await countProfiles(sql)) <= 1) return json({ error: 'Cannot delete the last profile' }, 400);

  await deleteProfile(sql, target); // cascades to that profile's habits + checkins
  return json({ ok: true });
}

// Rename (self or admin) and/or change own passcode (self only, requires the
// current passcode). Admin passcode-reset of others is intentionally out of scope.
export async function PATCH({ params, request, locals, cookies }) {
  const env = locals.runtime?.env;
  const callerId = await authedProfile(request, env);
  if (!callerId) return unauthorized();
  const sql = getSql(env);
  const target = Number(params.id);
  const body = await request.json().catch(() => ({}));

  const caller = await getProfile(sql, callerId);
  const isSelf = callerId === target;
  if (!isSelf && !caller?.is_admin) return json({ error: 'Forbidden' }, 403);

  const fields = {};

  if (body.name != null) {
    const name = String(body.name).trim();
    if (!name) return json({ error: 'Name is required' }, 400);
    fields.name = name;
  }

  if (body.newPasscode != null) {
    if (!isSelf) return json({ error: 'Only the profile owner can change its passcode' }, 403);
    const newPasscode = String(body.newPasscode);
    if (newPasscode.length < 6) return json({ error: 'Passcode must be at least 6 characters' }, 400);
    const targetProfile = await getProfile(sql, target);
    if (!(await verifyPasscode(String(body.currentPasscode || ''), targetProfile.passcode_hash))) {
      return json({ error: 'Current passcode is wrong' }, 401);
    }
    fields.passcodeHash = await hashPasscode(newPasscode);
  }

  // Publishing exposes this profile's habits to anyone, so only the owner can
  // flip it. An admin renaming someone doesn't get to publish them.
  if (body.isPublic != null) {
    if (!isSelf) return json({ error: 'Only the profile owner can change visibility' }, 403);
    fields.isPublic = body.isPublic === true;
  }

  if (fields.name == null && fields.passcodeHash == null && fields.isPublic == null) {
    return json({ error: 'Nothing to update' }, 400);
  }

  const updated = await updateProfile(sql, target, fields);

  // Changing the passcode revokes every existing token (bump token_version), then
  // re-issues a fresh one for THIS session so the user isn't logged out here.
  let token;
  if (fields.passcodeHash != null) {
    const tokenVersion = await bumpTokenVersion(sql, target);
    token = await signToken(target, env, { tokenVersion });
    cookies.set(TOKEN_COOKIE, token, sessionCookieOpts);
  }

  return json({ ok: true, id: updated.id, name: updated.name, isPublic: updated.is_public, ...(token ? { token } : {}) });
}
