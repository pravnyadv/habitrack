import { useState } from 'preact/hooks';
import { apiFetch } from '../../lib/compute.js';
import { TK, PID, VIEW, CARD, FIELD, SECONDARY, presence, Msg, Confirm, go } from './ui.jsx';

// props: me={id,name,admin,isPublic}, origin (for the public link), profiles=[{id,name}],
//        shares={shared:[]}, presence=null|{online,profiles}
export default function Manage({ me, origin = '', profiles = [], shares: initialShares = { shared: [] }, presence: presenceData = null }) {
  const [shared, setShared] = useState(initialShares.shared || []);
  const [rename, setRename] = useState(me?.name || '');
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [nameMsg, setNameMsg] = useState(null);
  const [passMsg, setPassMsg] = useState(null);
  const [shareSel, setShareSel] = useState('');
  const [shareMsg, setShareMsg] = useState(null);
  const [isPublic, setIsPublic] = useState(!!me?.isPublic);
  const [pubMsg, setPubMsg] = useState(null);
  const [confirm, setConfirm] = useState(null);

  // `origin` is passed in from the SSR page, so the link renders identically on the
  // server and after hydration (no effect, no second render, no blank first paint).
  const publicUrl = `${origin}/p/${me.id}`;

  const sharedIds = new Set(shared.map((v) => v.id));
  const options = profiles.filter((p) => p.id !== me.id && !sharedIds.has(p.id));

  async function refreshShared() {
    const { ok, data } = await apiFetch('/api/shares');
    if (ok) setShared(data.shared || []);
  }
  async function saveRename() {
    const name = rename.trim();
    if (!name) return;
    const { ok, data } = await apiFetch('/api/profiles/' + me.id, { method: 'PATCH', body: { name } });
    if (!ok) { setNameMsg({ text: (data && data.error) || 'Rename failed.', ok: false }); return; }
    localStorage.setItem(PID, JSON.stringify({ ...me, name }));
    setNameMsg({ text: 'Name updated.', ok: true });
  }
  async function savePasscode() {
    if (newPass.length < 6) { setPassMsg({ text: 'New passcode must be at least 6 characters.', ok: false }); return; }
    const { ok, data } = await apiFetch('/api/profiles/' + me.id, { method: 'PATCH', body: { currentPasscode: curPass, newPasscode: newPass } });
    if (!ok) { setPassMsg({ text: (data && data.error) || 'Could not change passcode.', ok: false }); return; }
    // Changing the passcode revokes old tokens; the server hands back a fresh one
    // for this session, so keep the localStorage copy in sync to stay signed in.
    if (data && data.token) localStorage.setItem(TK, data.token);
    setCurPass(''); setNewPass(''); setPassMsg({ text: 'Passcode changed.', ok: true });
  }
  async function setPublic(next) {
    const { ok, data } = await apiFetch('/api/profiles/' + me.id, { method: 'PATCH', body: { isPublic: next } });
    if (!ok) { setPubMsg({ text: (data && data.error) || 'Could not change visibility.', ok: false }); return; }
    setIsPublic(next);
    setPubMsg({ text: next ? 'Profile is public.' : 'Profile is private again.', ok: true });
  }
  // Visibility is a privacy change in both directions, so every flip is confirmed
  // before anything is sent.
  function togglePublic() {
    const next = !isPublic;
    setConfirm({
      text: next
        ? 'Make this profile public? Anyone can open it from the profile picker and read your habits and check-ins. No one can edit anything, and you can switch back any time.'
        : 'Make this profile private again? Its public link stops working and it goes back to showing as Private in the profile picker.',
      okLabel: next ? 'Make public' : 'Make private',
      danger: false,
      onYes: () => setPublic(next),
    });
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setPubMsg({ text: 'Link copied.', ok: true });
    } catch { setPubMsg({ text: publicUrl, ok: true }); }
  }
  async function addShare() {
    const viewerId = Number(shareSel);
    if (!viewerId) return;
    const { ok, data } = await apiFetch('/api/shares', { method: 'POST', body: { viewerId } });
    if (!ok) { setShareMsg({ text: (data && data.error) || 'Could not share.', ok: false }); return; }
    setShareMsg({ text: 'Invite sent.', ok: true }); setShareSel(''); refreshShared();
  }
  async function revoke(viewerId) {
    const { ok } = await apiFetch(`/api/shares?viewer=${viewerId}`, { method: 'DELETE' });
    if (!ok) { setShareMsg({ text: 'Could not revoke.', ok: false }); return; }
    refreshShared();
  }
  async function del() {
    const { ok, data } = await apiFetch('/api/profiles/' + me.id, { method: 'DELETE' });
    if (!ok) { alert((data && data.error) || 'Could not delete profile.'); return; }
    localStorage.removeItem(TK); localStorage.removeItem(PID); localStorage.removeItem(VIEW);
    go('/profile');
  }

  return (
    <div class="flex flex-col gap-4">
      <div class={CARD}>
        <label class="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Display name</label>
        <div class="flex gap-2">
          <input aria-label="Profile name" value={rename} onInput={(e) => setRename(e.target.value)} class={FIELD} />
          <button type="button" onClick={saveRename} class={SECONDARY + ' h-11 shrink-0'}>Save</button>
        </div>
        <Msg m={nameMsg} />
      </div>

      <div class={CARD}>
        <p class="mb-3 text-sm font-semibold">Change passcode</p>
        <input type="password" autocomplete="current-password" placeholder="Current passcode" aria-label="Current passcode" value={curPass} onInput={(e) => setCurPass(e.target.value)} class={FIELD} />
        <input type="password" autocomplete="new-password" placeholder="New passcode (6+)" aria-label="New passcode" value={newPass} onInput={(e) => setNewPass(e.target.value)} class={FIELD + ' mt-2'} />
        <button type="button" onClick={savePasscode} class={'mt-3 ' + SECONDARY + ' h-11 w-full'}>Update passcode</button>
        <Msg m={passMsg} />
      </div>

      <div class={CARD}>
        {/* The whole row is the switch — a 24x44 track is a small target, and only
            spans go inside (a <p> in a <button> is invalid HTML and browsers
            restructure it, which breaks Preact hydration). */}
        <button type="button" role="switch" aria-checked={isPublic} onClick={togglePublic}
          class="flex w-full items-start justify-between gap-3 text-left">
          <span class="min-w-0">
            <span class="block text-sm font-semibold">Public profile</span>
            <span class="mt-0.5 block text-xs text-slate-400">
              {isPublic
                ? 'Anyone can open this profile from the picker and read it. They can’t edit anything.'
                : 'Only you can see this profile. Turn this on to let anyone read it, no passcode.'}
            </span>
          </span>
          <span aria-hidden="true"
            class={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${isPublic ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
            <span class={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${isPublic ? 'left-[22px]' : 'left-0.5'}`}></span>
          </span>
        </button>
        {isPublic && (
          <div class="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
            <span class="min-w-0 flex-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400">{publicUrl}</span>
            <button type="button" onClick={copyLink} class="shrink-0 rounded-lg bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">Copy</button>
          </div>
        )}
        <Msg m={pubMsg} />
      </div>

      {/* Sharing is how you give ONE person read access. A public profile already
          gives everyone that, so the section is meaningless while it's on. */}
      {!isPublic && (
      <div class={CARD}>
        <p class="text-sm font-semibold">Share (view-only)</p>
        <p class="mb-3 mt-0.5 text-xs text-slate-400">Let someone follow your habits for accountability. They'll see, never edit.</p>
        <div class="flex gap-2">
          <select aria-label="Choose a profile to share with" value={shareSel} onChange={(e) => setShareSel(e.target.value)} disabled={!options.length} class={FIELD}>
            {options.length ? [<option value="">Select a profile…</option>, ...options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)] : <option value="">No one left to share with</option>}
          </select>
          <button type="button" onClick={addShare} disabled={!options.length || !shareSel} class={SECONDARY + ' h-11 shrink-0'}>Share</button>
        </div>
        <Msg m={shareMsg} />
        <div class="mt-3 flex flex-col gap-1.5">
          {shared.length ? shared.map((v) => (
            <div key={v.id} class="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
              <span class="min-w-0 flex-1 truncate">{v.name}</span>
              {presence(v.last_active_at)}
              <span class={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${v.accepted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>{v.accepted ? 'active' : 'pending'}</span>
              <button type="button" aria-label={`Revoke ${v.name}`} onClick={() => revoke(v.id)} class="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-950/40">Revoke</button>
            </div>
          )) : <p class="text-xs text-slate-400">Not shared with anyone yet.</p>}
        </div>
      </div>
      )}

      {me.admin && presenceData && (
        <div class={CARD}>
          <div class="mb-3 flex items-center justify-between">
            <p class="text-sm font-semibold">Everyone</p>
            <span class="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>{presenceData.online} online</span>
          </div>
          <div class="flex flex-col gap-1.5">
            {presenceData.profiles.map((p) => (
              <div key={p.id} class="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                <span class="min-w-0 flex-1 truncate">{p.name}{p.id === me.id ? ' (you)' : ''}</span>
                {presence(p.last_active_at)}
              </div>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={() => setConfirm({ text: `Delete “${me.name}” and all its habits? This can't be undone.`, okLabel: 'Delete', onYes: del })}
        class="mt-1 rounded-xl border border-rose-200 py-2.5 text-sm font-medium text-rose-500 transition hover:bg-rose-50 dark:border-rose-950/60 dark:text-rose-400 dark:hover:bg-rose-950/40">Delete this profile</button>

      <Confirm data={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
