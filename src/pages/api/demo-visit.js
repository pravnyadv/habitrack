import { getSql, recordDemoVisit } from '../../lib/db.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Public by necessity: the demo has no session, so counting its visits can't be
// authenticated. The only thing stored is the browser-generated id + a timestamp.
// Ids are length-capped and charset-checked so the column can't be used as a
// dumping ground, and a failed insert is swallowed — analytics must never break
// the demo for the visitor.
export async function POST({ request, locals }) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.visitorId || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return json({ error: 'Bad visitor id' }, 400);
  try {
    await recordDemoVisit(getSql(locals.runtime?.env), id);
  } catch { /* ignore */ }
  return json({ ok: true }, 201);
}
