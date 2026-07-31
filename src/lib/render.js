// HTML for the collapsed habit list, shared by the server and the client.
//
// Why this is its own module: the list used to be built only in HabitApp's client
// script, so nothing appeared until a 37KB module had downloaded, parsed and run.
// These functions are pure string builders with no DOM access, so the page can now
// render the same markup during SSR and paint the list with the HTML.
//
// The client then calls the very same functions on every state change, which is what
// keeps the two identical — a second implementation would drift and flicker.
//
// `today` is always an explicit argument, never the module-level TODAY. The server
// and the browser can disagree about the date (see todayInZone), so it has to be
// passed in rather than baked in.
//
// The EXPANDED card (month calendar, graphs, reorder controls) is deliberately not
// here: nothing is expanded on first paint, and it needs client-only state.
import {
  COLORS, SLIP_COLOR, BACKFILL_DAYS,
  addDays, dow, schedOf, stats, isStreak, startOf, escapeHtml,
} from './compute.js';

// Mobile: 7 equal columns — the name sits on its own full-width row above the
// checks. Desktop (sm+): name column + 7 fixed day columns on one row.
export const GRID = 'grid grid-cols-7 gap-y-1 sm:grid-cols-[minmax(0,1fr)_repeat(7,2.25rem)] sm:gap-y-0 items-center';

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="h-[18px] w-[18px]"><path d="M4.5 12.75l6 6 9-13.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M6 18L18 6M6 6l12 12"/></svg>';
const FLAME = '<svg viewBox="0 0 24 24" fill="currentColor" class="h-3 w-3"><path d="M12.963 2.286a.75.75 0 0 0-1.071-.136 9.742 9.742 0 0 0-3.539 6.177A7.547 7.547 0 0 1 6.648 6.61a.75.75 0 0 0-1.152-.081A9 9 0 1 0 15.68 4.534a7.46 7.46 0 0 1-2.717-2.248Z"/><path d="M15.75 14.25a3.75 3.75 0 1 1-7.313-1.172c.628.465 1.35.81 2.133 1.005a5.99 5.99 0 0 1 1.925-3.547 3.75 3.75 0 0 1 3.255 3.714Z"/></svg>';
const REST = '<span class="h-1 w-1 rounded-full bg-slate-200 dark:bg-slate-700"></span>';

// The local calendar date in an IANA zone. Cloudflare hands us the visitor's zone
// (request.cf.timezone), which is what lets the SSR'd week strip agree with the
// browser's own idea of "today" instead of using the Worker's UTC.
export function todayInZone(zone, now = new Date()) {
  // Guard the empty case explicitly: `timeZone: undefined` does NOT throw, it
  // silently uses the runtime's own zone, which would make the caller's fallback
  // unreachable and hide the fact that we never got a zone.
  if (!zone) return null;
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
  } catch {
    return null; // unknown zone — caller falls back
  }
}

const last7 = (today) => Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

// Earliest day a check-in can still be marked (today − (BACKFILL_DAYS−1)).
export const backfillStart = (today) => addDays(today, -(BACKFILL_DAYS - 1));

export function weekHeaderHtml(today) {
  const cols = last7(today).map((d) => {
    const dd = new Date(d + 'T00:00:00');
    const isToday = d === today;
    return `<div class="flex flex-col items-center leading-tight ${isToday ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}">
              <span class="text-[11px] font-medium">${dd.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <span class="text-[11px] ${isToday ? 'font-semibold' : ''}">${dd.getDate()}</span>
            </div>`;
  }).join('');
  // leading empty cell only exists on desktop (name column)
  return `<div class="${GRID}"><span class="hidden sm:block"></span>${cols}</div>`;
}

// Streak 7-day strip: every day is clean (✓, colour) by default from the start
// date; slips (habit.days) show a red ✕. Tapping toggles a slip, so you can mark
// "I slipped yesterday" if you forgot to open the app.
function weekCellsStreak(habit, { today, readOnly }) {
  const slips = new Set(habit.days);
  const color = COLORS[habit.color] || COLORS.emerald;
  const start = startOf(habit, today);
  const editableFrom = backfillStart(today);
  return last7(today).map((d) => {
    const todayBg = d === today ? 'rounded-lg bg-slate-50/70 dark:bg-slate-800/40' : '';
    if (d < start) {
      // before the streak began — not tracked
      return `<div class="flex h-9 items-center justify-center opacity-70" title="${d} · before start">${REST}</div>`;
    }
    const slip = slips.has(d);
    const editable = !readOnly && d >= editableFrom;
    const marker = slip
      ? `<span class="text-rose-500 dark:text-rose-400">${CROSS}</span>`
      : `<span style="color:${color}">${CHECK}</span>`;
    const title = `${d}${slip ? ' · slipped' : ' · clean'}`;
    if (!editable) return `<div class="flex h-9 items-center justify-center ${todayBg}" title="${title}">${marker}</div>`;
    return `<button data-day="${d}" data-habit="${habit.id}"
              class="day flex h-9 touch-manipulation items-center justify-center rounded-lg transition hover:bg-slate-50 active:scale-90 dark:hover:bg-slate-800/60 ${todayBg}"
              title="${title}">${marker}</button>`;
  }).join('');
}

export function weekCellsHtml(habit, ctx) {
  if (isStreak(habit)) return weekCellsStreak(habit, ctx);
  const { today, readOnly } = ctx;
  const set = new Set(habit.days);
  const sched = schedOf(habit);
  const color = COLORS[habit.color] || COLORS.emerald;
  const editableFrom = backfillStart(today);
  return last7(today).map((d) => {
    const isToday = d === today;
    if (!sched.has(dow(d))) {
      // rest day — not tracked, not clickable
      return `<div class="flex h-9 items-center justify-center opacity-70" title="${d} · rest day">${REST}</div>`;
    }
    const done = set.has(d);
    const editable = !readOnly && d >= editableFrom;   // today + the backfill window
    const todayBg = isToday ? 'rounded-lg bg-slate-50/70 dark:bg-slate-800/40' : '';
    // marker: done ✓ (colour) · markable ◯ (hollow ring) · missed & locked ✕ (faint)
    const marker = done
      ? `<span style="color:${color}">${CHECK}</span>`
      : editable
        ? `<span class="h-[18px] w-[18px] rounded-full border-2 ${isToday ? '' : 'border-slate-300 dark:border-slate-600'}"${isToday ? ` style="border-color:${color}"` : ''}></span>`
        : `<span class="text-slate-300 dark:text-slate-600">${CROSS}</span>`;
    if (!editable) {
      return `<div class="flex h-9 items-center justify-center ${todayBg}" title="${d}${done ? ' · done' : ''}">${marker}</div>`;
    }
    return `<button data-day="${d}" data-habit="${habit.id}"
              class="day flex h-9 touch-manipulation items-center justify-center rounded-lg transition hover:bg-slate-50 active:scale-90 dark:hover:bg-slate-800/60 ${todayBg}"
              title="${d}${done ? ' · done' : ''}">${marker}</button>`;
  }).join('');
}

// The habit's name row. Shared with the expanded card, which is why `isOpen` only
// controls the chevron's rotation.
export function nameBtnHtml(h, { today, isOpen = false } = {}) {
  const s = stats(h, today);
  const color = COLORS[h.color] || COLORS.emerald;
  return `
          <button data-toggle="${h.id}" class="flex w-full min-w-0 items-center gap-2 py-1.5 pr-2 text-left">
            <span class="shrink-0 text-base">${escapeHtml(h.emoji)}</span>
            <span class="truncate font-medium">${escapeHtml(h.name)}</span>
            ${s.current > 0 ? `<span class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums" style="color:${color};background:${color}14" title="${s.current}-day ${isStreak(h) ? 'clean streak' : 'streak'}">${FLAME}${s.current}</span>` : ''}
            <svg class="ml-auto h-4 w-4 shrink-0 text-slate-300 transition ${isOpen ? 'rotate-180' : ''} dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>
          </button>`;
}

// The <article> shell, so the client's expanded branch wraps its content the same way.
export const cardShellHtml = (inner) => `
        <article class="rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-black/5 transition dark:bg-slate-900 dark:ring-white/10">
          ${inner}
        </article>`;

// A collapsed card: name row + the 7-day strip.
export function collapsedCardHtml(h, ctx) {
  const inner = `<div class="${GRID}"><div class="col-span-7 cursor-pointer sm:col-span-1" data-toggle="${h.id}">${nameBtnHtml(h, ctx)}</div>${weekCellsHtml(h, ctx)}</div>`;
  return cardShellHtml(inner);
}

// The whole list for one kind tab.
export function habitListHtml(habits, ctx) {
  return habits.map((h) => collapsedCardHtml(h, ctx)).join('');
}

// ---- Today card ------------------------------------------------------------

function ringSvg(segments, gap = 0) {
  const C = 2 * Math.PI * 15.5;
  let start = 0, arcs = '';
  for (const s of segments) {
    const len = Math.max(0, s.frac * C - gap);
    if (len > 0.01) {
      arcs += `<circle cx="18" cy="18" r="15.5" fill="none" stroke="${s.color}" stroke-width="4"${gap ? ' stroke-linecap="round"' : ''} stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-(start + gap / 2)}" style="transition:stroke-dashoffset .5s ease"/>`;
    }
    start += s.frac * C;
  }
  return `<svg class="h-12 w-12 -rotate-90 sm:h-14 sm:w-14" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" class="stroke-slate-100 dark:stroke-slate-800" stroke-width="4"/>${arcs}</svg>`;
}

function ringBlock(svg, center, title, sub) {
  return `<div>
            <div class="relative mx-auto h-12 w-12 sm:h-14 sm:w-14">${svg}<span class="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums sm:text-sm">${center}</span></div>
            <div class="mt-1 text-center text-[11px] font-semibold leading-tight text-slate-500 dark:text-slate-400">${title}<span class="mt-px hidden text-[10px] font-medium text-slate-400 dark:text-slate-500 sm:block">${sub}</span></div>
          </div>`;
}

// Two-track daily summary: habits done/due today + quits clean/slipped today. Each
// ring appears only if its track has something today; the card hides if neither does.
// Returns the pieces rather than touching the DOM, so SSR and the client can each
// apply them their own way.
export function todayCardData(habits, today) {
  const todayDow = dow(today);
  const quits = habits.filter(isStreak);
  const due = habits.filter((h) => !isStreak(h) && schedOf(h).has(todayDow));
  const done = due.filter((h) => h.days.includes(today)).length;
  const slip = quits.filter((h) => h.days.includes(today)).length;
  const clean = quits.length - slip;

  const showHabits = due.length > 0, showQuits = quits.length > 0;
  if (!showHabits && !showQuits) return { show: false, rings: '', text: '', cls: '' };

  let rings = '';
  if (showHabits) rings += ringBlock(ringSvg([{ frac: done / due.length, color: COLORS.emerald }]), `${done}/${due.length}`, 'Habits', 'done today');
  if (showQuits) rings += ringBlock(ringSvg([
    { frac: clean / quits.length, color: COLORS.emerald },
    { frac: slip / quits.length, color: SLIP_COLOR },
  ], 1.5), `${clean}/${quits.length}`, 'Quit', 'clean today');

  let text, cls;
  if (slip > 0) { text = `${slip} slip${slip > 1 ? 's' : ''} today`; cls = 'text-red-500 dark:text-red-400'; }
  else if (showHabits && done < due.length) { const left = due.length - done; text = `${left} habit${left > 1 ? 's' : ''} to go`; cls = 'text-slate-500 dark:text-slate-400'; }
  else { text = showQuits ? 'All clean · keep going' : 'All done today'; cls = 'text-emerald-600 dark:text-emerald-400'; }

  return { show: true, rings, text, cls };
}

// The kind-tab button classes (Habits / Streaks).
export const tabButtonClass = (isActive) => `rounded-lg py-2 transition ${isActive
  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`;
