import crypto from 'node:crypto';

// Pusher config from the runtime env. Returns null when not configured, so
// realtime degrades gracefully (mutations still work, just no live push).
export function realtimeConfig(env) {
  const appId = env?.PUSHER_APP_ID;
  const key = env?.PUSHER_KEY;
  const secret = env?.PUSHER_SECRET;
  const cluster = env?.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) return null;
  return { appId, key, secret, cluster };
}

// Fire a best-effort Pusher event on the `habitrack` channel. `socketId`, when
// provided, excludes the originating client so it doesn't re-apply its own
// change. Never throws — realtime is non-critical and must not break the write.
export async function broadcast(env, profileId, payload, socketId) {
  const cfg = realtimeConfig(env);
  if (!cfg) return;
  try {
    const bodyObj = { name: 'changed', channel: `habitrack-${profileId}`, data: JSON.stringify(payload) };
    if (socketId) bodyObj.socket_id = socketId;
    const body = JSON.stringify(bodyObj);

    // Pusher REST auth: body_md5 + HMAC-SHA256 over "POST\n<path>\n<sorted params>"
    const bodyMd5 = crypto.createHash('md5').update(body).digest('hex');
    const ts = Math.floor(Date.now() / 1000);
    const params = `auth_key=${cfg.key}&auth_timestamp=${ts}&auth_version=1.0&body_md5=${bodyMd5}`;
    const toSign = `POST\n/apps/${cfg.appId}/events\n${params}`;
    const sig = crypto.createHmac('sha256', cfg.secret).update(toSign).digest('hex');
    const url = `https://api-${cfg.cluster}.pusher.com/apps/${cfg.appId}/events?${params}&auth_signature=${sig}`;

    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  } catch {
    // swallow — best-effort
  }
}
