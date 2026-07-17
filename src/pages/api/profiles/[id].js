import { getSql, getProfile, deleteProfile, updateProfile, countProfiles } from '../../../lib/db.js';
import { authedProfile, unauthorized, verifyPasscode, hashPasscode } from '../../../lib/auth.js';

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
export async function PATCH({ params, request, locals }) {
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

  if (fields.name == null && fields.passcodeHash == null) {
    return json({ error: 'Nothing to update' }, 400);
  }

  const updated = await updateProfile(sql, target, fields);
  return json({ ok: true, id: updated.id, name: updated.name });
}
