import { defineMiddleware } from 'astro:middleware';
import { verifyToken, TOKEN_COOKIE } from './lib/auth.js';

// Server-side auth gate: app routes require a valid session cookie, else we
// redirect to /profile *before any HTML is sent* (no client-side flash).
// The /profile/{switch,login,create} pages are public (they ARE the gate);
// API routes self-authenticate.
const GATED = new Set(['/', '/profile/manage']);

export const onRequest = defineMiddleware(async (context, next) => {
  if (GATED.has(context.url.pathname)) {
    const token = context.cookies.get(TOKEN_COOKIE)?.value;
    const profileId = token ? await verifyToken(token, context.locals.runtime?.env) : null;
    if (!profileId) return context.redirect('/profile');
  }
  return next();
});
