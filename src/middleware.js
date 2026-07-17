import { defineMiddleware } from 'astro:middleware';
import { verifyToken, TOKEN_COOKIE } from './lib/auth.js';

// Server-side auth gate: app routes require a valid session cookie, else we
// redirect to /profile *before any HTML is sent* (no client-side flash).
const GATED = new Set(['/', '/profile/manage']);
// Paths we log while diagnosing the PWA "Back → /profile" bounce.
const WATCH = new Set(['/', '/profile', '/profile/manage', '/profile/switch']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (WATCH.has(pathname)) {
    const raw = context.request.headers.get('cookie') || '';
    const token = context.cookies.get(TOKEN_COOKIE)?.value;
    const valid = token ? await verifyToken(token, context.locals.runtime?.env) : null;
    console.log(
      `[HAB] ${pathname} cookieLen=${raw.length} hasToken=${token ? 'y' : 'n'} valid=${valid ? 'y' : 'n'}` +
      ` mode=${context.request.headers.get('sec-fetch-mode') || '-'} dest=${context.request.headers.get('sec-fetch-dest') || '-'}` +
      ` ua="${(context.request.headers.get('user-agent') || '').slice(0, 60)}"`,
    );
    if (GATED.has(pathname) && !valid) return context.redirect('/profile');
  }
  return next();
});
