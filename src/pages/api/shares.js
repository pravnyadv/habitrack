import { getSql, listShareViewers, listSharedWithViewer, createShare, acceptShare, deleteShare, getProfile } from '../../lib/db.js';
import { authedProfile, unauthorized } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// GET:
//   shared        — viewers I let see my profile (each { id, name, accepted })
//   sharedWithMe  — owners whose invite I've accepted (active, view-only)
//   invites       — owners who invited me but I haven't accepted yet (pending)
export async function GET({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  if (!me) return unauthorized();
  const sql = getSql(env);
  const [shared, incoming] = await Promise.all([
    listShareViewers(sql, me),
    listSharedWithViewer(sql, me),
  ]);
  const strip = ({ id, name, last_active_at }) => ({ id, name, last_active_at });
  return json({
    shared,
    sharedWithMe: incoming.filter((o) => o.accepted).map(strip),
    invites: incoming.filter((o) => !o.accepted).map(strip),
  });
}

// POST {viewerId}: invite another profile to view mine (starts pending).
export async function POST({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  if (!me) return unauthorized();
  const sql = getSql(env);
  const body = await request.json().catch(() => ({}));
  const viewerId = Number(body.viewerId);
  if (!Number.isInteger(viewerId)) return json({ error: 'viewerId is required' }, 400);
  if (viewerId === me) return json({ error: "You can't share with yourself" }, 400);
  if (!(await getProfile(sql, viewerId))) return json({ error: 'No such profile' }, 404);
  await createShare(sql, me, viewerId);
  return json({ ok: true });
}

// PATCH {ownerId}: accept an invite from ownerId (caller is the viewer).
export async function PATCH({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  if (!me) return unauthorized();
  const sql = getSql(env);
  const body = await request.json().catch(() => ({}));
  const ownerId = Number(body.ownerId);
  if (!Number.isInteger(ownerId)) return json({ error: 'ownerId is required' }, 400);
  await acceptShare(sql, ownerId, me);
  return json({ ok: true });
}

// DELETE a share from either side:
//   ?viewer=<id> — I (owner) revoke that viewer
//   ?owner=<id>  — I (viewer) decline/remove that owner's share
export async function DELETE({ request, locals }) {
  const env = locals.runtime?.env;
  const me = await authedProfile(request, env);
  if (!me) return unauthorized();
  const sql = getSql(env);
  const params = new URL(request.url).searchParams;
  // Parse presence explicitly: Number(null) === 0 passes Number.isInteger, so a
  // naive Number(params.get(...)) would make an absent param look like id 0 and
  // swallow the other branch (this is how ?owner= decline used to silently no-op).
  const viewerRaw = params.get('viewer');
  const ownerRaw = params.get('owner');
  if (viewerRaw != null) {
    const viewer = Number(viewerRaw);
    if (!Number.isInteger(viewer)) return json({ error: 'viewer must be an integer' }, 400);
    await deleteShare(sql, me, viewer); // I (owner) revoke that viewer
  } else if (ownerRaw != null) {
    const owner = Number(ownerRaw);
    if (!Number.isInteger(owner)) return json({ error: 'owner must be an integer' }, 400);
    await deleteShare(sql, owner, me); // I (viewer) decline/remove that owner's share
  } else {
    return json({ error: 'viewer or owner is required' }, 400);
  }
  return json({ ok: true });
}
