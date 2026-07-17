// Profile auth: passcodes are hashed (PBKDF2-SHA256) and stored in the DB, never
// in env. Login verifies the hash once and returns a signed token (HMAC over an
// AUTH_SECRET); every later request just verifies the cheap token — no DB hit.

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

export async function signToken(profileId, env, ttlDays = 365) {
  const secret = env?.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET not set');
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const payload = `${profileId}.${exp}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

// Returns the profileId (number) if the request carries a valid token, else null.
export async function authedProfile(request, env) {
  const secret = env?.AUTH_SECRET;
  if (!secret) return null;
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : request.headers.get('x-token');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [pid, exp, sig] = parts;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmac(secret, `${pid}.${exp}`);
  if (!timingSafeEqual(sig, expected)) return null;
  const id = Number(pid);
  return Number.isInteger(id) ? id : null;
}

export const unauthorized = () =>
  new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
