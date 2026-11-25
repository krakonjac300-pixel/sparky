import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, parseBackup, shiftDate, starterData, writeLog, type AppData } from '../src/model.ts';
import {
  defaultSmallWins, removeSmallWin, saveSmallWin, smallWinsAsHabit, smallWinCount, smallWinItems, smallWinProgress, smallWinTotals, smallWinsDone, tapSmallWin, undoSmallWin,
} from '../src/small-wins.ts';
import { dailyTurtleReaction, dayReaction, scoringHistory, sparkyHistory } from '../src/budget-coach.ts';
import { restoreBackup, serializeBackup } from '../src/backup.ts';
import { streakInfo } from '../src/streak.ts';
import { summaryPrompt } from '../src/ai.ts';

const today = '2026-11-21';
const water = defaultSmallWins.find(({ id }) => id === 'water')!;
const bed = defaultSmallWins.find(({ id }) => id === 'bed')!;

test('water counts up in half litres to its goal, and one-time wins toggle', () => {
  let data = starterData(calendarDate(today));
  for (let i = 0; i < 3; i++) data = tapSmallWin(data, water, today);
  assert.equal(smallWinProgress(water, smallWinCount(data, 'water', today)), '1.5 / 3 L');
  data = undoSmallWin(data, water, today);
  assert.equal(smallWinCount(data, 'water', today), 2);
  data = tapSmallWin(data, bed, today);
  assert.equal(smallWinsDone(data, today), 1);
  data = tapSmallWin(data, bed, today);
  assert.equal(smallWinCount(data, 'bed', today), 0, 'tapping a finished one-time win undoes it');
  assert.equal(smallWinProgress(bed, 1), '');
  assert.ok(parseBackup(data), 'small wins survive backup and restore');
});

test('custom wins can be added and removed, and removed wins keep their history', () => {
  let data = saveSmallWin(starterData(calendarDate(today)), { title: 'Water the plants', emoji: '🪴', goal: 1, step: 1, unit: '' }, today);
  const plants = smallWinItems(data).find(({ title }) => title === 'Water the plants')!;
  data = tapSmallWin(data, plants, today);
  data = removeSmallWin(data, plants.id, today);
  assert.equal(smallWinItems(data).some(({ id }) => id === plants.id), false);
  assert.deepEqual(smallWinTotals(data, today, today), [{ title: 'Water the plants', times: 1, days: 1, goalDays: 1 }]);
  assert.ok(parseBackup(data));
});

test('small wins count as one habit for Sparky once 70% are done', () => {
  let data = starterData(calendarDate(today));
  const plain = dailyTurtleReaction(data, today, false, false, false);
  const wins = smallWinItems(data);
  const needed = smallWinsAsHabit(data, today).needed;
  assert.equal(needed, Math.ceil(wins.length * 0.7));
  for (const win of wins.slice(0, needed - 1)) for (let i = 0; i < win.goal; i++) data = tapSmallWin(data, win, today);
  let day = dailyTurtleReaction(data, today, false, false, false);
  assert.equal(day.done, plain.done, 'one short of 70% does not count yet');
  assert.ok(day.missed.some(({ title }) => title.startsWith('Small wins')));
  const last = wins[needed - 1];
  for (let i = 0; i < last.goal; i++) data = tapSmallWin(data, last, today);
  day = dailyTurtleReaction(data, today, false, false, false);
  assert.equal(day.done, plain.done + 1);
  assert.equal(day.total, plain.total);
  assert.match(summaryPrompt(data, today, 7, 'Week'), /Small wins[^\n]*\n- [^\n]*: done on 1 days \(full goal on 1\)/);
});

test('days before small wins existed keep their old score', () => {
  const data = starterData(calendarDate('2026-11-10'));
  const before = dailyTurtleReaction(data, '2026-11-20', false, false, false);
  assert.equal(before.missed.some(({ title }) => title.startsWith('Small wins')), false);
});

function legacyPlan(): AppData {
  const base = starterData(calendarDate(today));
  const habit = base.habits.find(({ id }) => id === 'gratitude')!;
  return { ...base, habits: [habit], plans: [{ date: today, habit }], smallWins: { items: [bed], log: [] } };
}

test('a closed week keeps its daily targets, verdicts, freeze bank and AI summary after roster changes', () => {
  let data = legacyPlan();
  const last = shiftDate(today, 7);
  const edit = shiftDate(last, 1);
  for (let i = 0; i < 8; i++) {
    const date = shiftDate(today, i);
    data = writeLog(data, 'gratitude', date, { status: 'done', value: 1 });
    if (date !== last) data = tapSmallWin(data, bed, date);
  }
  const closed = (state: AppData) => ({
    days: [...scoringHistory(state, today, last, true)],
    faces: sparkyHistory(state, edit, 9).slice(0, -1),
    streak: streakInfo(state, edit),
    prompt: summaryPrompt(state, last, 8, 'Week'),
  });
  const original = closed(data);
  assert.deepEqual(original.days.map(({ pose }) => pose), [...Array(7).fill('proud'), 'disappointed']);
  assert.deepEqual([original.streak.best, original.streak.streak, original.streak.freezes], [7, 7, 0]);
  assert.equal(original.streak.week.at(-2)?.state, 'frozen');
  for (const mutation of [
    (state: AppData) => saveSmallWin(state, water, edit),
    (state: AppData) => saveSmallWin(state, { ...bed, title: 'Change sheets', goal: 3 }, edit),
    (state: AppData) => removeSmallWin(state, bed.id, edit),
    (state: AppData) => removeSmallWin(state, water.id, edit),
  ]) {
    data = restoreBackup(serializeBackup(mutation(data)));
    assert.deepEqual(closed(data), original);
    for (const day of original.days) assert.deepEqual(dayReaction(data, day.date, true), day);
  }
  assert.equal(data.smallWins?.snapshots?.length, 1);
  assert.equal(smallWinsAsHabit(data, edit).counted, false);
  data = saveSmallWin(data, bed, shiftDate(edit, 3));
  assert.equal(smallWinsAsHabit(data, shiftDate(edit, 2)).counted, false);
  assert.equal(smallWinsAsHabit(data, shiftDate(edit, 3)).total, 1);
});

test('summaries use the dated goal, preserve removed titles and choose the latest name in range', () => {
  const second = shiftDate(today, 1);
  const third = shiftDate(second, 1);
  const changed = { ...bed, title: 'Fresh sheets', goal: 2 };
  let data = tapSmallWin(legacyPlan(), bed, today);
  data = saveSmallWin(data, changed, second);
  data = tapSmallWin(data, changed, second);
  data = tapSmallWin(data, changed, third);
  data = removeSmallWin(data, bed.id, third);
  data = restoreBackup(serializeBackup(data));
  assert.deepEqual(smallWinTotals(data, today, today), [{ title: bed.title, times: 1, days: 1, goalDays: 1 }]);
  assert.deepEqual(smallWinTotals(data, second, third), [{ title: changed.title, times: 2, days: 2, goalDays: 0 }]);
  data = { ...data, smallWins: { ...data.smallWins!, log: [...data.smallWins!.log].reverse() } };
  assert.deepEqual(smallWinTotals(data, today, third), [{ title: changed.title, times: 3, days: 3, goalDays: 1 }]);
  assert.equal(smallWinsAsHabit(data, second).reached, false);
  data = tapSmallWin(data, bed, second);
  assert.equal(smallWinsAsHabit(data, second).reached, true);
  assert.equal(smallWinsAsHabit(undoSmallWin(data, changed, second), second).reached, false);
});

test('editing after moving the device date back preserves the next dated roster', () => {
  const second = shiftDate(today, 1);
  const later = shiftDate(today, 4);
  let data = saveSmallWin(legacyPlan(), water, later);
  data = removeSmallWin(data, bed.id, second);
  data = saveSmallWin(data, { ...bed, goal: 3 }, second);
  data = restoreBackup(serializeBackup(data));
  assert.deepEqual(smallWinItems(data, today), [bed]);
  assert.deepEqual(smallWinItems(data, shiftDate(later, -1)), [{ ...bed, goal: 3 }]);
  assert.deepEqual(smallWinItems(data, later), [bed, water]);
  assert.deepEqual(data.smallWins?.snapshots?.map((row) => row.before), [second, later]);
});

test('legacy backups retain their saved roster, implicit defaults and orphan taps', () => {
  const base = starterData(calendarDate(today));
  assert.deepEqual(smallWinItems(restoreBackup(JSON.stringify(base)), today), defaultSmallWins);
  const next = shiftDate(today, 1);
  const changed = removeSmallWin(base, bed.id, next);
  assert.deepEqual(smallWinItems(changed, today), defaultSmallWins);
  const legacy = legacyPlan();
  legacy.smallWins!.log = [{ id: 'unknown', date: today, count: 4 }];
  const data = saveSmallWin(restoreBackup(JSON.stringify(legacy)), { ...water, id: 'unknown' }, next);
  assert.deepEqual(smallWinTotals(data, today, today), [{ title: 'Removed small win', times: 4, days: 1, goalDays: 0 }]);
  assert.equal(smallWinsAsHabit(data, today).total, 1);
});

test('restore rejects invalid snapshot dates, ordering, duplicate IDs and invalid item or log details', () => {
  const base = legacyPlan();
  const row = { before: today, items: [bed] };
  for (const snapshots of [
    [{ ...row, before: '2026-02-30' }], [row, row], [row, { ...row, before: shiftDate(today, -1) }],
    [{ ...row, items: [bed, bed] }], [{ ...row, items: [{ ...bed, goal: 0 }] }],
    [{ ...row, items: [{ ...bed, title: '' }] }], [{ ...row, items: Array(41).fill(bed) }],
  ]) {
    assert.throws(() => restoreBackup(JSON.stringify({ ...base, smallWins: { ...base.smallWins, snapshots } })));
  }
  const log = [{ id: bed.id, date: today, count: 1, removed: { title: bed.title, goal: 0 } }];
  assert.throws(() => restoreBackup(JSON.stringify({ ...base, smallWins: { ...base.smallWins, log } })));
});

test('daily lookups and streak replay share one pass over a year of Small wins logs', () => {
  const data = legacyPlan();
  const log = Array.from({ length: 365 }, (_, i) => ({ id: bed.id, date: shiftDate(today, i), count: 1 }));
  let reads = 0;
  data.smallWins!.log = new Proxy(log, {
    get(rows, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(rows, key, receiver);
    },
  });
  for (const entry of log) assert.equal(smallWinsDone(data, entry.date), 1);
  const days = [...scoringHistory(data, today, log.at(-1)!.date, true)];
  assert.equal(days.length, 365);
  assert.ok(days.every((day) => day.done === 1 && day.total === 2));
  assert.equal(reads, log.length);
});
