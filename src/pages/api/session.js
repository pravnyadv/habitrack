import { verifyToken, TOKEN_COOKIE, sessionCookieOpts } from '../../lib/auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Re-issue the httpOnly session cookie from a valid Bearer token. Used when the
// client still has a token in localStorage but the cookie is gone (e.g. an
// installed PWA whose cookie jar was cleared/partitioned) — this restores the
// server session so the middleware gate lets the app through. No DB touch.
export async function POST({ request, locals, cookies }) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const profileId = token ? await verifyToken(token, locals.runtime?.env) : null;
  console.log(`[HAB] /api/session hasBearer=${token ? 'y' : 'n'} valid=${profileId ? 'y' : 'n'}`);
  if (!profileId) return json({ error: 'invalid token' }, 401);
  cookies.set(TOKEN_COOKIE, token, sessionCookieOpts);
  return json({ ok: true });
}
