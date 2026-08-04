import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  TODAY, iso, addDays, schedOf, stats, windowStart, activeFromOf,
  heatmapBlock, githubGraph, buildExportRecords, toCSV, toJSON, downloadFile, connectRealtime, apiFetch,
} from '../lib/compute.js';
import { loadDemo } from '../lib/demo.js';

const VIEW = 'habitrack_viewing';
// aggregate completion levels: 1-25 / 26-50 / 51-75 / 76-100 %
const AGG_LEVELS = ['#6ee7b7', '#34d399', '#10b981', '#047857'];

// props: initialHabits (SSR'd own habits), profileId (own id, for the realtime channel),
//        mode ('app' | 'demo'). In demo mode there is no session and no server-side
//        profile: the data is the visitor's localStorage sandbox, so that is what gets
//        read, and there is nothing to authenticate against or subscribe to.
export default function Overview({ initialHabits = [], profileId, mode = 'app' }) {
  const demo = mode === 'demo';
  const [habits, setHabits] = useState(initialHabits);
  const [filter, setFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewing, setViewing] = useState(null); // resolved client-side (localStorage)

  const heatRef = useRef(null);

  async function load(viewId) {
    // The demo has no API to call. An untouched sandbox is simply absent, and the
    // SSR'd seed is already right for that case, so leave state alone.
    if (demo) { const local = loadDemo(); if (local) setHabits(local); return; }
    const url = viewId ? `/api/habits?profile=${viewId}` : '/api/habits';
    const { ok, status, data } = await apiFetch(url);
    if (status === 401) { location.href = '/profile'; return; }
    if (status === 403) { localStorage.removeItem(VIEW); location.href = '/'; return; }
    if (ok) setHabits(data);
  }

  useEffect(() => {
    let v = null;
    // Share-preview is a signed-in concept; the demo can never be viewing anyone.
    if (!demo) { try { v = JSON.parse(localStorage.getItem(VIEW) || 'null'); } catch {} }
    setViewing(v);
    const dataId = v ? v.id : profileId;
    // Always read fresh on mount. The SSR snapshot can be stale on a long-lived
    // PWA (which keeps the page in memory for days), and in the demo it is the
    // pristine seed while the visitor may have changed their sandbox since.
    load(v ? v.id : null);
    // No realtime in the demo: there is no server-side profile to have a channel.
    if (!demo) (async () => {
      try {
        const { ok, data: cfg } = await apiFetch('/api/rt-config');
        if (!ok || !cfg.enabled) return;
        await connectRealtime({ key: cfg.key, cluster: cfg.cluster, channel: `habitrack-${dataId}`, onEvent: () => load(v ? v.id : null) });
      } catch { /* best-effort */ }
    })();
    // Seamless refresh when the app returns to the foreground (PWA has no
    // pull-to-refresh); reload outright if the day rolled over so dates are fresh.
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (iso(new Date()) !== TODAY) { location.reload(); return; }
      load(v ? v.id : null);
    };
    const onPageShow = (e) => { if (e.persisted) refresh(); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', onPageShow);
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // Streak (quit/abstain) habits store slip days, not completions, so they'd skew
  // "avg completion". The Overview is about normal habits only.
  const norm = habits.filter((h) => h.kind !== 'streak');

  const agg = useMemo(() => {
    if (!norm.length) return null;
    const H = norm.map((h) => ({ daySet: new Set(h.days), sched: schedOf(h), activeFrom: activeFromOf(h) }));
    const dayTally = (ds) => {
      const wd = new Date(ds + 'T00:00:00').getDay();
      let sc = 0, dn = 0;
      for (const h of H) {
        if (h.activeFrom && h.activeFrom > ds) continue;
        if (!h.sched.has(wd)) continue;
        sc++; if (h.daySet.has(ds)) dn++;
      }
      return { sc, dn };
    };
    const earliest = windowStart();
    let sumPct = 0, daysWithSched = 0, perfect = 0;
    for (let d = earliest; d <= TODAY; d = addDays(d, 1)) {
      const { sc, dn } = dayTally(d);
      if (sc > 0) { sumPct += dn / sc; daysWithSched++; if (dn === sc) perfect++; }
    }
    const avg = daysWithSched ? Math.round((sumPct / daysWithSched) * 100) : 0;
    const longest = Math.max(0, ...norm.map((h) => stats(h).longest));

    let heat;
    if (filter === 'all') {
      const total = norm.reduce((n, h) => n + h.days.filter((d) => d >= earliest && d <= TODAY).length, 0);
      const dayInfo = (ds) => {
        const { sc, dn } = dayTally(ds);
        if (sc === 0) return { cls: 'bg-slate-100/70 dark:bg-slate-800/40', title: ds + ' · no habits' };
        const pct = (dn / sc) * 100;
        const title = `${ds} · ${dn}/${sc} (${Math.round(pct)}%)`;
        if (pct === 0) return { cls: 'bg-slate-200/80 dark:bg-slate-800', title };
        const idx = pct <= 25 ? 0 : pct <= 50 ? 1 : pct <= 75 ? 2 : 3;
        return { style: `background:${AGG_LEVELS[idx]}`, title };
      };
      const legend = `<div class="mt-2 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
          <span class="mr-0.5">Less</span>
          <span class="h-[10px] w-[10px] rounded-[2px] bg-slate-200/80 dark:bg-slate-800"></span>
          ${AGG_LEVELS.map((c) => `<span class="h-[10px] w-[10px] rounded-[2px]" style="background:${c}"></span>`).join('')}
          <span class="ml-0.5">More</span>
        </div>`;
      heat = heatmapBlock({ earliest, dayInfo, legend, countText: `${total} check-in${total === 1 ? '' : 's'} in the last year` });
    } else {
      const h = norm.find((x) => x.id === filter);
      heat = h ? githubGraph(h) : '';
    }
    return { avg, perfect, longest, heat };
  }, [habits, filter]);

  // Preact does not reliably re-apply `dangerouslySetInnerHTML` after hydration
  // when the string is unchanged between renders, so the SSR graph could stay
  // stale/empty even though `agg.heat` is correct. Set it imperatively so the
  // DOM always matches the computed HTML.
  useEffect(() => {
    if (heatRef.current && agg) heatRef.current.innerHTML = agg.heat;
  }, [agg]);

  function exportRecords(kind) {
    setMenuOpen(false);
    // Every habit, not `norm`: the stats above exclude quits because slip days
    // would skew them, but an export that drops half your data is just wrong.
    // buildExportRecords labels each kind in its own vocabulary.
    const records = buildExportRecords(habits);
    if (kind === 'csv') downloadFile(`habitrack-export-${TODAY}.csv`, toCSV(records), 'text/csv;charset=utf-8');
    else downloadFile(`habitrack-export-${TODAY}.json`, toJSON(records), 'application/json');
  }

  return (
    <div>
      <div class="mb-4 flex items-center justify-between">
        <p class="text-sm text-slate-400">{viewing ? 'Last 12 months' : 'Your last 12 months'}</p>
        {!viewing && habits.length > 0 && (
          <div class="relative">
            <button aria-label="Export data" title="Export"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-white"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}>
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>
            </button>
            {menuOpen && (
              <div class="absolute right-0 z-10 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                <button onClick={() => exportRecords('csv')} class="flex w-full items-center px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">Export as CSV</button>
                <button onClick={() => exportRecords('json')} class="flex w-full items-center px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">Export as JSON</button>
              </div>
            )}
          </div>
        )}
      </div>

      {!norm.length ? (
        <p class="py-16 text-center text-sm text-slate-400 dark:text-slate-500">No habits yet — add some to see your overview.</p>
      ) : (
        <>
          <div class="grid grid-cols-3 gap-2">
            <Card label="Avg completion" val={agg.avg + '%'} />
            <Card label="Perfect days" val={agg.perfect} />
            <Card label="Longest streak" val={agg.longest} />
          </div>
          <div class="mt-6 flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All habits</Chip>
            {norm.map((h) => (
              <Chip key={h.id} active={filter === h.id} onClick={() => setFilter(h.id)}>{h.emoji} {h.name}</Chip>
            ))}
          </div>
          <div ref={heatRef} class="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10" dangerouslySetInnerHTML={{ __html: agg.heat }} />
        </>
      )}
    </div>
  );
}

function Card({ label, val }) {
  return (
    <div class="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-black/5 dark:bg-slate-900 dark:ring-white/10">
      <div class="text-2xl font-bold tabular-nums">{val}</div>
      <div class="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      class={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active
        ? 'bg-emerald-500 text-white'
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
      {children}
    </button>
  );
}
