import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, dailyProgress, newId, parseBackup, savePlan, starterData, slipSize, timerBaseSeconds, writeLog, type Habit } from '../src/model.ts';
import { timerReading } from '../src/timer-reading.ts';
import { dailyTurtleReaction, eveningSummary, sparkyTarget } from '../src/budget-coach.ts';
import { reaches } from '../src/planning.ts';

const reading = { minimum: 5, target: 20, stretch: 40 };

test('the timer counts down to the target, then up past it to the stretch', () => {
  assert.deepEqual(timerReading(0, reading), { phase: 'down', display: '20:00', detail: 'to your 20 min target' });
  assert.equal(timerReading(5 * 60 + 30, reading).display, '14:30');
  assert.deepEqual(timerReading(20 * 60, reading), { phase: 'target', display: '+0:00', detail: 'Target done · stretch in 20 min' });
  assert.equal(timerReading(25 * 60, reading).display, '+5:00');
  assert.deepEqual(timerReading(60 * 60, reading), { phase: 'stretch', display: '+40:00', detail: 'Stretch reached · 60 min total' });
  assert.equal(timerReading(65, undefined).display, '1:05', 'habits without a target just count up');
});

test('minutes already logged today shorten the countdown', () => {
  const today = '2026-11-21';
  let data = starterData(calendarDate(today));
  data = writeLog(data, 'read', today, { status: 'done', value: 8 });
  const base = timerBaseSeconds(data, 'read', today);
  assert.equal(base, 8 * 60);
  assert.equal(timerReading(0, reading, base).display, '12:00');
});

test('avoid habits: avoided, a little (counts as minimum), a normal amount or a lot (a miss)', () => {
  const today = '2026-11-21';
  const start = starterData(calendarDate(today));
  const sweets: Habit = { ...start.habits[0], id: newId(), title: 'Eating sweets', trackingType: 'avoid', unit: '', thresholds: undefined, days: [0, 1, 2, 3, 4, 5, 6], sortOrder: 99 };
  const base = savePlan(start, sweets, today);
  const pose = (slip?: 'little' | 'normal' | 'lot') => {
    const data = slip ? writeLog(base, sweets.id, today, { status: 'slipped', value: 0, slip }) : writeLog(base, sweets.id, today, { status: 'done', value: 1 });
    const log = data.logs.find((entry) => entry.habitId === sweets.id)!;
    return { log, data, minimum: reaches(sweets, log, true), target: reaches(sweets, log, false) };
  };
  assert.deepEqual([pose().minimum, pose().target], [true, true]);
  assert.deepEqual([pose('little').minimum, pose('little').target], [true, false]);
  assert.deepEqual([pose('normal').minimum, pose('lot').minimum], [false, false]);
  assert.equal(dailyProgress([sweets], new Map([[sweets.id, pose('little').log]])).minimum, 1);
  const done = (slip?: 'little' | 'normal' | 'lot') => dailyTurtleReaction(pose(slip).data, today, false, false, false).done;
  assert.equal(done('little'), done(), 'Sparky counts a small slip like a minimum');
  assert.equal(done('lot'), done() - 1);
  assert.ok(parseBackup(pose('lot').data));
  assert.throws(() => writeLog(base, 'read', today, { status: 'skipped', value: 0, slip: 'little' }));
});

test('avoid habits can run on days per week and count how many when you slip', () => {
  const today = '2026-11-21';
  const start = starterData(calendarDate(today));
  const alcohol: Habit = { ...start.habits[0], id: newId(), title: 'Drinking alcohol', trackingType: 'avoid', unit: '', thresholds: undefined,
    days: [0, 1, 2, 3, 4, 5, 6], weeklyTarget: 5, slipCount: { unit: 'beers', little: 1, lot: 4 }, sortOrder: 99 };
  const data = savePlan(start, alcohol, today);
  assert.ok(parseBackup(data), 'a weekly avoid habit with a count is valid');
  assert.deepEqual([1, 2, 3, 4, 10].map((beers) => slipSize(alcohol, beers)), ['little', 'normal', 'normal', 'lot', 'lot']);
  const logged = writeLog(data, alcohol.id, today, { status: 'slipped', value: 10, slip: slipSize(alcohol, 10) });
  const log = logged.logs.find((entry) => entry.habitId === alcohol.id)!;
  assert.equal(log.value, 10);
  assert.equal(log.slip, 'lot');
  assert.ok(parseBackup(logged));
  assert.throws(() => parseBackup(savePlan(start, { ...start.habits[0], slipCount: { unit: 'x', little: 1, lot: 4 } }, today)), 'only avoid habits count slips');
});

test('a real slip settles the habit: still a miss, but Sparky stops asking to finish it', () => {
  const today = '2026-11-21';
  const start = { ...starterData(calendarDate(today)), smallWins: { items: [], log: [] } };
  const sweets: Habit = { ...start.habits[0], id: newId(), title: 'Eating sweets', trackingType: 'avoid', unit: '', thresholds: undefined, days: [0, 1, 2, 3, 4, 5, 6], sortOrder: 99 };
  let data = savePlan(start, sweets, today);
  for (const habit of data.habits.filter(({ id, days }) => id !== sweets.id && days.includes(calendarDate(today).getDay()))) {
    data = writeLog(data, habit.id, today, { status: 'done', value: habit.thresholds?.target ?? 1 });
  }
  data = writeLog(data, sweets.id, today, { status: 'slipped', value: 0, slip: 'normal' });
  const day = dailyTurtleReaction(data, today, false, false, false);
  assert.equal(day.missed.length, 0, 'nothing is still open');
  assert.equal(day.slipped.map(({ title }) => title).join(), 'Eating sweets');
  assert.equal(day.done, day.total - 1, 'the slip still counts as a miss');
  assert.match(sparkyTarget(data, today), /^Nothing left to do today\. Eating sweets slipped/);
  assert.deepEqual(eveningSummary(data, today).missed, [], 'the evening notification does not list it as open');
  assert.equal(eveningSummary(data, today).open, 0, 'the widget shows nothing left to go');
});
