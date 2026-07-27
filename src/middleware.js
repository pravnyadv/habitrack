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
    // Hand the verified id to the page so it doesn't re-run verifyToken on a
    // request we already authenticated — that check costs a Neon round trip.
    context.locals.profileId = profileId;
  }
  return next();
});
