import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/compute.js';
import { TK, PID, CARD, FIELD, PRIMARY, go } from './ui.jsx';

// props: profile = { id, name }
export default function Login({ profile }) {
  const [passcode, setPasscode] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!passcode) return;
    setErr('');
    const { ok, status, data } = await apiFetch('/api/login', { method: 'POST', body: { profileId: profile.id, passcode } });
    if (status === 429) { setErr((data && data.error) || 'Too many attempts. Try again later.'); return; }
    if (status === 401) { setErr('Wrong passcode — try again.'); return; }
    if (!ok) { setErr('Something went wrong — try again.'); return; }
    localStorage.setItem(TK, data.token);
    localStorage.setItem(PID, JSON.stringify({ id: data.id, name: data.name, admin: !!data.admin }));
    go('/');
  }

  return (
    <div class={CARD}>
      <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">Sign in as <span class="font-semibold text-slate-800 dark:text-slate-200">{profile.name}</span></p>
      <form onSubmit={submit}>
        <label class="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Passcode</label>
        <input type="password" autocomplete="current-password" placeholder="Enter passcode" aria-label="Passcode"
          value={passcode} onInput={(e) => setPasscode(e.target.value)} class={FIELD} autoFocus />
        {err && <p class="mt-2 text-xs font-medium text-rose-500">{err}</p>}
        <button type="submit" class={'mt-4 ' + PRIMARY}>Unlock</button>
        <a href="/profile/switch" class="mt-3 block w-full text-center text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">Use a different profile</a>
      </form>
    </div>
  );
}
