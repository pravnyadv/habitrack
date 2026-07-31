import { realtimeConfig } from '../../lib/realtime.js';

// Public realtime config for the browser: only the Pusher key + cluster (both
// safe to expose). No passcode required: it carries no data, just how to connect.
export async function GET({ locals }) {
  const cfg = realtimeConfig(locals.runtime?.env);
  const body = cfg
    ? { enabled: true, key: cfg.key, cluster: cfg.cluster }
    : { enabled: false };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
