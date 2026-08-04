// Tests for the pure logic in src/lib/compute.js: date arithmetic, the habit
// creation rules, and the stats/streak maths.
//
// Everything is built relative to the module's own TODAY, so these are
// deterministic on any day and in any timezone.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TODAY, DAILY, iso, pad2, addDays, dow, schedOf,
  normalizeSchedule, resolveStartDate, scheduledDays,
  activeFromOf, isStreak, startOf, stats, streakStats,
  buildExportRecords, toCSV,
  escapeHtml, timeAgo,
} from '../src/lib/compute.js';

// A normal habit due every day unless `schedule` says otherwise.
const habit = (over = {}) => ({
  id: 1, name: 'h', emoji: '✅', color: 'emerald',
  schedule: DAILY.join(','), kind: 'normal',
  start_date: null, created_at: addDays(TODAY, -60) + 'T00:00:00.000Z',
  days: [],
  ...over,
});
const back = (...ns) => ns.map((n) => addDays(TODAY, -n));

describe('date helpers', () => {
  test('iso() uses local time, not UTC', () => {
    // The whole reason iso() exists: toISOString() shifts the date for anyone
    // behind UTC, silently marking check-ins on the wrong day.
    const d = new Date(2026, 0, 1, 2, 30);
    assert.equal(iso(d), '2026-01-01');
  });

  test('addDays round-trips and crosses month and year boundaries', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays(addDays(TODAY, -37), 37), TODAY);
  });

  test('addDays handles a leap day', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  });

  test('dow is 0=Sunday', () => {
    assert.equal(dow('2026-08-02'), 0); // a Sunday
    assert.equal(dow('2026-08-03'), 1);
    assert.equal(dow('2026-08-08'), 6);
  });

  test('pad2', () => {
    assert.equal(pad2(1), '01');
    assert.equal(pad2(12), '12');
  });

  test('schedOf parses CSV and defaults to daily when absent', () => {
    assert.deepEqual([...schedOf({ schedule: '1,3,5' })].sort(), [1, 3, 5]);
    assert.deepEqual([...schedOf({}).values()].sort((a, b) => a - b), DAILY);
  });
});

describe('normalizeSchedule', () => {
  test('dedupes, sorts and drops out-of-range weekdays', () => {
    assert.deepEqual(normalizeSchedule([5, 1, 1, 9, -2, 3], 'normal'), [1, 3, 5]);
  });

  test('falls back to daily when nothing valid survives', () => {
    assert.deepEqual(normalizeSchedule([], 'normal'), DAILY);
    assert.deepEqual(normalizeSchedule([42], 'normal'), DAILY);
    assert.deepEqual(normalizeSchedule(undefined, 'normal'), DAILY);
    assert.deepEqual(normalizeSchedule('1,2', 'normal'), DAILY); // not an array
  });

  test('a streak is always daily, whatever was requested', () => {
    // "Not scheduled today" is meaningless when you are abstaining.
    assert.deepEqual(normalizeSchedule([1, 3], 'streak'), DAILY);
  });

  test('returns a fresh array, so callers cannot mutate DAILY', () => {
    const a = normalizeSchedule([], 'normal');
    a.push(99);
    assert.deepEqual(normalizeSchedule([], 'normal'), DAILY);
  });
});

describe('resolveStartDate', () => {
  test('keeps a valid backdated day', () => {
    const d = addDays(TODAY, -10);
    assert.equal(resolveStartDate(d, TODAY), d);
    assert.equal(resolveStartDate(TODAY, TODAY), TODAY);
  });

  test('rejects the future', () => {
    assert.equal(resolveStartDate(addDays(TODAY, 1), TODAY), null);
  });

  test('rejects more than ~3 years back, so a typo cannot backfill forever', () => {
    // The cap is 366*3 = 1098 days; pin both sides of the boundary.
    assert.notEqual(resolveStartDate(addDays(TODAY, -1098), TODAY), null);
    assert.equal(resolveStartDate(addDays(TODAY, -1099), TODAY), null);
    assert.equal(resolveStartDate(addDays(TODAY, -5000), TODAY), null);
  });

  test('rejects junk and empty input', () => {
    for (const v of ['', null, undefined, 'yesterday', '2026-1-1', '01-01-2026', {}]) {
      assert.equal(resolveStartDate(v, TODAY), null, `should reject ${JSON.stringify(v)}`);
    }
  });

  test('trims surrounding whitespace', () => {
    const d = addDays(TODAY, -5);
    assert.equal(resolveStartDate(`  ${d}  `, TODAY), d);
  });
});

describe('scheduledDays', () => {
  test('includes both bounds and only scheduled weekdays', () => {
    const days = scheduledDays('2026-08-03', '2026-08-09', [1, 3]); // Mon + Wed
    assert.deepEqual(days, ['2026-08-03', '2026-08-05']);
  });

  test('a daily schedule yields every day inclusive', () => {
    assert.equal(scheduledDays(addDays(TODAY, -6), TODAY, DAILY).length, 7);
  });

  test('accepts a Set as well as an array', () => {
    assert.deepEqual(
      scheduledDays('2026-08-03', '2026-08-04', new Set([1])),
      ['2026-08-03'],
    );
  });

  test('an inverted range is empty, not infinite', () => {
    assert.deepEqual(scheduledDays(TODAY, addDays(TODAY, -1), DAILY), []);
  });
});

describe('stats() for a normal habit', () => {
  test('counts a consecutive run ending today', () => {
    const s = stats(habit({ days: back(0, 1, 2, 3) }));
    assert.equal(s.current, 4);
    assert.equal(s.total, 4);
  });

  test('today not done yet is graced, not a break', () => {
    // The day is not over, so the streak still stands at yesterday's count.
    const s = stats(habit({ days: back(1, 2, 3) }));
    assert.equal(s.current, 3);
  });

  test('a missed day before today breaks the streak', () => {
    const s = stats(habit({ days: back(0, 1, 3, 4) })); // 2 days ago missed
    assert.equal(s.current, 2);
  });

  test('rest days do not break a streak and are not counted', () => {
    // Scheduled Mon-Fri only. Build a run over scheduled days, leaving the
    // unscheduled ones empty, and the streak should span the gap.
    // Fill past the 30-day rate window so rate30 is a clean 100.
    const h = habit({ schedule: '1,2,3,4,5' });
    h.days = scheduledDays(addDays(TODAY, -40), TODAY, schedOf(h));
    const s = stats(h);
    assert.equal(s.current, h.days.length);
    assert.equal(s.rate30, 100);
  });

  test('longest survives after the current streak is broken', () => {
    const h = habit({ days: [...back(10, 9, 8, 7, 6), ...back(1, 0)] });
    const s = stats(h);
    assert.equal(s.current, 2);
    assert.equal(s.longest, 5);
  });

  test('rate30 is a percentage of scheduled days in the window', () => {
    assert.equal(stats(habit({ days: back(...Array.from({ length: 30 }, (_, i) => i)) })).rate30, 100);
    assert.equal(stats(habit({ days: [] })).rate30, 0);
    assert.equal(stats(habit({ days: back(...Array.from({ length: 15 }, (_, i) => i)) })).rate30, 50);
  });

  test('an empty habit is all zeroes, not NaN', () => {
    const s = stats(habit());
    assert.deepEqual(s, { current: 0, longest: 0, total: 0, rate30: 0 });
  });
});

describe('streakStats() for a quit habit', () => {
  const quit = (over = {}) => habit({ kind: 'streak', start_date: addDays(TODAY, -10), ...over });

  test('accrues with no interaction at all', () => {
    // The point of the kind: quitting needs zero taps on a good day.
    const s = stats(quit({ days: [] }));
    assert.equal(s.current, 11); // start..today inclusive
    assert.equal(s.slips, 0);
    assert.equal(s.total, 11);
  });

  test('a slip breaks the current streak', () => {
    const s = stats(quit({ days: back(3) }));
    assert.equal(s.current, 3); // the 3 clean days since
    assert.equal(s.slips, 1);
    assert.equal(s.total, 10); // clean days only
  });

  test("today's slip is graced, mirroring how habits treat today", () => {
    const s = stats(quit({ days: [TODAY] }));
    assert.equal(s.current, 10, 'a slip today should not zero the streak');
    assert.equal(s.slips, 1);
  });

  test('longest is the best clean run, not the current one', () => {
    const s = stats(quit({ start_date: addDays(TODAY, -20), days: back(1) }));
    assert.equal(s.current, 1);
    assert.equal(s.longest, 19);
  });
});

describe('the normal/streak inversion invariant', () => {
  // A checkins row means DONE for a normal habit and SLIPPED for a quit. Getting
  // this backwards inverts every number silently, so pin it: the same `days`
  // array must produce opposite readings.
  const days = back(0, 1, 2);

  test('the same days array reads as done vs slipped', () => {
    const asHabit = stats(habit({ days }));
    const asQuit = stats(habit({ kind: 'streak', start_date: addDays(TODAY, -5), days }));

    assert.equal(asHabit.total, 3, 'normal: 3 days done');
    assert.equal(asQuit.slips, 3, 'streak: the very same 3 days are slips');
    assert.equal(asHabit.current, 3, 'normal: a 3-day streak');
    assert.equal(asQuit.current, 0, 'streak: slipped yesterday, so no clean run');
  });

  test('an empty days array is a zero habit but a full quit streak', () => {
    assert.equal(stats(habit({ days: [] })).current, 0);
    assert.equal(stats(habit({ kind: 'streak', start_date: addDays(TODAY, -7), days: [] })).current, 8);
  });

  test('isStreak only trusts the kind field', () => {
    assert.equal(isStreak({ kind: 'streak' }), true);
    assert.equal(isStreak({ kind: 'normal' }), false);
    assert.equal(isStreak({}), false);
  });
});

describe('startOf / activeFromOf', () => {
  test('startOf prefers start_date over the created day', () => {
    const s = addDays(TODAY, -30);
    assert.equal(startOf(habit({ start_date: s })), s);
  });

  test('startOf falls back to the created day', () => {
    assert.equal(startOf(habit({ created_at: '2026-05-04T12:00:00.000Z' })), '2026-05-04');
  });

  test('activeFromOf takes the earlier of created and first check-in', () => {
    // Backfilled check-ins prove tracking predates the row.
    assert.equal(
      activeFromOf({ created_at: '2026-06-01T00:00:00Z', days: ['2026-05-20', '2026-06-02'] }),
      '2026-05-20',
    );
    assert.equal(activeFromOf({ created_at: '2026-06-01T00:00:00Z', days: [] }), '2026-06-01');
  });
});

describe('buildExportRecords', () => {
  // The export is the one place the inversion escapes the app, so it gets the
  // same treatment as stats(): the same `days` array must read opposite ways.
  const days = back(3);
  const row = (recs, name, d) => recs.find((r) => r.habit_name === name && r.date === d);

  test('a checkin exports as done for a habit and slipped for a quit', () => {
    const recs = buildExportRecords([
      habit({ id: 1, name: 'run', days }),
      habit({ id: 2, name: 'sugar', kind: 'streak', start_date: addDays(TODAY, -10), days }),
    ]);
    assert.equal(row(recs, 'run', days[0]).status, 'done');
    assert.equal(row(recs, 'sugar', days[0]).status, 'slipped');
  });

  test('a quit day with no checkin is clean, not missed', () => {
    const recs = buildExportRecords([
      habit({ name: 'sugar', kind: 'streak', start_date: addDays(TODAY, -10), days }),
    ]);
    const statuses = new Set(recs.map((r) => r.status));
    assert.deepEqual([...statuses].sort(), ['clean', 'slipped']);
    assert.equal(recs.filter((r) => r.status === 'clean').length, 10, '11 days tracked, 1 slipped');
  });

  test("a quit's backdated start_date is exported, not truncated to the created day", () => {
    // A streak backfills no check-ins, so start_date is the only record that
    // tracking began earlier. Deriving the range from created_at alone dropped
    // every clean day before it.
    const recs = buildExportRecords([
      habit({
        name: 'sugar', kind: 'streak', days: [],
        start_date: addDays(TODAY, -10), created_at: addDays(TODAY, -5) + 'T00:00:00.000Z',
      }),
    ]);
    assert.equal(recs[0].date, addDays(TODAY, -10));
    assert.equal(recs.length, 11);
  });

  test('a quit has no rest days even if its schedule says otherwise', () => {
    const recs = buildExportRecords([
      habit({ name: 'sugar', kind: 'streak', schedule: '1', start_date: addDays(TODAY, -6), days: [] }),
    ]);
    assert.equal(recs.every((r) => r.scheduled === true), true);
    assert.equal(recs.every((r) => r.status === 'clean'), true);
  });

  test('a rest day for a normal habit is not_scheduled, not missed', () => {
    const mondayOnly = buildExportRecords([habit({ name: 'gym', schedule: '1', days })]);
    for (const r of mondayOnly) {
      assert.equal(r.status, r.day_of_week === 'Mon' || r.date === days[0] ? r.status : 'not_scheduled');
    }
  });

  test('the CSV carries habit_kind so a reader can tell the vocabularies apart', () => {
    const csv = toCSV(buildExportRecords([
      habit({ name: 'run', days }),
      habit({ name: 'sugar', kind: 'streak', start_date: addDays(TODAY, -10), days }),
    ]));
    const [header, ...lines] = csv.split('\n');
    assert.match(header, /^date,day_of_week,habit_name,habit_kind,habit_created_date,scheduled,status$/);
    assert.ok(lines.some((l) => l.includes(',run,normal,')));
    assert.ok(lines.some((l) => l.includes(',sugar,streak,')));
  });
});

describe('escapeHtml', () => {
  test('neutralises the characters that break out of markup', () => {
    assert.equal(
      escapeHtml('<img src=x onerror="alert(1)">'),
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
    assert.equal(escapeHtml("it's & so"), 'it&#39;s &amp; so');
  });

  test('leaves emoji intact', () => {
    assert.equal(escapeHtml('🏃'), '🏃');
  });
});

describe('timeAgo', () => {
  test('describes recent and missing timestamps', () => {
    assert.equal(timeAgo(null), 'never');
    assert.equal(timeAgo('not a date'), 'never');
    assert.equal(timeAgo(new Date().toISOString()), 'just now');
    assert.equal(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString()), '5m ago');
  });
});
