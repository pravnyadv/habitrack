import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/compute.js';
import { VIEW, SECTION, PERSON, EYE, presence, go } from './ui.jsx';

// Two modes, keyed on `me`:
//   Logged out  → onboarding picker: every profile (tap → sign in) + create one.
//   Logged in   → the "Switch" tab: your current profile, invites to accept, and
//                 profiles shared with you (tap = PREVIEW, read-only, no passcode).
//                 We deliberately do NOT list other profiles here — you can only
//                 open one someone has shared with you, and that never needs a passcode.
// props: profiles=[{id,name}], me={id,name,admin}|null, shares={sharedWithMe,invites}
export default function Switch({ profiles = [], me = null, shares: initialShares = { sharedWithMe: [], invites: [] } }) {
  const [shares, setShares] = useState(initialShares);

  async function refreshShares() {
    const { ok, data } = await apiFetch('/api/shares');
    if (ok) setShares({ sharedWithMe: data.sharedWithMe || [], invites: data.invites || [] });
  }
  function preview(o) { localStorage.setItem(VIEW, JSON.stringify({ id: o.id, name: o.name })); go('/'); }
  async function accept(id) { await apiFetch('/api/shares', { method: 'PATCH', body: { ownerId: id } }); refreshShares(); }
  async function decline(id) { await apiFetch(`/api/shares?owner=${id}`, { method: 'DELETE' }); refreshShares(); }

  // ── Logged-out onboarding picker ──────────────────────────────────────────
  if (!me) {
    return (
      <div class="flex flex-col gap-2">
        <h2 class={SECTION}>Choose a profile</h2>
        {profiles.map((p) => (
          <a key={p.id} href={`/profile/login?id=${p.id}`}
            class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-emerald-400 dark:border-slate-800 dark:bg-slate-900">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{PERSON}</span>
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
          </a>
        ))}
        <a href="/profile/create"
          class="mt-1 flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-400">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New profile
        </a>
      </div>
    );
  }

  // ── Signed-in "Switch" tab ────────────────────────────────────────────────
  return (
    <div class="flex flex-col gap-6">
      <section>
        <h2 class={SECTION}>Signed in as</h2>
        <div class="flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">{PERSON}</span>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold">{me.name}</p>
            <button type="button" onClick={() => { localStorage.removeItem(VIEW); go('/'); }}
              class="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400">Go to your habits →</button>
          </div>
        </div>
      </section>

      {shares.invites.length > 0 && (
        <section>
          <h2 class={SECTION}>Invites</h2>
          <div class="flex flex-col gap-2">
            {shares.invites.map((o) => (
              <div key={o.id} class="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <span class="min-w-0 flex-1 truncate text-sm font-medium">{o.name} <span class="font-normal text-slate-400">wants to share their habits</span></span>
                <button type="button" onClick={() => accept(o.id)} class="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600">Accept</button>
                <button type="button" onClick={() => decline(o.id)} class="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 transition hover:text-rose-500">Decline</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 class={SECTION}>Shared with you</h2>
        {shares.sharedWithMe.length > 0 ? (
          <div class="flex flex-col gap-2">
            {shares.sharedWithMe.map((o) => (
              <button key={o.id} type="button" onClick={() => preview(o)}
                class="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-emerald-400 dark:border-slate-800 dark:bg-slate-900">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">{EYE}</span>
                <span class="min-w-0 flex-1 truncate text-sm font-medium">{o.name}</span>
                {presence(o.last_active_at)}
                <span class="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition group-hover:bg-emerald-500 group-hover:text-white dark:bg-slate-800 dark:text-slate-300">Preview</span>
              </button>
            ))}
          </div>
        ) : (
          <p class="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400 dark:border-slate-800">
            No one has shared their habits with you yet.
          </p>
        )}
      </section>
    </div>
  );
}
