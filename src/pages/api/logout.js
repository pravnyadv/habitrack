import { TOKEN_COOKIE } from '../../lib/auth.js';

// Clear the session cookie. Client also clears its localStorage profile.
export async function POST({ cookies }) {
  cookies.delete(TOKEN_COOKIE, { path: '/' });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
