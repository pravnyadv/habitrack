// Tests for src/lib/demo.js: the hardcoded demo seed and the localStorage
// stand-in for the write API.
//
// The parity suite at the bottom is the important one. demoApi has to derive a new
// habit exactly the way POST /api/habits does, and an earlier copy of those rules
// had already drifted (it returned `schedule` as an array where the real endpoint
// returns CSV, which broke schedOf after any demo edit).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { demoSeed, demoApi } from '../src/lib/demo.js';
import {
  TODAY, DAILY, COLORS, addDays, dow, schedOf, isStreak, stats,
  normalizeSchedule, resolveStartDate, scheduledDays,
} from '../src/lib/compute.js';

describe('demoSeed', () => {
  const seed = demoSeed();

  test('produces the advertised set of trackers', () => {
    assert.equal(seed.length, 8);
    assert.equal(seed.filter((h) => isStreak(h)).length, 2, 'two quits');
    assert.equal(new Set(seed.map((h) => h.id)).size, seed.length, 'ids are unique');
  });

  test('every row has the shape listHabits returns', () => {
    for (const h of seed) {
      assert.match(h.schedule, /^[0-6](,[0-6])*$/, `${h.name}: schedule must be CSV`);
      assert.match(h.start_date, /^\d{4}-\d{2}-\d{2}$/, `${h.name}: start_date`);
      assert.match(h.created_at, /^\d{4}-\d{2}-\d{2}T/, `${h.name}: created_at is ISO`);
      assert.ok(Array.isArray(h.days), `${h.name}: days is an array`);
      assert.ok(['normal', 'streak'].includes(h.kind), `${h.name}: kind`);
    }
  });

  test('every colour exists in the palette', () => {
    // An unknown colour silently falls back to emerald, so the demo would render
    // several identical-looking habits.
    for (const h of seed) assert.ok(COLORS[h.color], `${h.name}: unknown colour ${h.color}`);
  });

  test('no check-in is in the future or before its start', () => {
    for (const h of seed) {
      for (const d of h.days) {
        assert.ok(d <= TODAY, `${h.name}: ${d} is in the future`);
        assert.ok(d >= h.start_date, `${h.name}: ${d} precedes start_date`);
      }
    }
  });

  test('quits have no rest days and no backfilled clean days', () => {
    for (const h of seed.filter(isStreak)) {
      assert.deepEqual([...schedOf(h)].sort((a, b) => a - b), DAILY, `${h.name}: quits are daily`);
    }
  });

  test('normal habits only ever have check-ins on scheduled days', () => {
    for (const h of seed.filter((x) => !isStreak(x))) {
      const sched = schedOf(h);
      for (const d of h.days) assert.ok(sched.has(dow(d)), `${h.name}: ${d} is not a scheduled day`);
    }
  });

  test('the streaks match what the seed advertises', () => {
    // If this drifts the demo still works, but it stops looking alive, which is
    // the entire reason the data is generated relative to today.
    const want = {
      'Morning run': 12, 'Read 20 pages': 5, 'Drink water': 3,
      'Meditate': 6, 'Gym': 2, 'Journal': 0, 'No doomscrolling': 9,
    };
    for (const h of seed) {
      if (want[h.name] === undefined) continue;
      assert.equal(stats(h).current, want[h.name], `${h.name}: current streak`);
    }
  });

  test('a habit with history has a non-trivial calendar', () => {
    const run = seed.find((h) => h.name === 'Morning run');
    assert.ok(run.days.length > 20, 'enough history to fill the month view');
    assert.ok(stats(run).rate30 > 0 && stats(run).rate30 < 100, 'realistic, not perfect');
  });
});

describe('demoSeed caching', () => {
  test('repeated calls return equal data', () => {
    assert.deepEqual(demoSeed(), demoSeed());
  });

  test('each call returns a fresh copy, not the cached object', () => {
    const a = demoSeed();
    const b = demoSeed();
    assert.notEqual(a, b);
    assert.notEqual(a[0], b[0]);
    assert.notEqual(a[0].days, b[0].days);
  });

  test('mutating a returned copy cannot poison the cache', () => {
    // The demo mutates its habits constantly, and the cache is shared across
    // every request in a Workers isolate.
    const a = demoSeed();
    a[0].days.push('1999-01-01');
    a[0].name = 'clobbered';
    a.pop();
    const fresh = demoSeed();
    assert.equal(fresh.length, 8);
    assert.notEqual(fresh[0].name, 'clobbered');
    assert.ok(!fresh[0].days.includes('1999-01-01'));
  });
});

describe('demoApi', () => {
  const seed = demoSeed();

  test('GET /api/habits hands back the live list', async () => {
    const r = await demoApi('/api/habits', {}, seed);
    assert.equal(r.status, 200);
    assert.equal(r.data, seed);
  });

  test('write endpoints acknowledge, since the caller already applied them', async () => {
    // Check-in, delete and reorder are optimistic in the client, so the response
    // body is never read.
    for (const [path, method] of [
      ['/api/checkins', 'POST'],
      ['/api/habits/reorder', 'POST'],
      ['/api/habits/3', 'DELETE'],
    ]) {
      const r = await demoApi(path, { method, body: {} }, seed);
      assert.equal(r.ok, true, `${method} ${path}`);
      assert.equal(r.status, 200, `${method} ${path}`);
    }
  });

  test('PATCH returns schedule as CSV, not the array the form sent', async () => {
    // Regression: the client Object.assigns this straight onto the habit and
    // schedOf() splits on commas, so an array here silently breaks the calendar.
    const r = await demoApi('/api/habits/1', { method: 'PATCH', body: { name: 'x', schedule: [1, 3, 5] } }, seed);
    assert.equal(r.data.schedule, '1,3,5');
    const merged = { ...seed[0], ...r.data };
    assert.deepEqual([...schedOf(merged)].sort((a, b) => a - b), [1, 3, 5]);
  });

  test('PATCH leaves a body without a schedule alone', async () => {
    const r = await demoApi('/api/habits/1', { method: 'PATCH', body: { name: 'renamed' } }, seed);
    assert.deepEqual(r.data, { name: 'renamed' });
  });

  test('POST mints an id above every existing one', async () => {
    const r = await demoApi('/api/habits', { method: 'POST', body: { name: 'New' } }, seed);
    assert.equal(r.status, 201);
    assert.equal(r.data.id, Math.max(...seed.map((h) => h.id)) + 1);
  });

  test('POST works against an empty list', async () => {
    const r = await demoApi('/api/habits', { method: 'POST', body: { name: 'First' } }, []);
    assert.equal(r.data.id, 1, 'must not be -Infinity or NaN');
  });

  test('POST trims the name and caps the emoji', async () => {
    const r = await demoApi('/api/habits', { method: 'POST', body: { name: '  Floss  ', emoji: 'x'.repeat(40) } }, seed);
    assert.equal(r.data.name, 'Floss');
    assert.equal(r.data.emoji.length, 16);
  });

  test('POST defaults a missing emoji and colour', async () => {
    const r = await demoApi('/api/habits', { method: 'POST', body: { name: 'n' } }, seed);
    assert.equal(r.data.emoji, '✅');
    assert.equal(r.data.color, 'emerald');
  });

  test('an unknown path still resolves rather than throwing', async () => {
    const r = await demoApi('/api/something-new', { method: 'POST', body: {} }, seed);
    assert.equal(r.ok, true);
  });
});

describe('demoApi create matches the server rules', () => {
  const seed = demoSeed();

  // Derive what POST /api/habits would produce, straight from the shared helpers,
  // and require the sandbox to agree. This is what catches drift.
  const expected = (body) => {
    const kind = body.kind === 'streak' ? 'streak' : 'normal';
    const sched = normalizeSchedule(body.schedule, kind);
    const start = resolveStartDate(body.startDate, TODAY);
    return {
      schedule: sched.join(','),
      kind,
      start_date: start,
      days: kind === 'normal' && start ? scheduledDays(start, TODAY, sched) : [],
    };
  };

  const CASES = [
    ['plain daily habit', { name: 'a' }],
    ['custom weekdays', { name: 'a', schedule: [1, 3, 5] }],
    ['junk weekdays', { name: 'a', schedule: [9, -3, 2, 2] }],
    ['empty schedule', { name: 'a', schedule: [] }],
    ['backdated normal habit', { name: 'a', startDate: addDays(TODAY, -9) }],
    ['backdated + custom weekdays', { name: 'a', schedule: [1, 5], startDate: addDays(TODAY, -30) }],
    ['quit', { name: 'a', kind: 'streak' }],
    ['quit ignores its schedule', { name: 'a', kind: 'streak', schedule: [2, 4] }],
    ['quit with a backdated start', { name: 'a', kind: 'streak', startDate: addDays(TODAY, -20) }],
    ['start date in the future', { name: 'a', startDate: addDays(TODAY, 5) }],
    ['start date beyond the cap', { name: 'a', startDate: addDays(TODAY, -2000) }],
    ['malformed start date', { name: 'a', startDate: 'nope' }],
  ];

  for (const [label, body] of CASES) {
    test(label, async () => {
      const got = (await demoApi('/api/habits', { method: 'POST', body }, seed)).data;
      const want = expected(body);
      assert.equal(got.schedule, want.schedule, 'schedule');
      assert.equal(got.kind, want.kind, 'kind');
      assert.equal(got.start_date, want.start_date, 'start_date');
      assert.deepEqual(got.days, want.days, 'backfilled days');
    });
  }

  test('a quit is never backfilled, because no rows means clean', async () => {
    const r = await demoApi('/api/habits', { method: 'POST', body: { name: 'q', kind: 'streak', startDate: addDays(TODAY, -30) } }, seed);
    assert.deepEqual(r.data.days, []);
    assert.equal(stats(r.data).current, 31, 'the streak accrues from the start date');
  });

  test('a backdated normal habit carries its existing streak over', async () => {
    const r = await demoApi('/api/habits', { method: 'POST', body: { name: 'h', startDate: addDays(TODAY, -14) } }, seed);
    assert.equal(r.data.days.length, 15);
    assert.equal(stats(r.data).current, 15);
  });
});
