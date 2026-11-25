import { dueHabits, sessionKeys, shiftDate, type AppData } from './model.ts';
import { prioritiesFor, reaches, recoveryFor } from './planning.ts';
import { makeReport } from './reports.ts';

export interface AIProvider {
  readonly status: 'not-connected' | 'connected';
}

export const coach: AIProvider = { status: 'not-connected' };

export function dailyCoaching(data: AppData, date: string) {
  const logs = new Map(data.logs.filter((entry) => entry.date === date).map((entry) => [entry.habitId, entry]));
  const due = dueHabits(data.habits, date, sessionKeys(data));
  const rested = due.filter((habit) => logs.get(habit.id)?.status === 'rest');
  const active = due.filter((habit) => logs.get(habit.id)?.status !== 'rest');
  const priorities = prioritiesFor(data, date);
  const open = active.filter((habit) => habit.trackingType !== 'avoid' && !reaches(habit, logs.get(habit.id), false));
  const first = priorities.map(({ habitId }) => open.find(({ id }) => id === habitId)).find(Boolean) ?? open[0];
  const lowEnergy = data.checkIns.some((entry) => entry.date === date && entry.energy <= 2);
  const recovery = first ? recoveryFor(data, first, date, false) : undefined;
  const goal = data.goals.filter((item) => item.due && item.due >= date)
    .sort((a, b) => a.due!.localeCompare(b.due!))[0];
  const week = makeReport(data, shiftDate(date, -1), 7);
  const previous = makeReport(data, shiftDate(date, -8), 7);
  return {
    due: active.length, rested: rested.length, target: active.filter((habit) => reaches(habit, logs.get(habit.id), false)).length,
    first, lowEnergy, startSmall: lowEnergy || Boolean(recovery), goal, week, previous,
    difficult: [...week.habits].filter((habit) => habit.hit < habit.planned)
      .sort((a, b) => a.hit / a.planned - b.hit / b.planned)[0],
  };
}

export function coachingSuggestion(data: AppData, date: string) {
  const start = shiftDate(date, -7);
  for (const habit of data.habits) {
    if (habit.archivedAt || !habit.thresholds) continue;
    const { minimum, target, stretch } = habit.thresholds;
    const logs = data.logs.filter((log) => log.habitId === habit.id && log.date >= start && log.date < date &&
      log.status === 'done' && (!log.trackingType || log.trackingType === habit.trackingType) && log.unit === habit.unit);
    if (logs.length < 3) continue;
    const atTarget = logs.filter((log) => log.value >= target).length;
    const atMinimum = logs.filter((log) => log.value >= minimum).length;
    if (atMinimum >= 3 && atTarget === 0 && minimum < target) return {
      habit, target: Math.max(minimum, Math.floor((minimum + target) / 2)),
      reason: `You reached the minimum on ${atMinimum} logged days and stayed below the ${target} ${habit.unit} target.`,
    };
    if (logs.length >= 5 && atTarget === logs.length && stretch > target) return {
      habit, target: Math.min(stretch, target + Math.max(1, Math.round(target / 10))),
      reason: `You reached the ${target} ${habit.unit} target on all ${logs.length} logged days.`,
    };
  }
}
