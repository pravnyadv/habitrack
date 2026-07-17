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
  const viewer = Number(params.get('viewer'));
  const owner = Number(params.get('owner'));
  if (Number.isInteger(viewer)) await deleteShare(sql, me, viewer);
  else if (Number.isInteger(owner)) await deleteShare(sql, owner, me);
  else return json({ error: 'viewer or owner is required' }, 400);
  return json({ ok: true });
}
