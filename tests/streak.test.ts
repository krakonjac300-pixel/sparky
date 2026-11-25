import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, parseBackup, setScoringPaused, shiftDate, starterData, writeLog, type AppData } from '../src/model.ts';
import { streakInfo } from '../src/streak.ts';

import { sparkyHistory, eveningSummary } from '../src/budget-coach.ts';
import { makeReport } from '../src/reports.ts';

const today = '2026-11-21';

function plan(): AppData {
  const start = starterData(calendarDate(shiftDate(today, -40)));
  const template = start.habits.find(({ id }) => id === 'gratitude')!;
  const habits = Array.from({ length: 10 }, (_, index) => ({ ...template, id: `habit-${index}`, sortOrder: index }));
  return { ...start, habits, plans: habits.map((habit) => ({ date: start.planStart, habit })), smallWins: { items: [], log: [] } };
}

function finish(data: AppData, date: string, count: number) {
  return Array.from({ length: count }, (_, index) => index).reduce((current, index) =>
    writeLog(current, `habit-${index}`, date, { status: 'done', value: 1 }), data);
}

test('consecutive days at 70% or more build the streak; today only adds once it counts', () => {
  let data = plan();
  for (let back = 1; back <= 5; back++) data = finish(data, shiftDate(today, -back), back % 2 ? 7 : 10);
  let info = streakInfo(data, today);
  assert.equal(info.streak, 5);
  assert.equal(info.todayCounts, false);
  assert.equal(info.week.at(-1)?.state, 'pending', 'an unfinished today never breaks the streak');
  data = finish(data, today, 7);
  info = streakInfo(data, today);
  assert.equal(info.streak, 6);
  assert.equal(info.todayCounts, true);
  assert.equal(info.nextMilestone, 7);
});

test('a missed day resets the streak unless a freeze from a full week covers it', () => {
  let data = plan();
  // 7 good days, a miss, then 2 good days: the freeze saves it.
  for (let back = 10; back >= 1; back--) if (back !== 3) data = finish(data, shiftDate(today, -back), 10);
  let info = streakInfo(data, today);
  assert.equal(info.week.find(({ date }) => date === shiftDate(today, -3))?.state, 'frozen');
  assert.equal(info.streak, 9);
  assert.equal(info.freezes, 0);
  // Without a full week before it, the same miss resets.
  data = plan();
  for (const back of [5, 4, 2, 1]) data = finish(data, shiftDate(today, -back), 10);
  info = streakInfo(data, today);
  assert.equal(info.streak, 2);
  assert.equal(info.best, 2);
  assert.equal(info.week.find(({ date }) => date === shiftDate(today, -3))?.state, 'missed');
});

test('a new plan starts at zero and days before it are ignored', () => {
  const info = streakInfo(starterData(calendarDate(today)), today);
  assert.equal(info.streak, 0);
  assert.equal(info.best, 0);
  assert.equal(info.week.filter(({ state }) => state === 'none').length, 6);
});

test('100000 counted days survive replay with a bounded visible history and lifetime best', () => {
  const start = '1800-01-01';
  const data = starterData(calendarDate(start));
  const habit = data.habits.find(({ id }) => id === 'gratitude')!;
  const [entry] = writeLog(data, habit.id, start, { status: 'done', value: 1 }).logs;
  const logs = Array.from({ length: 100000 }, (_, i) => {
    const date = shiftDate(start, i);
    return { ...entry, id: habit.id + ':' + date, date };
  });
  const history = { ...data, habits: [habit], plans: [{ date: start, habit }], smallWins: { items: [], log: [] }, logs };
  const end = logs.at(-1)!.date;
  const info = streakInfo(history, end);
  assert.deepEqual([info.streak, info.best, info.freezes, info.week.length], [100000, 100000, 2, 7]);
  const later = streakInfo(history, shiftDate(end, 4));
  assert.deepEqual([later.streak, later.best, later.freezes], [0, 100000, 0]);
});

test('a weekly goal needs a completion on the day that earns a flame', () => {
  const monday = '2026-11-16';
  const base = plan();
  const habit = { ...base.habits[0], weeklyTarget: 1 };
  let data: AppData = { ...base, habits: [habit], plans: [{ date: monday, habit }] };
  const sunday = shiftDate(monday, 6);
  assert.equal(streakInfo(data, sunday).streak, 0);
  data = writeLog(data, habit.id, monday, { status: 'done', value: 1 });
  assert.deepEqual(streakInfo(data, sunday).week.map((day) => day.state),
    ['done', 'rest', 'rest', 'rest', 'rest', 'rest', 'pending']);
});

test('pause and resume preserve freezes, survive restore, and apply to the full calendar day', () => {
  let data = plan();
  for (let back = 10; back >= 4; back--) data = finish(data, shiftDate(today, -back), 10);
  const pause = shiftDate(today, -3);
  data = setScoringPaused(data, pause, true);
  data = parseBackup(finish(data, pause, 10));
  const current = streakInfo(data, today);
  assert.deepEqual([current.streak, current.freezes, current.paused], [7, 1, true]);
  assert.ok(current.week.slice(-4).every((day) => day.state === 'paused'));
  assert.equal(sparkyHistory(data, today).at(-1)?.pose, undefined);
  const summary = eveningSummary(data, today);
  assert.deepEqual([summary.pose, summary.streakPaused], ['ready', true]);
  assert.equal(makeReport(data, today, 11).streak, 7);
  data = setScoringPaused(data, today, false);
  assert.equal(streakInfo(finish(data, today, 10), today).streak, 8);
  assert.equal(streakInfo(data, shiftDate(today, 1)).freezes, 0);
  const toggled = setScoringPaused(setScoringPaused(data, today, true), today, false);
  assert.deepEqual(toggled.streakPauses, data.streakPauses);
  assert.throws(() => parseBackup({ ...data, streakPauses: [{ from: pause }, { from: today }] }));
});
