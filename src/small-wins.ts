import { localDate, newId, type AppData } from './model.ts';

type SmallWins = NonNullable<AppData['smallWins']>;
type Snapshots = NonNullable<SmallWins['snapshots']>;
export type SmallWin = SmallWins['items'][number];

/** Everyday basics offered until the user customizes their list. */
export const defaultSmallWins: SmallWin[] = [
  { id: 'water', title: 'Drink water', emoji: '💧', goal: 6, step: 0.5, unit: 'L' },
  { id: 'bed', title: 'Make the bed', emoji: '🛏️', goal: 1, step: 1, unit: '' },
  { id: 'dishes', title: 'Wash the dishes', emoji: '🍽️', goal: 1, step: 1, unit: '' },
  { id: 'shower', title: 'Take a shower', emoji: '🚿', goal: 1, step: 1, unit: '' },
  { id: 'outside', title: 'Go outside', emoji: '🌳', goal: 1, step: 1, unit: '' },
  { id: 'tidy', title: 'Tidy up 5 min', emoji: '🧺', goal: 1, step: 1, unit: '' },
  { id: 'stretch', title: 'Stretch', emoji: '🤸', goal: 1, step: 1, unit: '' },
  { id: 'meal', title: 'Healthy meal', emoji: '🥗', goal: 3, step: 1, unit: 'meals' },
];

// Each snapshot ends just before its change date. The live roster follows the last snapshot.
function snapshotIndex(snapshots: Snapshots, date: string) {
  let low = 0;
  let high = snapshots.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (date < snapshots[mid].before) high = mid;
    else low = mid + 1;
  }
  return low;
}

export function smallWinItems(data: AppData, date?: string) {
  const wins = data.smallWins;
  if (date && wins?.snapshots?.length) return wins.snapshots[snapshotIndex(wins.snapshots, date)]?.items ?? wins.items;
  return wins?.items ?? defaultSmallWins;
}

// App updates replace the log array. All readers of that revision can share one index.
const logIndexes = new WeakMap<SmallWins['log'], Map<string, Map<string, number>>>();
function countsForDay(data: AppData, date: string) {
  const log = data.smallWins?.log;
  if (!log?.length) return;
  let index = logIndexes.get(log);
  if (!index) {
    index = new Map();
    for (const entry of log) {
      let counts = index.get(entry.date);
      if (!counts) {
        counts = new Map();
        index.set(entry.date, counts);
      }
      counts.set(entry.id, entry.count);
    }
    logIndexes.set(log, index);
  }
  return index.get(date);
}

export function smallWinCount(data: AppData, id: string, date: string) {
  return countsForDay(data, date)?.get(id) ?? 0;
}

const amount = (win: SmallWin, count: number) => Number((count * win.step).toFixed(2));

/** "1.5 / 3 L", "2 / 3 meals", or nothing for a simple one-tap win. */
export function smallWinProgress(win: SmallWin, count: number) {
  if (win.goal === 1 && win.step === 1) return '';
  return `${amount(win, count)} / ${amount(win, win.goal)}${win.unit ? ` ${win.unit}` : ''}`;
}

function withLog(data: AppData, id: string, date: string, count: number): AppData {
  const items = smallWinItems(data);
  const log = (data.smallWins?.log ?? []).filter((entry) => entry.id !== id || entry.date !== date);
  return { ...data, smallWins: { ...data.smallWins, items, log: count > 0 ? [...log, { id, date, count: Math.min(count, 999) }] : log } };
}

/** One tap adds one. A one-time win that is already done toggles back off. */
export function tapSmallWin(data: AppData, win: SmallWin, date: string): AppData {
  const item = smallWinItems(data, date).find(({ id }) => id === win.id);
  if (!item) return data;
  const count = smallWinCount(data, win.id, date);
  if (item.goal === 1 && count >= 1) return withLog(data, win.id, date, 0);
  return withLog(data, win.id, date, count + 1);
}

export function undoSmallWin(data: AppData, win: SmallWin, date: string): AppData {
  if (!smallWinItems(data, date).some(({ id }) => id === win.id)) return data;
  return withLog(data, win.id, date, smallWinCount(data, win.id, date) - 1);
}

function changeRoster(data: AppData, date: string, next: SmallWin[], log = data.smallWins?.log ?? []): AppData {
  const snapshots = [...(data.smallWins?.snapshots ?? [])];
  const index = snapshotIndex(snapshots, date);
  const later = snapshots[index];
  const previous = later?.items ?? smallWinItems(data);
  if (later) snapshots[index] = { ...later, items: next };
  if (snapshots[index - 1]?.before !== date) snapshots.splice(index, 0, { before: date, items: previous });
  return { ...data, smallWins: { items: later ? smallWinItems(data) : next, snapshots, log } };
}

export function saveSmallWin(data: AppData, draft: Omit<SmallWin, 'id'> & { id?: string }, date = localDate()): AppData {
  const items = smallWinItems(data, date);
  const win: SmallWin = { ...draft, id: draft.id ?? newId() };
  const next = items.some((item) => item.id === win.id) ? items.map((item) => item.id === win.id ? win : item) : [...items, win];
  return changeRoster(data, date, next);
}

/** Removing a win keeps its past log, so history and AI summaries still count it. */
export function removeSmallWin(data: AppData, id: string, date = localDate()): AppData {
  const items = smallWinItems(data, date);
  const win = items.find((item) => item.id === id);
  if (!win) return data;
  const snapshots = data.smallWins?.snapshots ?? [];
  const nextChange = snapshots[snapshotIndex(snapshots, date)]?.before;
  const log = (data.smallWins?.log ?? []).map((entry) =>
    entry.id === id && entry.date >= date && (!nextChange || entry.date < nextChange)
      ? { ...entry, removed: { title: win.title, goal: win.goal } } : entry);
  return changeRoster(data, date, items.filter((item) => item.id !== id), log);
}

export function smallWinsDone(data: AppData, date: string, items = smallWinItems(data, date)) {
  const counts = countsForDay(data, date);
  return counts ? items.reduce((done, win) => done + Number((counts.get(win.id) ?? 0) >= win.goal), 0) : 0;
}

/** Totals for a date range, for reports and AI summaries. Includes wins that were later removed. */
export function smallWinTotals(data: AppData, from: string, to: string) {
  const totals = new Map<string, { latest: string; title: string; times: number; days: number; goalDays: number }>();
  for (const entry of data.smallWins?.log ?? []) {
    if (entry.date < from || entry.date > to) continue;
    const win = smallWinItems(data, entry.date).find((item) => item.id === entry.id) ?? entry.removed
      ?? defaultSmallWins.find((item) => item.id === entry.id);
    const total = totals.get(entry.id) ?? { latest: '', title: '', times: 0, days: 0, goalDays: 0 };
    if (entry.date > total.latest) {
      total.title = win?.title ?? 'Removed small win';
      total.latest = entry.date;
    }
    total.times += entry.count;
    total.days += 1;
    if (win && entry.count >= win.goal) total.goalDays += 1;
    totals.set(entry.id, total);
  }
  return [...totals.values()].sort((a, b) => b.days - a.days)
    .map(({ title, times, days, goalDays }) => ({ title, times, days, goalDays }));
}

/** From this day on, small wins count as one habit in Sparky's score. Earlier days keep their verdicts. */
export const smallWinsCountFrom = '2026-11-21';
export const smallWinsShare = 0.7;

/** Small wins as one habit for Sparky: done when 70% of them reached their goal that day. */
export function smallWinsAsHabit(data: AppData, date: string) {
  const items = smallWinItems(data, date);
  const total = items.length;
  const counted = total > 0 && date >= smallWinsCountFrom && date >= data.planStart;
  const done = smallWinsDone(data, date, items);
  const needed = Math.ceil(total * smallWinsShare);
  return { counted, reached: counted && done >= needed, done, total, needed };
}
