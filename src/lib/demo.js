// The demo profile: a curated, hardcoded dataset plus a client-side stand-in for
// the write API. Nothing here touches Postgres.
//
// Why hardcoded: /profile/demo is a link for strangers (GitHub, etc). Sourcing it
// from a real profile would mean either curating a prod profile forever or having
// the demo break the day that profile is deleted. And letting visitors write to a
// real profile would mean cleaning up after them.
//
// How it works: the page SSRs `demoSeed()` into #initial-habits, and the client
// forks it into localStorage. Every mutation is applied locally by `demoApi`,
// which mimics the real endpoints' request/response shapes, so the entire app
// (add, edit, delete, reorder, check in) works with no session and no writes.
import { iso, addDays, apiFetch, normalizeSchedule, resolveStartDate, scheduledDays, DAILY } from './compute.js';

const DEMO_KEY = 'habitrack_demo';
const DEMO_VISITOR_KEY = 'habitrack_demo_visitor';

// Habits are generated relative to today, so the demo never looks stale: streaks
// stay current and the calendars always have this month's data.
//   every: weekdays it's scheduled on (JS numbers, 0=Sun)
//   since: days back the habit started
//   hit:   chance a scheduled day got done (1 = a perfect streak)
//   slips: for quits, how many days back each slip was
const SEED = [
  { name: 'Morning run', emoji: '🏃', color: 'emerald', every: [1, 2, 3, 4, 5], since: 74, hit: 0.86, streak: 12 },
  { name: 'Read 20 pages', emoji: '📖', color: 'blue', every: [0, 1, 2, 3, 4, 5, 6], since: 96, hit: 0.79, streak: 5 },
  { name: 'Drink water', emoji: '💧', color: 'sky', every: [0, 1, 2, 3, 4, 5, 6], since: 61, hit: 0.83, streak: 3 },
  { name: 'Meditate', emoji: '🧘', color: 'violet', every: [0, 1, 2, 3, 4, 5, 6], since: 45, hit: 0.71, streak: 6 },
  { name: 'Gym', emoji: '🏋️', color: 'amber', every: [1, 3, 5], since: 120, hit: 0.9, streak: 2 },
  { name: 'Journal', emoji: '📝', color: 'rose', every: [0, 1, 2, 3, 4, 5, 6], since: 30, hit: 0.62, streak: 0 },
  { name: 'No smoking', emoji: '🚬', color: 'teal', since: 41, kind: 'streak', slips: [] },
  { name: 'No doomscrolling', emoji: '📱', color: 'orange', since: 52, kind: 'streak', slips: [9, 23] },
];

// Deterministic pseudo-random in [0,1): same demo for everyone, and stable across
// reloads (Math.random would reshuffle the history on every visit).
function rand(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Rebuilt at most once a day: the seed is identical for every visitor, and Workers
// isolates are reused across requests, so this keeps ~1,300 Date allocations off
// all but the first request of each day.
let cached = null;
let cachedDay = '';

// Rows shaped exactly like `listHabits` returns (schedule is CSV, start_date is a
// YYYY-MM-DD string, days is the check-in list).
export function demoSeed() {
  const today = iso(new Date());
  if (cachedDay === today) return structuredClone(cached);

  const seed = SEED.map((h, i) => {
    const start = addDays(today, -h.since);
    const streak = h.kind === 'streak';
    const sched = streak ? DAILY : h.every;
    const days = [];

    if (streak) {
      // A quit stores SLIPS; every other day is clean by default.
      for (const back of h.slips) days.push(addDays(today, -back));
    } else {
      // Fill the scheduled days counting back from today. Streaks are measured in
      // SCHEDULED days, not calendar days, so this has to index scheduled days.
      // Counting calendar days would let a rest day swallow the intended break and
      // inflate the streak.
      const sdays = scheduledDays(start, today, sched);
      sdays.forEach((d, k) => {
        const back = sdays.length - 1 - k;   // 0 = most recent scheduled day
        if (back < h.streak) { days.push(d); return; }   // the advertised streak
        if (back === h.streak) return;                   // the miss that starts it
        if (rand(i * 97 + k) < h.hit) days.push(d);      // older history
      });
    }

    return {
      id: i + 1,
      name: h.name,
      emoji: h.emoji,
      color: h.color,
      schedule: sched.join(','),
      kind: streak ? 'streak' : 'normal',
      start_date: start,
      created_at: start + 'T00:00:00.000Z',
      days,
    };
  });

  cached = seed;
  cachedDay = today;
  return structuredClone(seed);
}

// ---- client-side sandbox ---------------------------------------------------

export function loadDemo() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch { return null; }
}
export function saveDemo(habits) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(habits)); } catch { /* private mode / full quota */ }
}
export function clearDemo() {
  try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
}

// Count this visit. Identity is a random id in localStorage (no login, no IP, no
// fingerprinting), so "unique visitors" means "browsers that kept the id". One POST
// per tab session, so reloading doesn't inflate the number.
export async function trackDemoVisit() {
  try {
    if (sessionStorage.getItem('habitrack_demo_counted')) return;
    let id = localStorage.getItem(DEMO_VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
      localStorage.setItem(DEMO_VISITOR_KEY, id);
    }
    sessionStorage.setItem('habitrack_demo_counted', '1');
    await apiFetch('/api/demo-visit', { method: 'POST', body: { visitorId: id } });
  } catch { /* analytics must never break the demo */ }
}

// Stand-in for `apiFetch`, same {ok,status,data} contract. It only computes the
// response the real endpoint would return. Persistence is handled by the caller
// saving its own state after each render, so the two can't drift.
//
// `habits` is the live array, needed to mint the next id.
export function demoApi(path, { method = 'GET', body } = {}, habits = []) {
  const ok = (data, status = 200) => ({ ok: true, status, data });

  if (path === '/api/habits' && method === 'GET') return ok(habits);

  if (path === '/api/habits' && method === 'POST') {
    const today = iso(new Date());
    const kind = body.kind === 'streak' ? 'streak' : 'normal';
    const sched = normalizeSchedule(body.schedule, kind);
    const startDate = resolveStartDate(body.startDate, today);
    return ok({
      id: Math.max(0, ...habits.map((h) => h.id)) + 1,
      name: String(body.name || '').trim(),
      emoji: ((body.emoji || '✅').trim() || '✅').slice(0, 16),
      color: body.color || 'emerald',
      schedule: sched.join(','),
      kind,
      start_date: startDate,
      created_at: new Date().toISOString(),
      // A backdated normal habit backfills its scheduled days; a quit backfills
      // nothing (no rows means clean).
      days: kind === 'normal' && startDate ? scheduledDays(startDate, today, sched) : [],
    }, 201);
  }

  // PATCH echoes the updated columns for the caller to merge. `schedule` has to
  // become CSV here: the form sends an array, the real endpoint stores/returns CSV,
  // and schedOf() splits on commas.
  if (method === 'PATCH') {
    const patch = { ...body };
    if (Array.isArray(patch.schedule)) patch.schedule = patch.schedule.join(',');
    return ok(patch);
  }

  // Everything else (check-in, delete, reorder) is applied optimistically by the
  // caller and only needs an acknowledgement.
  return ok({ ok: true });
}
