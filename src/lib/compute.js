// Shared client-side computation + rendering helpers, used by both the main
// dashboard (index) and the /overview route so the logic never diverges.
// NB: filename intentionally avoids "analytics"/"tracking"/"stats" — those get
// blocked by ad/privacy blockers (net::ERR_BLOCKED_BY_CLIENT).

export const COLORS = {
  emerald: '#10b981', sky: '#0ea5e9', blue: '#3b82f6', violet: '#8b5cf6',
  rose: '#f43f5e', amber: '#f59e0b', orange: '#f97316', teal: '#14b8a6',
  pink: '#ec4899', lime: '#84cc16',
};

// Dark shade of each hue — used for a number that must read clearly against a
// pale ~12% tint of the same color (e.g. missed-day numbers).
export const COLORS_DARK = {
  emerald: '#065f46', sky: '#0c4a6e', blue: '#1e3a8a', violet: '#4c1d95',
  rose: '#791f1f', amber: '#78350f', orange: '#7c2d12', teal: '#134e4a',
  pink: '#831843', lime: '#365314',
};
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- date helpers (local YYYY-MM-DD, no UTC drift) -----------------------
export const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const TODAY = iso(new Date());
export const pad2 = (n) => String(n).padStart(2, '0');
export const addDays = (isoStr, n) => {
  const d = new Date(isoStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const dow = (isoStr) => new Date(isoStr + 'T00:00:00').getDay();
export const schedOf = (h) => new Set((h.schedule || '0,1,2,3,4,5,6').split(',').map(Number));

// A habit is "active" from the earlier of its created date or first check-in
// (backfilled check-ins prove it was already being tracked). Mirror this
// everywhere "missed vs before-created" matters.
export function activeFromOf(habit) {
  const first = habit.days && habit.days.length ? habit.days.reduce((a, b) => (a < b ? a : b)) : null;
  const created = (habit.created_at || '').slice(0, 10) || null;
  return (first && created) ? (first < created ? first : created) : (first || created);
}

// ---- stats (only scheduled days count; streaks skip rest days) -----------
export function stats(habit) {
  const set = new Set(habit.days);
  const sched = schedOf(habit);
  const due = (d) => sched.has(dow(d));

  let cur = 0;
  for (let d = TODAY, guard = 0; guard < 800; d = addDays(d, -1), guard++) {
    if (!due(d)) continue;
    if (set.has(d)) cur++;
    else if (d === TODAY) continue;
    else break;
  }

  const start = habit.days.length ? [...set].sort()[0] : TODAY;
  let longest = 0, run = 0;
  for (let d = start; d <= TODAY; d = addDays(d, 1)) {
    if (!due(d)) continue;
    if (set.has(d)) { run++; if (run > longest) longest = run; }
    else run = 0;
  }

  let dueCount = 0, hit = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(TODAY, -i);
    if (due(d)) { dueCount++; if (set.has(d)) hit++; }
  }
  return { current: cur, longest, total: set.size, rate30: dueCount ? Math.round((hit / dueCount) * 100) : 0 };
}

// How many days back a check-in may be marked, today inclusive. Change this one
// number to widen/narrow the backfill window; enforced in the UI (exact, local)
// and coarsely in /api/checkins (server backstop).
export const BACKFILL_DAYS = 7;

// ---- rolling-12-month heatmap --------------------------------------------
export function windowStart() {
  const t = new Date(TODAY + 'T00:00:00');
  return iso(new Date(t.getFullYear(), t.getMonth() - 11, 1));
}

export function heatmapBlock({ earliest, dayInfo, legend, countText }) {
  const startBase = new Date(earliest + 'T00:00:00');
  const gridStart = addDays(earliest, -startBase.getDay());
  const t = new Date(TODAY + 'T00:00:00');
  const gridEnd = addDays(TODAY, 6 - t.getDay());
  const total = Math.round((new Date(gridEnd + 'T00:00:00') - new Date(gridStart + 'T00:00:00')) / 86400000) + 1;
  const weeks = total / 7;

  let months = '';
  for (let w = 0; w < weeks; w++) {
    const colStart = addDays(gridStart, w * 7);
    let lbl = '';
    for (let k = 0; k < 7; k++) {
      const dd = new Date(addDays(colStart, k) + 'T00:00:00');
      if (dd.getDate() === 1) { lbl = MONTHS[dd.getMonth()]; break; }
    }
    months += `<div class="overflow-visible whitespace-nowrap">${lbl}</div>`;
  }

  let cells = '';
  for (let i = 0; i < total; i++) {
    const ds = addDays(gridStart, i);
    if (ds < earliest || ds > TODAY) { cells += '<span class="aspect-square rounded-[2px] opacity-0"></span>'; continue; }
    const info = dayInfo(ds) || {};
    cells += `<span class="aspect-square rounded-[2px] ${info.cls || ''}" style="${info.style || ''}" title="${info.title || ''}"></span>`;
  }

  // GitHub-style: 2px radius, ~3px gaps, month labels above. Cells are
  // aspect-square in 1fr columns, so the whole grid fits the container width
  // exactly (no scroll) with every box a true square.
  return `
    ${countText ? `<p class="mb-3 text-xs font-medium text-slate-500 dark:text-slate-400">${countText}</p>` : ''}
    <div>
      <div class="grid gap-x-[2px] text-[11px] leading-none text-slate-500 dark:text-slate-400 sm:gap-x-[3px]" style="grid-template-columns:repeat(${weeks},minmax(0,1fr))">${months}</div>
      <div class="mt-1.5 grid gap-[2px] sm:gap-[3px]" style="grid-auto-flow:column;grid-template-columns:repeat(${weeks},minmax(0,1fr));grid-template-rows:repeat(7,auto)">${cells}</div>
      ${legend || ''}
    </div>`;
}

// per-habit heatmap: binary done / rest / missed, in the habit's own color
export function githubGraph(habit) {
  const set = new Set(habit.days);
  const sched = schedOf(habit);
  const color = COLORS[habit.color] || COLORS.emerald;
  const earliest = windowStart();
  const count = habit.days.filter((d) => d >= earliest && d <= TODAY).length;
  const dayInfo = (ds) => {
    if (set.has(ds)) return { style: `background:${color}`, title: ds + ' · done' };
    if (!sched.has(new Date(ds + 'T00:00:00').getDay())) return { cls: 'bg-slate-100/70 dark:bg-slate-800/40', title: ds + ' · rest day' };
    return { cls: 'bg-slate-200/80 dark:bg-slate-800', title: ds };
  };
  const legend = `<div class="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
      <span>Missed</span>
      <span class="h-[10px] w-[10px] rounded-[2px] bg-slate-200/80 dark:bg-slate-800"></span>
      <span class="h-[10px] w-[10px] rounded-[2px]" style="background:${color}"></span>
      <span>Done</span>
    </div>`;
  return `<div>${heatmapBlock({ earliest, dayInfo, legend, countText: `${count} check-in${count === 1 ? '' : 's'} in the last year` })}</div>`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- data export (long format: one row per habit per day) ----------------
// Status mirrors the calendar exactly: done > before_created > not_scheduled
// > missed. `today` is injectable for testing.
export function buildExportRecords(habits, today = TODAY) {
  const meta = habits.map((h) => ({
    h,
    days: new Set(h.days),
    sched: schedOf(h),
    created: (h.created_at || '').slice(0, 10) || null,
    activeFrom: activeFromOf(h),
  }));

  let start = today;
  for (const m of meta) if (m.activeFrom && m.activeFrom < start) start = m.activeFrom;

  const records = [];
  for (const m of meta) {
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const wd = new Date(d + 'T00:00:00').getDay();
      const scheduled = m.sched.has(wd);
      let status;
      if (m.days.has(d)) status = 'done';
      else if (m.activeFrom && d < m.activeFrom) status = 'before_created';
      else if (!scheduled) status = 'not_scheduled';
      else status = 'missed';
      records.push({
        date: d,
        day_of_week: WD_SUN[wd],
        habit_name: m.h.name,
        habit_created_date: m.created || '',
        scheduled,
        status,
      });
    }
  }
  return records;
}

const EXPORT_COLS = ['date', 'day_of_week', 'habit_name', 'habit_created_date', 'scheduled', 'status'];

export function toCSV(records) {
  const esc = (v) => {
    let s = String(v);
    // Neutralize spreadsheet formula injection: a field starting with = + - @ (or
    // a leading tab/CR) can execute as a formula in Excel/Sheets. Prefix a quote
    // so the value is treated as literal text.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [EXPORT_COLS.join(',')];
  for (const r of records) lines.push(EXPORT_COLS.map((c) => esc(r[c])).join(','));
  return lines.join('\n');
}

export function toJSON(records) {
  return JSON.stringify(records, null, 2);
}

// ---- relative time --------------------------------------------------------
// Compact "last active" label from a timestamp (or null). "online" is decided
// by the server; this is just the fuzzy age for everything else.
export function timeAgo(ts) {
  if (!ts) return 'never';
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// ---- API client -----------------------------------------------------------
// One place for the request boilerplate: bearer token, socket id, JSON encode,
// no-store, and JSON decode. Returns { ok, status, data } so callers can branch
// on status (401/403/…) without touching Response plumbing. `body` (when set)
// is JSON-stringified and gets the Content-Type header automatically.
export async function apiFetch(path, { method = 'GET', body, token, socketId } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (socketId) headers['x-socket-id'] = socketId;
  const opts = { method, headers, cache: 'no-store' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty / non-JSON body */ }
  return { ok: res.ok, status: res.status, data };
}

// ---- realtime (Pusher) ---------------------------------------------------
// Lazily imports pusher-js so it's only downloaded when realtime is enabled.
// Returns the Pusher instance (read .connection.socket_id for exclusion).
export async function connectRealtime({ key, cluster, channel, onEvent }) {
  const { default: Pusher } = await import('pusher-js');
  const pusher = new Pusher(key, { cluster });
  pusher.subscribe(channel).bind('changed', onEvent);
  return pusher;
}

export function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
