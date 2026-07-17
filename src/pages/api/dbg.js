// Temporary diagnostic sink: logs whatever the client POSTs so it shows up in
// `wrangler pages deployment tail`. Remove once the Overview bug is pinned.
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  console.log('[DBG]', JSON.stringify(body));
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}
