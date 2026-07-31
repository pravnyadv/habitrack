import { timeAgo } from '../../lib/compute.js';

// localStorage keys + a tiny reader (client-only; guarded for SSR).
export const TK = 'habitrack_token';
export const PID = 'habitrack_profile';
export const VIEW = 'habitrack_viewing';
export const go = (url) => { location.href = url; };

// shared class strings (match the rest of the app)
export const CARD = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10';
export const FIELD = 'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-800';
export const PRIMARY = 'h-11 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 active:scale-95';
export const SECONDARY = 'rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
export const SECTION = 'mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400';

export const PERSON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0" /></svg>;
export const EYE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>;
export const LOCK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-3 w-3"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>;
export const GLOBE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-3 w-3"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 1 0 0-18m0 18a9 9 0 1 1 0-18m0 18c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m-8.716 6h17.432m-17.432 6h17.432" /></svg>;

// Private / Public pill for a profile row in the logged-out picker.
export function Visibility({ isPublic }) {
  return isPublic
    ? <span class="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">{GLOBE}Public</span>
    : <span class="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{LOCK}Private</span>;
}

export const TRASH =<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>;

export function presence(ts) {
  const online = ts && (Date.now() - new Date(ts).getTime()) < 120000;
  return online
    ? <span class="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"><span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>online</span>
    : <span class="shrink-0 text-[11px] text-slate-400">{timeAgo(ts)}</span>;
}
export function Msg({ m }) {
  if (!m) return null;
  return <p class={`mt-2 text-xs font-medium ${m.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>{m.text}</p>;
}

// Confirm dialog. Parent holds `data` ({text, okLabel, danger, onYes}) in state.
export function Confirm({ data, onClose }) {
  if (!data) return null;
  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <p class="text-sm text-slate-600 dark:text-slate-300">{data.text}</p>
        <div class="mt-5 flex gap-2">
          <button onClick={onClose} class="h-10 flex-1 rounded-xl bg-slate-100 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={() => { const fn = data.onYes; onClose(); fn && fn(); }} class={`h-10 flex-1 rounded-xl text-sm font-semibold text-white transition active:scale-95 ${data.danger === false ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600'}`}>{data.okLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
