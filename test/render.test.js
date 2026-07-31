// Tests for src/lib/render.js, the markup shared by SSR and the client.
//
// The point of the module is that both sides emit the same string, so these lock
// down the parts that differ by context: read-only vs writable, the backfill window,
// rest days, and the streak inversion.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekHeaderHtml, weekCellsHtml, collapsedCardHtml, habitListHtml,
  nameBtnHtml, todayCardData, tabButtonClass, todayInZone, backfillStart,
} from '../src/lib/render.js';
import { TODAY, DAILY, addDays, BACKFILL_DAYS } from '../src/lib/compute.js';

const habit = (over = {}) => ({
  id: 1, name: 'Run', emoji: '🏃', color: 'emerald',
  schedule: DAILY.join(','), kind: 'normal',
  start_date: null, created_at: addDays(TODAY, -60) + 'T00:00:00.000Z',
  days: [],
  ...over,
});
const ctx = (over = {}) => ({ today: TODAY, readOnly: false, ...over });
const back = (...ns) => ns.map((n) => addDays(TODAY, -n));

describe('todayInZone', () => {
  test('returns a YYYY-MM-DD date for a real zone', () => {
    assert.match(todayInZone('Asia/Kolkata'), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns null for a bad or missing zone so the caller can fall back', () => {
    assert.equal(todayInZone('Not/AZone'), null);
    assert.equal(todayInZone(undefined), null);
  });

  test('zones on opposite sides of the date line can disagree', () => {
    // This is the whole reason the server uses the visitor's zone instead of UTC.
    const at = new Date('2026-07-31T11:30:00Z');
    assert.equal(todayInZone('Pacific/Kiritimati', at), '2026-08-01');
    assert.equal(todayInZone('Pacific/Midway', at), '2026-07-31');
  });
});

describe('backfillStart', () => {
  test('spans BACKFILL_DAYS inclusive of today', () => {
    assert.equal(backfillStart(TODAY), addDays(TODAY, -(BACKFILL_DAYS - 1)));
  });
});

describe('weekHeaderHtml', () => {
  test('renders exactly seven day labels plus the desktop spacer', () => {
    const html = weekHeaderHtml(TODAY);
    assert.equal((html.match(/flex flex-col items-center/g) || []).length, 7);
    assert.ok(html.includes('hidden sm:block'));
  });

  test('marks only today as emphasised', () => {
    const html = weekHeaderHtml(TODAY);
    assert.equal((html.match(/text-slate-900 dark:text-white/g) || []).length, 1);
  });
});

describe('weekCellsHtml, normal habit', () => {
  test('days inside the backfill window are tappable, older ones inert', () => {
    const html = weekCellsHtml(habit(), ctx());
    // 7 cells: BACKFILL_DAYS of them tappable, the rest locked.
    assert.equal((html.match(/<button data-day/g) || []).length, BACKFILL_DAYS);
    assert.equal((html.match(/<div class="flex h-9/g) || []).length, 7 - BACKFILL_DAYS);
  });

  test('read-only renders no buttons at all', () => {
    const html = weekCellsHtml(habit(), ctx({ readOnly: true }));
    assert.ok(!html.includes('<button'), 'a viewer must have nothing to tap');
    assert.equal((html.match(/<div class="flex h-9/g) || []).length, 7);
  });

  test('rest days are dots, not missed days', () => {
    // Scheduled Mondays only: 6 of the 7 cells are rest days.
    const html = weekCellsHtml(habit({ schedule: '1' }), ctx());
    assert.equal((html.match(/rest day/g) || []).length, 6);
  });

  test('a done day carries the habit colour', () => {
    const html = weekCellsHtml(habit({ days: [TODAY] }), ctx());
    assert.ok(html.includes('#10b981'), 'emerald hex inline');
    assert.ok(html.includes('· done'));
  });
});

describe('weekCellsHtml, quit habit', () => {
  const quit = (over = {}) => habit({ kind: 'streak', start_date: addDays(TODAY, -3), ...over });

  test('days before the start are untracked', () => {
    assert.equal((weekCellsHtml(quit(), ctx()).match(/before start/g) || []).length, 3);
  });

  test('clean by default, slips marked', () => {
    const html = weekCellsHtml(quit({ days: back(1) }), ctx());
    assert.equal((html.match(/· clean/g) || []).length, 3);
    assert.equal((html.match(/· slipped/g) || []).length, 1);
  });

  test('the same days array reads as done for a habit and slipped for a quit', () => {
    const days = back(1);
    assert.ok(weekCellsHtml(habit({ days }), ctx()).includes('· done'));
    assert.ok(weekCellsHtml(quit({ days }), ctx()).includes('· slipped'));
  });
});

describe('nameBtnHtml', () => {
  test('escapes the habit name and emoji', () => {
    const html = nameBtnHtml(habit({ name: '<img onerror=alert(1)>' }), { today: TODAY });
    assert.ok(!html.includes('<img'), 'must not inject markup');
    assert.ok(html.includes('&lt;img'));
  });

  test('shows a streak badge only when there is a streak', () => {
    assert.ok(!nameBtnHtml(habit(), { today: TODAY }).includes('-day streak'));
    assert.ok(nameBtnHtml(habit({ days: back(0, 1) }), { today: TODAY }).includes('2-day streak'));
  });

  test('the chevron rotates only when open', () => {
    assert.ok(nameBtnHtml(habit(), { today: TODAY, isOpen: true }).includes('rotate-180'));
    assert.ok(!nameBtnHtml(habit(), { today: TODAY }).includes('rotate-180'));
  });
});

describe('collapsedCardHtml / habitListHtml', () => {
  test('one article per habit, in order', () => {
    const hs = [habit({ id: 1, name: 'A' }), habit({ id: 2, name: 'B' })];
    const html = habitListHtml(hs, ctx());
    assert.equal((html.match(/<article/g) || []).length, 2);
    assert.ok(html.indexOf('>A<') < html.indexOf('>B<'));
  });

  test('an empty list is an empty string, not stray markup', () => {
    assert.equal(habitListHtml([], ctx()), '');
  });

  test('output is deterministic for identical input', () => {
    assert.equal(collapsedCardHtml(habit(), ctx()), collapsedCardHtml(habit(), ctx()));
  });

  test('never leaks undefined or [object Object]', () => {
    const html = habitListHtml([habit({ days: back(0, 2) })], ctx());
    assert.ok(!html.includes('undefined'));
    assert.ok(!html.includes('[object'));
  });
});

describe('todayCardData', () => {
  test('hidden when there is nothing due and no quits', () => {
    assert.equal(todayCardData([], TODAY).show, false);
    assert.equal(todayCardData([habit({ schedule: '1' })], addDays('2026-08-04', 0)).show, false);
  });

  test('counts habits still to do', () => {
    const t = todayCardData([habit({ id: 1 }), habit({ id: 2, days: [TODAY] })], TODAY);
    assert.equal(t.show, true);
    assert.equal(t.text, '1 habit to go');
  });

  test('pluralises and reports all-done', () => {
    assert.equal(todayCardData([habit({ id: 1 }), habit({ id: 2 })], TODAY).text, '2 habits to go');
    assert.equal(todayCardData([habit({ days: [TODAY] })], TODAY).text, 'All done today');
  });

  test('a slip today takes priority and reads red', () => {
    const q = habit({ kind: 'streak', start_date: addDays(TODAY, -5), days: [TODAY] });
    const t = todayCardData([q], TODAY);
    assert.equal(t.text, '1 slip today');
    assert.match(t.cls, /red/);
  });

  test('clean quits read as all clean', () => {
    const q = habit({ kind: 'streak', start_date: addDays(TODAY, -5) });
    assert.equal(todayCardData([q], TODAY).text, 'All clean · keep going');
  });

  test('draws one ring per track', () => {
    const q = habit({ id: 9, kind: 'streak', start_date: addDays(TODAY, -5) });
    assert.equal((todayCardData([habit()], TODAY).rings.match(/<svg/g) || []).length, 1);
    assert.equal((todayCardData([habit(), q], TODAY).rings.match(/<svg/g) || []).length, 2);
  });
});

describe('tabButtonClass', () => {
  test('the active tab is visually distinct', () => {
    assert.notEqual(tabButtonClass(true), tabButtonClass(false));
    assert.ok(tabButtonClass(true).includes('bg-white'));
  });
});
