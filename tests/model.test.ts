import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, dailyProgress, dueHabits, localDate, mergePhoneActivity, parseBackup, phoneActivitySchema, recentDates, savePlan, starterData, writeLog } from '../src/model.ts';
import { makeReport, phonePeriodDates } from '../src/reports.ts';
import { coachingSuggestion, dailyCoaching } from '../src/coach.ts';
import { reminderPlan, unfinishedToday } from '../src/reminders.ts';
import { applyPhoneCompletions, recoveryFor, weeklyProgress } from '../src/planning.ts';
import { appLimitForDay, checkAppLimit, countAppLimitDays, saveAppLimit } from '../src/app-limits.ts';
import { budgetCoachStatus, budgetPlan, dailyTurtleReaction, turtleHabitProgress } from '../src/budget-coach.ts';
import { freeSlot } from '../src/evening-plan.ts';
import { turtleMotion } from '../src/turtle-motion.ts';

test('daily coaching distinguishes consistent progress, misses, and planned rest', () => {
  const today = '2026-11-18';
  const start = '2026-11-11';
  let data = { ...starterData(calendarDate(start)), recoveryStart: start };
  const read = data.habits.find(({ id }) => id === 'read')!;
  data = savePlan(data, { ...read, days: [0, 1, 2, 3, 4, 5, 6] }, start) as typeof data;
  data.priorities = [{ date: today, items: [{ habitId: 'read', cue: '', minimum: false }] }];
  const missed = dailyCoaching(data, today);
  assert.equal(missed.first?.id, 'read');
  assert.equal(missed.startSmall, true);
  const consistent = ['2026-11-15', '2026-11-16', '2026-11-17'].reduce((state, date) =>
    writeLog(state, 'read', date, { status: 'done', value: read.thresholds!.target }), data as ReturnType<typeof starterData>);
  const progress = dailyCoaching(consistent, today);
  assert.equal(progress.startSmall, false);
  assert.equal(progress.week.habits.find(({ title }) => title === read.title)?.hit, 3);
  const rested = dailyCoaching(writeLog(consistent, 'read', today, { status: 'rest', value: 0 }), today);
  assert.equal(rested.rested, 1);
  assert.equal(rested.due, progress.due - 1);
  assert.notEqual(rested.first?.id, 'read');
});

test('one-date measurement habits support decimal logs and survive backup validation', () => {
  const today = '2026-11-18';
  const onceOn = '2026-11-20';
  const start = starterData(calendarDate(today));
  const read = start.habits.find(({ id }) => id === 'read')!;
  const data = savePlan(start, { ...read, onceOn, trackingType: 'measurement', unit: 'km',
    thresholds: { minimum: 0.5, target: 1.5, stretch: 2 } }, today);
  assert.equal(dueHabits(data.habits, today).some(({ id }) => id === read.id), false);
  assert.equal(dueHabits(data.habits, onceOn).some(({ id }) => id === read.id), true);
  assert.deepEqual(reminderPlan(data, today).find(({ id }) => id === read.id)?.committedDates, [onceOn]);
  assert.equal(parseBackup(writeLog(data, read.id, onceOn, { status: 'done', value: 1.5 })).logs[0].achievement, 'target');
});

test('health mapping reconciles deletions and corrections while respecting manual overrides', () => {
  const today = '2026-11-18';
  const start = starterData(calendarDate(today));
  const read = start.habits.find(({ id }) => id === 'read')!;
  const data = savePlan(start, { ...read, trackingType: 'count', unit: 'steps', healthSource: 'steps',
    thresholds: { minimum: 1000, target: 8000, stretch: 10000 } }, today);
  const snapshot = (steps?: number) => phoneActivitySchema.parse({ health: { state: 'connected' }, usage: { state: 'off' },
    steps: { from: today, through: today, updated: 1795000000000, days: steps ? [{ date: today, steps }] : [] } });
  const first = mergePhoneActivity(data, snapshot(8000));
  assert.equal(first.logs[0].achievement, 'target');
  assert.deepEqual(mergePhoneActivity(first, snapshot(8000)), first);
  assert.equal(mergePhoneActivity(first, snapshot(3000)).logs[0].value, 3000);
  assert.equal(mergePhoneActivity(first, snapshot()).logs.length, 0);
  assert.equal(mergePhoneActivity(writeLog(first, read.id, today, { status: 'done', value: 8500 }), snapshot(3000)).logs[0].value, 8500);
  assert.equal(mergePhoneActivity(writeLog(first, read.id, today), snapshot(3000)).logs.length, 0);
});

test('quiet hours suppress scheduled alarms without hiding the habits from widgets', () => {
  const today = '2026-11-18';
  const start = starterData(calendarDate(today));
  const read = start.habits.find(({ id }) => id === 'read')!;
  const data = savePlan(start, { ...read, reminderTime: '22:30', extraReminderTime: '09:00' }, today);
  const controls = { disabled: false, quietFrom: '22:00', quietThrough: '07:00' };
  const plan = reminderPlan({ ...data, reminderControls: controls }, today).find(({ id }) => id === read.id);
  assert.equal(plan?.time, undefined);
  assert.equal(plan?.extraTime, '09:00');
  assert.equal(reminderPlan({ ...data, reminderControls: { ...controls, disabled: true } }, today)
    .find(({ id }) => id === read.id)?.extraTime, undefined);
});

test('paused habits resume after their selected date and history keeps its previous schedule', () => {
  const today = '2026-11-18';
  const tomorrow = '2026-11-19';
  const start = starterData(calendarDate('2026-11-17'));
  const read = start.habits.find(({ id }) => id === 'read')!;
  const data = savePlan(start, { ...read, pauseThrough: today }, today);
  assert.equal(dueHabits(data.habits, today).some(({ id }) => id === read.id), false);
  assert.equal(dueHabits(data.habits, tomorrow).some(({ id }) => id === read.id), true);
  assert.equal(reminderPlan(data, today).find(({ id }) => id === read.id)?.since, tomorrow);
  assert.equal(makeReport(data, '2026-11-17', 1).habits.some(({ title }) => title === read.title), true);
});

test('the turtle checks the finished day against the habits scheduled at the time', () => {
  const today = '2026-11-18';
  const yesterday = '2026-11-17';
  const start = starterData(calendarDate(yesterday));
  const habit = (id: string) => start.habits.find((item) => item.id === id)!;
  assert.equal(dailyTurtleReaction(start, yesterday).yesterdayMissed, 0);
  let data = savePlan(start, { ...habit('project'), weeklyTarget: 2 }, yesterday);
  data = writeLog(data, 'read', yesterday, { status: 'done', value: 5 });
  data = writeLog(data, 'move', yesterday, { status: 'rest', value: 0 });
  data = writeLog(data, 'meditate', yesterday, { status: 'restart', value: 0 });
  data = writeLog(data, 'learn', yesterday, { status: 'skipped', value: 0 });
  data = writeLog(data, 'gratitude', yesterday, { status: 'done', value: 1 });
  data = savePlan(data, { ...habit('learn'), archivedAt: calendarDate(today).toISOString() }, today);
  assert.deepEqual(turtleHabitProgress(data, yesterday), { done: 3, total: 4 });
  assert.equal(dailyTurtleReaction(data, today).yesterdayMissed, 1);
  assert.equal(dailyTurtleReaction({ ...data, weeklySessions: [{ habitId: 'project', date: yesterday }] }, today).yesterdayMissed, 2);
});

test('turtle uses the 70 percent habit cutoff and the 10 percent app overage cutoff', () => {
  const date = '2026-11-18';
  const next = '2026-11-19';
  const start = starterData(calendarDate(date));
  const template = start.habits.find(({ id }) => id === 'gratitude')!;
  const habits = Array.from({ length: 10 }, (_, index) => ({ ...template, id: `habit-${index}`, sortOrder: index }));
  const video = { id: 'video', name: 'Video' };
  const data = saveAppLimit({ ...start, habits, plans: habits.map((habit) => ({ date, habit })) }, video, date, 180);
  function recorded(done: number, seconds: number) {
    const baseline = { ...data, screenTime: [{ date, seconds, apps: [{ ...video, seconds }] }] };
    return habits.slice(0, done).reduce((current, habit) => writeLog(current, habit.id, date, { status: 'done', value: 1 }), baseline);
  }
  assert.equal(dailyTurtleReaction(recorded(7, 11880), date).pose, 'so-so');
  assert.equal(dailyTurtleReaction(recorded(7, 11881), date).pose, 'disappointed');
  assert.equal(dailyTurtleReaction(recorded(6, 11880), next).pose, 'disappointed');
  assert.equal(dailyTurtleReaction(recorded(7, 9000), next).pose, 'so-so');
  assert.equal(dailyTurtleReaction(recorded(6, 10000), date).pose, 'ready');
  assert.equal(dailyTurtleReaction(recorded(6, 10000), date, false, true).pose, 'disappointed');
  assert.equal(dailyTurtleReaction(recorded(7, 10000), date, false, true).pose, 'so-so');
  assert.equal(dailyTurtleReaction(recorded(10, 10000), date, false, true).key, `${date}-review-proud`);
  assert.equal(dailyTurtleReaction({ ...recorded(10, 10000), screenTime: [] }, date, false, true).pose, 'ready');
  assert.equal(dailyTurtleReaction(recorded(10, 10800), date).pose, 'proud');
  assert.equal(dailyTurtleReaction(recorded(4, 13000), date, true).pose, 'disappointed');
});

test('turtle reactions anticipate, vary their beats, and settle without moving the disappointed paws', () => {
  for (const pose of ['proud', 'disappointed', 'so-so'] as const) {
    assert.equal(turtleMotion(pose, 0).strength, 0);
    assert.equal(turtleMotion(pose, 0).lift, 0);
    assert.ok(turtleMotion(pose, 850).strength > .7);
    assert.equal(turtleMotion(pose, 4260).lift, 0);
    assert.ok(turtleMotion(pose, 0, true).strength > .8);
  }
  assert.ok(turtleMotion('proud', 170).squash > 0);
  assert.equal(turtleMotion('proud', 708).thumb, 1);
  assert.ok(turtleMotion('proud', 1485).lift > turtleMotion('proud', 1220).lift);
  assert.ok(turtleMotion('proud', 2220).lift > turtleMotion('proud', 1910).lift);
  assert.ok(turtleMotion('so-so', 950).palm < 0);
  assert.ok(turtleMotion('so-so', 1230).palm > 0);
  for (const [left, right] of [[670, 1090], [1470, 1850], [2210, 2530]]) {
    assert.ok(turtleMotion('disappointed', left).turn > 0);
    assert.ok(turtleMotion('disappointed', right).turn < 0);
    assert.equal(turtleMotion('disappointed', right).lift, 0);
  }
  assert.equal(turtleMotion('disappointed', 3350).turn, 0);
});

test('the turtle defaults to a shared budget and separates today from completed days', () => {
  const today = '2026-11-18';
  const yesterday = '2026-11-17';
  const tiktok = { id: 'tt', name: 'TikTok' };
  const instagram = { id: 'ig', name: 'Instagram' };
  const group = { id: 'social', name: 'Social media' };
  const original = saveAppLimit(starterData(), tiktok, yesterday, 15);
  const shared = saveAppLimit(original, group, yesterday, 180, [tiktok, instagram]);
  const data = { ...shared, screenTime: [
    { date: yesterday, seconds: 10800, apps: [{ ...tiktok, seconds: 5400 }, { ...instagram, seconds: 5400 }] },
    { date: today, seconds: 12000, apps: [{ ...tiktok, seconds: 6000 }, { ...instagram, seconds: 6000 }] },
  ] };
  assert.deepEqual(budgetPlan(data, today), { ...group, from: yesterday, apps: ['tt', 'ig'], seconds: 10800, headsUp: false });
  const status = budgetCoachStatus(data, today)!;
  assert.equal(status.progress?.remaining, -1200);
  assert.equal(status.yesterdayWithin, true);
  assert.deepEqual(status.week, { active: true, within: 1, over: 0 });
  assert.equal(budgetCoachStatus({ ...data, budgetCoach: { limitId: 'social', lastReset: { date: today, limitId: 'social' } } }, today)?.resetDone, true);
  assert.equal(budgetPlan({ ...data, budgetCoach: { limitId: 'tt', headsUp: true } }, today)?.headsUp, true);
  const todayUsage = { date: today, seconds: 1800, apps: [{ ...tiktok, seconds: 1200 }, { ...instagram, seconds: 600 }] };
  const underShared = { ...data, screenTime: [data.screenTime[0], todayUsage] };
  assert.equal(budgetCoachStatus(underShared, today)?.progress?.state, 'under');
  assert.deepEqual(budgetCoachStatus(underShared, today)?.exceeded, { ...tiktok, seconds: 300 });
  assert.equal(budgetCoachStatus({ ...data, screenTime: [] }, today)?.exceeded, undefined);
});

test('app limits compare recorded usage precisely and keep the limit in effect for each day', () => {
  const app = { id: 'video', name: 'Video' };
  const first = '2026-11-16';
  const second = '2026-11-17';
  const third = '2026-11-18';
  const fourth = '2026-11-19';
  const original = saveAppLimit(starterData(), app, first, 30);
  const extended = saveAppLimit(original, app, second, 45);
  const paused = saveAppLimit(extended, app, fourth, null);
  const limit = parseBackup(paused).appLimits![0];
  assert.equal(appLimitForDay(limit, '2026-11-15'), undefined);
  assert.equal(appLimitForDay(limit, first)?.minutes, 30);
  assert.equal(appLimitForDay(limit, third)?.minutes, 45);
  assert.equal(appLimitForDay(limit, fourth), undefined);
  assert.equal(saveAppLimit(extended, app, second, 0).appLimits![0].changes.length, 2);
  const usage = new Map([
    [first, { date: first, seconds: 1800, apps: [{ ...app, seconds: 1800 }] }],
    [second, { date: second, seconds: 2701, apps: [{ ...app, seconds: 2701 }] }],
    [fourth, { date: fourth, seconds: 2700, apps: [] }],
  ]);
  assert.deepEqual(checkAppLimit(app.id, 30, usage.get(first)), { used: 1800, remaining: 0, state: 'at' });
  assert.equal(checkAppLimit(app.id, 45, usage.get(second))?.state, 'over');
  assert.equal(checkAppLimit(app.id, 0, usage.get(fourth))?.state, 'at');
  assert.equal(checkAppLimit(app.id, 45, usage.get(third)), undefined);
  assert.deepEqual(countAppLimitDays(limit, [first, second, third, fourth], fourth, usage), { active: true, within: 1, over: 1 });
  assert.deepEqual(countAppLimitDays(limit, [first, second], second, usage), { active: true, within: 1, over: 0 });
});

test('a shared budget sums member apps and uses the membership in effect on each day', () => {
  const group = { id: 'social', name: 'Social media' };
  const instagram = { id: 'ig', name: 'Instagram' };
  const tiktok = { id: 'tt', name: 'TikTok' };
  const discord = { id: 'dc', name: 'Discord' };
  const first = '2026-11-16';
  const second = '2026-11-17';
  const third = '2026-11-18';
  const original = saveAppLimit(starterData(), group, first, 180, [instagram, tiktok]);
  const edited = saveAppLimit(original, group, second, 180, [instagram, discord]);
  const limit = parseBackup(edited).appLimits![0];
  const apps = [{ ...instagram, seconds: 7200 }, { ...tiktok, seconds: 3601 }, { ...discord, seconds: 900 }];
  const usage = new Map([first, second].map((date) => [date, { date, seconds: 11701, apps }]));
  assert.deepEqual(checkAppLimit(group.id, 180, usage.get(first), appLimitForDay(limit, first)?.apps),
    { used: 10801, remaining: -1, state: 'over' });
  assert.equal(checkAppLimit(group.id, 180, usage.get(second), appLimitForDay(limit, second)?.apps)?.used, 8100);
  assert.deepEqual(countAppLimitDays(limit, [first, second], third, usage), { active: true, within: 1, over: 1 });
  assert.throws(() => parseBackup(saveAppLimit(edited, group, third, 180, [instagram, instagram])), /valid Sparky backup/);
});

test('phone activity uses the device date, Monday weeks, and actual month lengths', () => {
  assert.deepEqual(phonePeriodDates('2026-11-18', 'Today'), ['2026-11-18']);
  assert.deepEqual(phonePeriodDates('2026-01-01', 'Week'), [
    '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
  ]);
  const february = phonePeriodDates('2024-03-31', 'Month', -1);
  assert.equal(february[0], '2024-02-01');
  assert.equal(february[28], '2024-02-29');
  assert.equal(february.length, 29);
});

test('phone activity refresh replaces covered health days and preserves earlier and unrelated records', () => {
  const early = '2026-10-17';
  const yesterday = '2026-11-17';
  const today = '2026-11-18';
  const firstNight = { date: early, minutes: 421, source: 'Health Connect' as const };
  const deletedNight = { date: yesterday, minutes: 450, source: 'Health Connect' as const };
  const data = { ...starterData(), sleep: [firstNight, deletedNight], steps: [{ date: yesterday, steps: 100 }] };
  const snapshot = phoneActivitySchema.parse({
    health: { state: 'connected' }, usage: { state: 'connected' },
    sleep: { from: yesterday, through: today, updated: 10, days: [] },
    screen: { updated: 10, days: [{ date: today, seconds: 70, hours: [{ hour: 9, value: 70 }],
      apps: [{ id: 'book', name: 'Books', seconds: 70 }] }] },
  });
  const first = parseBackup(mergePhoneActivity(data, snapshot));
  const second = parseBackup(mergePhoneActivity(first, snapshot));
  assert.deepEqual(first.sleep, [firstNight]);
  assert.deepEqual(first.steps, data.steps);
  assert.deepEqual(first.screenTime, snapshot.screen?.days);
  assert.deepEqual(second, first);
});

test('starter habits use the device calendar and only scheduled days are due', () => {
  const date = new Date(2026, 10, 17, 23, 59);
  const data = starterData(date);
  assert.equal(localDate(date), '2026-11-17');
  assert.equal(data.categories.length, 7);
  assert.equal(data.habits.length, 7);
  assert.equal(data.logs.length, 0);
  assert.equal(dueHabits(data.habits, '2026-11-16').length, 0);
  assert.equal(dueHabits(data.habits, '2026-11-17').length, 6);
  assert.equal(dueHabits(data.habits, '2026-11-18').length, 7);
  assert.deepEqual(recentDates('2026-11-02'), [
    '2026-11-02', '2026-11-01', '2026-10-31', '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27',
  ]);
});

test('minimum is acknowledged, planned rest changes the denominator, and edits replace one entry', () => {
  const date = '2026-11-17';
  const data = starterData(new Date(2026, 10, 17));
  const read = writeLog(data, 'read', date, { status: 'done', value: 5 });
  const rest = writeLog(read, 'move', date, { status: 'rest', value: 0 });
  const skip = writeLog(rest, 'meditate', date, { status: 'skipped', value: 0 });
  const progress = (state: typeof data) => dailyProgress(dueHabits(state.habits, date), new Map(state.logs.map((log) => [log.habitId, log])));
  assert.deepEqual(progress(skip), { minimum: 1, target: 0, rest: 1, scheduled: 5 });
  const stretch = writeLog(skip, 'read', date, { status: 'done', value: 40 });
  assert.equal(stretch.logs.length, 3);
  assert.equal(stretch.logs.find((log) => log.habitId === 'read')?.achievement, 'stretch');
  assert.deepEqual(progress(stretch), { minimum: 1, target: 1, rest: 1, scheduled: 5 });
  assert.equal(progress(writeLog(stretch, 'read', date)).target, 0);
  assert.throws(() => writeLog(data, 'reach-out', date, { status: 'done', value: 1 }), /no longer scheduled/);
});

test('backup validation rejects malformed dates, duplicate logs, invalid references, and unknown versions', () => {
  const data = writeLog(starterData(new Date(2026, 10, 17)), 'read', '2026-11-17', { status: 'done', value: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(parseBackup(data))), JSON.parse(JSON.stringify(data)));
  assert.throws(() => parseBackup({ ...data, version: 3 }), /valid Sparky backup/);
  assert.throws(() => parseBackup({ ...data, logs: [...data.logs, ...data.logs] }), /valid Sparky backup/);
  assert.throws(() => parseBackup({ ...data, logs: [{ ...data.logs[0], date: '2026-02-31' }] }), /valid Sparky backup/);
  assert.throws(() => parseBackup({ ...data, habits: [] }), /valid Sparky backup/);
});

test('avoidance requires an explicit outcome and prior schedules survive edits and archiving', () => {
  const date = '2026-11-17';
  let data = starterData(new Date(2026, 10, 17));
  const avoid = { ...data.habits.find(({ id }) => id === 'gratitude')!, id: 'avoid-sweets', trackingType: 'avoid' as const };
  data = savePlan(data, avoid, date);
  assert.equal(makeReport(data, date, 1).hit, 0);
  data = writeLog(data, avoid.id, date, { status: 'slipped', value: 0 });
  assert.equal(makeReport(data, date, 1).hit, 0);
  data = writeLog(data, avoid.id, date, { status: 'done', value: 1 });
  assert.equal(makeReport(data, date, 1).hit, 1);
  data = savePlan(data, { ...avoid, archivedAt: new Date(2026, 10, 18).toISOString() }, '2026-11-18');
  assert.equal(makeReport(data, '2026-11-18', 2).hit, 1);
  assert.equal(makeReport(data, '2026-11-18', 1).planned, 7);
});

test('legacy data keeps past actions without inferring historical schedules', () => {
  const date = '2026-11-17';
  const data = writeLog(starterData(new Date(2026, 10, 17)), 'read', date, { status: 'done', value: 20 });
  const migrated = parseBackup({ ...data, version: 1 }, '2026-11-18');
  const report = makeReport(migrated, date, 1);
  assert.equal(migrated.version, 2);
  assert.equal(report.actions, 1);
  assert.equal(report.rate, undefined);
  assert.equal(report.daily[0].covered, false);
});

test('coach suggests a smaller target from evidence and leaves the plan unchanged', () => {
  let data = starterData(new Date(2026, 10, 17));
  for (const day of ['2026-11-17', '2026-11-18', '2026-11-19']) data = writeLog(data, 'read', day, { status: 'done', value: 6 });
  assert.equal(coachingSuggestion(data, '2026-11-20')?.target, 12);
  assert.equal(data.habits.find((habit) => habit.id === 'read')?.thresholds?.target, 20);
  assert.deepEqual(data.audit, []);
});

test('reminders use each habit’s deadline and suppress finished, rested, and checked-in Break List items', () => {
  const date = '2026-11-17';
  let data: ReturnType<typeof starterData> = { ...starterData(new Date(2026, 10, 17)), reminder: '22:00' };
  const read = data.habits.find((habit) => habit.id === 'read')!;
  const gratitude = data.habits.find((habit) => habit.id === 'gratitude')!;
  data = savePlan(data, { ...read, reminderTime: '21:00' }, date);
  data = savePlan(data, { ...gratitude, id: 'sweets', trackingType: 'avoid' }, date);
  data = writeLog(data, 'read', date, { status: 'done', value: 5 });
  data = writeLog(data, 'gratitude', date, { status: 'done', value: 1 });
  data = writeLog(data, 'move', date, { status: 'rest', value: 0 });
  data = writeLog(data, 'sweets', date, { status: 'slipped', value: 0 });
  const plan = new Map(reminderPlan(data, date).map((item) => [item.id, item]));
  assert.equal(plan.get('read')?.time, '21:00');
  assert.equal(plan.get('sweets')?.time, '22:00');
  assert.deepEqual(plan.get('read')?.accountedFor, []);
  for (const id of ['gratitude', 'move', 'sweets']) assert.deepEqual(plan.get(id)?.accountedFor, [date]);
  assert.deepEqual(unfinishedToday(data, date).map((habit) => habit.id).sort(), ['learn', 'meditate', 'project', 'read']);
});

test('restart steps get smaller, trigger the third missed session once, and reset on a restart', () => {
  const start = '2026-11-16';
  let data = starterData(new Date(2026, 10, 16));
  const habit = { ...data.habits.find(({ id }) => id === 'read')!, restartFrom: start, consequence: 'Tidy for five minutes' };
  data = savePlan(data, habit, start);
  assert.equal(recoveryFor(data, habit, '2026-11-17')?.value, 5);
  data = writeLog(data, habit.id, '2026-11-17', { status: 'rest', value: 0 });
  assert.equal(recoveryFor(data, habit, '2026-11-17'), undefined);
  assert.equal(recoveryFor(data, habit, '2026-11-18')?.missed, 1);
  assert.equal(recoveryFor(data, habit, '2026-11-19')?.value, 2);
  data = writeLog(data, habit.id, '2026-11-19', { status: 'skipped', value: 0 });
  assert.equal(recoveryFor(data, habit, '2026-11-19')?.third, '2026-11-19');
  data = { ...data, consequenceChecks: [{ habitId: habit.id, date: '2026-11-19' }] };
  assert.equal(recoveryFor(data, habit, '2026-11-20')?.consequenceDone, true);
  data = writeLog(data, habit.id, '2026-11-20', { status: 'done', value: 2, restart: true });
  assert.equal(recoveryFor(data, habit, '2026-11-21'), undefined);
});

test('flexible habits log on any day while missed days and reminders require a commitment', () => {
  const monday = '2026-11-16';
  let data = starterData(new Date(2026, 10, 16));
  const habit = { ...data.habits.find(({ id }) => id === 'read')!, weeklyTarget: 3, restartFrom: monday };
  data = savePlan(data, habit, monday);
  data = { ...data, weeklySessions: [{ habitId: habit.id, date: '2026-11-18' }], reminder: '21:00' };
  assert.equal(recoveryFor(data, habit, '2026-11-18'), undefined);
  assert.equal(recoveryFor(data, habit, '2026-11-19')?.missed, 1);
  assert.deepEqual(reminderPlan(data, monday).find((rule) => rule.id === habit.id)?.committedDates, ['2026-11-18']);
  data = writeLog(data, habit.id, '2026-11-19', { status: 'done', value: 20 });
  assert.equal(weeklyProgress(data, habit, '2026-11-19'), 1);
});

test('notification completions are replay safe and leave earlier entries untouched', () => {
  const date = '2026-11-17';
  const original = starterData(new Date(2026, 10, 17));
  const first = { id: 'android-1', habitId: 'gratitude', date };
  const applied = applyPhoneCompletions(original, [first, first]);
  assert.equal(applied.logs.length, 1);
  assert.equal(applied.logs[0]?.status, 'done');
  const skipped = writeLog(applied, 'gratitude', date, { status: 'skipped', value: 0 });
  const replayed = applyPhoneCompletions(skipped, [first, { ...first, id: 'android-2' }]);
  assert.deepEqual(replayed.logs, skipped.logs);
  assert.deepEqual(replayed.phoneReceipts, ['android-1', 'android-2']);
});

test('two part-week misses can earn so-so while daily misses and large overages still count', () => {
  const day = '2026-11-18';
  const start = starterData(calendarDate(day));
  const template = start.habits.find((item) => item.id === 'gratitude')!;
  const habits = Array.from({ length: 5 }, (_, i) => ({
    ...template, id: String(i), ...(i === 3 ? { days: [1, 3, 5] } : i === 4 ? { weeklyTarget: 4 } : {}),
  }));
  const base = { ...start, habits, plans: habits.map((habit) => ({ date: day, habit })),
    weeklySessions: [{ date: day, habitId: '4' }] };
  let data: typeof start = base;
  for (const id of ['0', '1', '2']) data = writeLog(data, id, day, { status: 'done', value: 1 });
  const score = dailyTurtleReaction(data, day, false, true);
  assert.deepEqual([score.done, score.total, score.pose], [3, 5, 'so-so']);
  const dailyMiss = savePlan(data, { ...habits[3], days: template.days }, day);
  assert.equal(dailyTurtleReaction(dailyMiss, day, false, true).pose, 'disappointed');
  assert.deepEqual(turtleHabitProgress({ ...data, weeklySessions: [] }, day), { done: 3, total: 4 });
  const next = '2026-11-19';
  assert.equal(dailyTurtleReaction(data, next).comeback, false);
  data = writeLog(data, '4', next, { status: 'done', value: 1 });
  const back = dailyTurtleReaction(data, next);
  assert.equal(back.comeback, true);
  assert.equal(back.bonus, 1);
  assert.equal(back.pose, 'ready');
  assert.equal(back.done, 0);
});

test('calendar slots respect fully occupied days, overlapping events and exact meeting ends', () => {
  const day = '2026-11-20';
  const read = starterData(calendarDate(day)).habits.find((habit) => habit.id === 'read')!;
  const at = (hour: number, minute = 0) => calendarDate(day).setHours(hour, minute, 0, 0);
  assert.equal(freeSlot(day, read, [{ start: at(0), end: at(24) }]), undefined);
  assert.deepEqual(freeSlot(day, read, [{ start: at(8, 20), end: at(8, 45) }, { start: at(7), end: at(8, 30) }]),
    { start: at(8, 45), end: at(9, 5) });
});

test('Sparky learns a separate reminder from nearby finish times and adjusts as the routine moves', () => {
  const data = starterData(calendarDate('2026-11-01'));
  const habit = data.habits.find((item) => item.id === 'read')!;
  habit.learnedLead = 30;
  habit.reminderTime = '11:00';
  function finish(day: number, hour: number, minute: number, value = habit.thresholds!.target) {
    const at = new Date(2026, 10, day, hour, minute);
    data.logs = writeLog(data, habit.id, localDate(at), { status: 'done', value }, at).logs;
  }
  const time = () => reminderPlan(data, '2026-11-23').find((rule) => rule.id === habit.id)?.time;
  finish(1, 14, 55);
  finish(2, 15, 0);
  finish(3, 8, 0, 1);
  assert.equal(time(), undefined);
  finish(4, 15, 5);
  assert.equal(time(), '14:30');
  finish(4, 22, 0);
  assert.equal(time(), '14:30');
  habit.learnedLead = 60;
  assert.equal(time(), '14:00');
  data.reminderControls = { disabled: false, quietFrom: '13:30', quietThrough: '14:30' };
  assert.equal(time(), undefined);
  data.reminderControls = undefined;
  for (let day = 5; day <= 10; day++) finish(day, 18, 15);
  assert.equal(time(), '17:15');
  habit.learnedLead = undefined;
  assert.equal(time(), '11:00');
});
