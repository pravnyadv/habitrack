// Profile auth: passcodes are hashed (PBKDF2-SHA256) and stored in the DB, never
// in env. Login verifies the hash once and returns a signed token (HMAC over an
// AUTH_SECRET). The token carries a token_version; verifyToken checks it against
// the profile's current version (one cheap indexed read) so a passcode change or
// profile deletion revokes every previously-issued token.
import { getSql, getTokenVersion } from './db.js';

const PBKDF2_ITER = 100000;
const enc = (s) => new TextEncoder().encode(s);
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function pbkdf2(passcode, salt, iterations) {
  const km = await crypto.subtle.importKey('raw', enc(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, 256);
  return new Uint8Array(bits);
}

// Format: pbkdf2$<iter>$<saltHex>$<hashHex> — same format the migration produces.
export async function hashPasscode(passcode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(passcode, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPasscode(passcode, stored) {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  const hash = await pbkdf2(passcode, fromHex(parts[2]), iter);
  return timingSafeEqual(toHex(hash), parts[3]);
}

// ---- signed session tokens ------------------------------------------------
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc(msg)));
}

// Token format: <profileId>.<exp>.<tokenVersion>.<hmac>. The version is folded
// into the signed payload so it can't be tampered with.
export async function signToken(profileId, env, { tokenVersion = 0, ttlDays = 365 } = {}) {
  const secret = env?.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET not set');
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const payload = `${profileId}.${exp}.${tokenVersion}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export const TOKEN_COOKIE = 'habitrack_token';

// Verify a raw token string → profileId (number) or null. Checks HMAC + expiry,
// then confirms the token_version still matches the profile (revocation check —
// one cheap indexed read). Used by both authedProfile (endpoints) and the
// middleware auth gate. Legacy 3-part tokens (pre-versioning) are treated as
// version 0, so they stay valid until the next passcode change.
export async function verifyToken(token, env) {
  const secret = env?.AUTH_SECRET;
  if (!secret || !token) return null;
  const parts = token.split('.');
  let pid, exp, ver, sig, payload;
  if (parts.length === 4) { [pid, exp, ver, sig] = parts; payload = `${pid}.${exp}.${ver}`; }
  else if (parts.length === 3) { [pid, exp, sig] = parts; ver = '0'; payload = `${pid}.${exp}`; }
  else return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  const id = Number(pid);
  if (!Number.isInteger(id)) return null;
  // Revocation: the profile's current token_version must match the token's. Keep
  // the no-throw contract callers rely on — a DB error fails closed (the app is
  // unusable without the DB anyway), never a 500 out of the auth gate.
  let current;
  try { current = await getTokenVersion(getSql(env), id); }
  catch { return null; }
  if (current == null || current !== Number(ver)) return null;
  return id;
}

// Returns the profileId if the request carries a valid token, else null. Looks
// in the Authorization header first, then the session cookie.
export async function authedProfile(request, env) {
  const header = request.headers.get('authorization') || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : request.headers.get('x-token');
  if (!token) {
    const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`));
    if (m) token = decodeURIComponent(m[1]);
  }
  return verifyToken(token, env);
}

// Cookie options for the session token (httpOnly so JS can't read it).
export const sessionCookieOpts = {
  path: '/', httpOnly: true, secure: import.meta.env.PROD, sameSite: 'lax', maxAge: 365 * 86400,
};

export const unauthorized = () =>
  new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
