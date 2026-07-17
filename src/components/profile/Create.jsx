import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/compute.js';
import { TK, PID, CARD, FIELD, PRIMARY, go } from './ui.jsx';

// props: profiles = [{id,name}] (for the duplicate-name soft warning)
export default function Create({ profiles = [] }) {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [dupOk, setDupOk] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const n = name.trim();
    setErr('');
    if (!n) { setErr('Name is required.'); return; }
    if (pass.length < 6) { setErr('Passcode must be at least 6 characters.'); return; }
    // Names aren't unique (ids are), but a duplicate is confusing — soft-warn once.
    if (!dupOk && profiles.some((p) => p.name.trim().toLowerCase() === n.toLowerCase())) {
      setErr(`“${n}” is already taken — tap Create again to use it anyway.`);
      setDupOk(true);
      return;
    }
    const { ok, data } = await apiFetch('/api/profiles', { method: 'POST', body: { name: n, passcode: pass } });
    if (!ok) { setErr((data && data.error) || 'Could not create profile.'); return; }
    localStorage.setItem(TK, data.token);
    localStorage.setItem(PID, JSON.stringify({ id: data.id, name: data.name, admin: !!data.admin }));
    go('/');
  }

  return (
    <div class={CARD}>
      <p class="mb-4 text-sm text-slate-500 dark:text-slate-400">Create a new profile</p>
      <form onSubmit={submit}>
        <label class="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Profile name</label>
        <input placeholder="e.g. Alex" autocomplete="off" aria-label="Profile name" value={name} onInput={(e) => setName(e.target.value)} class={FIELD} autoFocus />
        <label class="mb-1.5 mt-4 block text-xs font-medium text-slate-500 dark:text-slate-400">Passcode</label>
        <input type="password" autocomplete="new-password" placeholder="At least 6 characters" aria-label="Passcode" value={pass} onInput={(e) => setPass(e.target.value)} class={FIELD} />
        {err && <p class="mt-2 text-xs font-medium text-rose-500">{err}</p>}
        <button type="submit" class={'mt-5 ' + PRIMARY}>Create &amp; enter</button>
        {profiles.length > 0 && <a href="/profile/switch" class="mt-3 block w-full text-center text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">Back</a>}
      </form>
    </div>
  );
}
