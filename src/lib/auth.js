// Shared-passcode gate. The expected passcode lives in the runtime env
// (APP_PASSCODE) — a Cloudflare secret in prod, .dev.vars locally — never in
// client code. Clients send it in the `x-passcode` header on every request.
export function expectedPasscode(env) {
  return (
    env?.APP_PASSCODE ||
    (typeof process !== 'undefined' ? process.env?.APP_PASSCODE : undefined) ||
    import.meta.env.APP_PASSCODE
  );
}

export function isAuthed(request, env) {
  const expected = expectedPasscode(env);
  if (!expected) return false; // fail closed if no passcode configured
  const given = request.headers.get('x-passcode');
  return !!given && given === expected;
}

// Must be a fresh Response per call — a Response body can only be consumed once.
export function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
