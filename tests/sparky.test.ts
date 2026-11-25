import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, parseBackup, shiftDate, starterData, writeLog, type AppData } from '../src/model.ts';
import { dailyTurtleReaction, eveningSummary, sparkyHistory, sparkyTarget } from '../src/budget-coach.ts';

function tenHabits(date: string): AppData {
  const start = starterData(calendarDate(shiftDate(date, -20)));
  const template = start.habits.find(({ id }) => id === 'gratitude')!;
  const habits = Array.from({ length: 10 }, (_, index) => ({ ...template, id: `habit-${index}`, sortOrder: index }));
  return { ...start, habits, plans: habits.map((habit) => ({ date: start.planStart, habit })) };
}

function complete(data: AppData, date: string, count: number) {
  return Array.from({ length: count }, (_, index) => index)
    .reduce((current, index) => writeLog(current, `habit-${index}`, date, { status: 'done', value: 1 }), data);
}

test('the live target says how many habits Sparky still needs', () => {
  const today = '2026-11-19';
  const data = tenHabits(today);
  assert.equal(sparkyTarget(data, today), '7 more habits for a so-so Sparky, 10 to make him proud.');
  assert.equal(sparkyTarget(complete(data, today, 7), today), '3 more habits to make Sparky proud tonight.');
  assert.equal(sparkyTarget(complete(data, today, 9), today), '1 more habit to make Sparky proud tonight.');
  assert.equal(sparkyTarget(complete(data, today, 10), today), 'All habits done. Sparky is proud of you.');
});

test('historical verdicts follow corrected logs after restoring an old snapshot', () => {
  const today = '2026-11-19';
  const date = shiftDate(today, -5);
  const data = parseBackup({ ...tenHabits(today), sparkyDays: [{ date, pose: 'proud', done: 10, total: 10 }] });
  const pose = (record: AppData) => sparkyHistory(record, today).find((day) => day.date === date)?.pose;
  assert.equal(pose(data), 'disappointed');
  const corrected = complete(data, date, 7);
  assert.equal(pose(corrected), 'so-so');
  assert.equal(pose(writeLog(corrected, 'habit-0', date)), 'disappointed');
});

test('the evening summary carries what Android needs for the notification', () => {
  const today = '2026-11-19';
  const summary = eveningSummary(complete(tenHabits(today), today, 8), today);
  assert.equal(summary.done, 8);
  assert.equal(summary.total, 10);
  assert.equal(summary.pose, 'so-so');
  assert.equal(summary.hour, 21);
  assert.equal(summary.missed.length, 2);
});

test('the thumbs-up from yesterday only lasts until noon', () => {
  const today = '2026-11-20';
  const data = complete(tenHabits(today), shiftDate(today, -1), 10);
  assert.equal(dailyTurtleReaction(data, today, false, false, true).pose, 'proud');
  assert.equal(dailyTurtleReaction(data, today, false, false, true).date, shiftDate(today, -1));
  const afternoon = dailyTurtleReaction(data, today, false, false, false);
  assert.equal(afternoon.date, today);
  assert.equal(afternoon.pose, 'ready');
  assert.equal(dailyTurtleReaction(complete(data, today, 10), today, false, false, false).pose, 'proud');
});

test('Sparky credits flexible goals and keeps their totals separate from today', () => {
  const monday = '2026-11-16';
  const sunday = shiftDate(monday, 6);
  const base = tenHabits(monday);
  const habits = base.habits.slice(0, 2).map((habit, index) => ({
    ...habit, weeklyTarget: index ? 4 : 3,
    ...(index ? { title: 'Avoid sweets', trackingType: 'avoid' as const, unit: '', thresholds: undefined } : {}),
  }));
  let data = { ...base, habits, smallWins: { items: [], log: [] }, plans: habits.map(habit => ({ date: monday, habit })) };
  for (let day = 0; day < 5; day++) data = writeLog(data, habits[0].id, shiftDate(monday, day), { status: 'done', value: 1 });
  data = writeLog(data, habits[1].id, monday, { status: 'done', value: 1 });
  data = writeLog(data, habits[1].id, shiftDate(monday, 1), { status: 'slipped', value: 0, slip: 'little' });
  const midweek = dailyTurtleReaction(data, shiftDate(monday, 2), false, true);
  assert.deepEqual(midweek.todayWeekly.map(({ count }) => count), [3, 1]);
  assert.equal(midweek.pose, 'proud');
  const end = dailyTurtleReaction(data, sunday, false, true);
  assert.deepEqual(end.todayWeekly.map(({ count, target }) => [count, target]), [[5, 3], [1, 4]]);
  assert.deepEqual([end.done, end.total, end.pose], [0, 0, 'so-so']);
});

test('Sparky holds people accountable from the first evening: nothing done means disappointed', () => {
  // Owner decision (Nov 24): accountability starts on day one, even for someone who installed that evening.
  const first = '2026-11-24';
  const data = starterData(calendarDate(first));
  assert.equal(dailyTurtleReaction(data, first, false, true, false).pose, 'disappointed');
  assert.equal(eveningSummary(data, first).pose, 'disappointed');
});

test('day one keeps its normal verdict once something has been logged', () => {
  const first = '2026-11-24';
  const start = starterData(calendarDate(first));
  const one = writeLog(start, 'gratitude', first, { status: 'done', value: 1 });
  assert.equal(dailyTurtleReaction(one, first, false, true, false).pose, 'disappointed');
});

test('the card states tonight\'s bar: 70% keeps Sparky from disappointed, all done makes him proud', async () => {
  const { sparkyBar } = await import('../src/budget-coach.ts');
  assert.equal(sparkyBar(0, 7, 21), "Sparky's bar tonight: 5 of 7 by 21:00");
  assert.equal(sparkyBar(4, 7, 22), "Sparky's bar tonight: 5 of 7 by 22:00");
  assert.equal(sparkyBar(5, 7, 21), 'Bar met. All 7 by 21:00 makes him proud.');
  assert.equal(sparkyBar(0, 3, 21), "Sparky's bar tonight: 3 of 3 by 21:00");
  assert.equal(sparkyBar(7, 7, 21), undefined);
  assert.equal(sparkyBar(0, 0, 21), undefined);
});
