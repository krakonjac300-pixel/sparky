import {
  achievement, calendarDate, logKey, plannedFor, scoringPaused, sessionKeys, shiftDate, writeLog,
  type AppData, type Habit, type HabitLog, type Priority,
} from './model.ts';

export function weekDates(date: string) {
  const monday = shiftDate(date, -((calendarDate(date).getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

export function weeklyProgress(data: AppData, habit: Habit, date: string, through?: string) {
  const days = new Set(weekDates(date));
  return data.logs.filter((log) => log.habitId === habit.id && days.has(log.date) && (!through || log.date <= through) && reaches(habit, log, false)).length;
}

export function prioritiesFor(data: AppData, date: string): Priority[] {
  return data.priorities?.find((day) => day.date === date)?.items ?? [];
}

export function reaches(habit: Habit, entry: HabitLog | undefined, minimum: boolean) {
  if (minimum && habit.trackingType === 'avoid' && entry?.status === 'slipped' && entry.slip === 'little') return true;
  if (!entry || entry.status !== 'done' || entry.unit !== habit.unit || (entry.trackingType && entry.trackingType !== habit.trackingType)) return false;
  const level = achievement(habit, entry.value);
  return level === 'target' || level === 'stretch' || (minimum && level === 'minimum');
}

export function recoveryFor(data: AppData, habit: Habit, today: string, includeTodaySkip = true) {
  const recoveryStart = habit.restartFrom ?? data.recoveryStart;
  if (!recoveryStart || habit.restartDisabled || habit.trackingType === 'avoid') return undefined;
  const start = [recoveryStart, habit.createdDate, data.planStart].sort().at(-1)!;
  if (start > today) return undefined;
  const sessions = sessionKeys(data);
  const revisions = data.plans.filter(({ habit: version }) => version.id === habit.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const logs = new Map(data.logs.filter(({ habitId }) => habitId === habit.id).map((entry) => [entry.date, entry]));
  const current = logs.get(today);
  if (current?.status === 'rest' || current?.status === 'restart' || current?.restart || reaches(habit, current, true)) return undefined;
  const missed: string[] = [];
  const nextSession = includeTodaySkip && current?.status === 'skipped';
  for (let date = nextSession ? today : shiftDate(today, -1); date >= start; date = shiftDate(date, -1)) {
    const version = revisions.find((entry) => entry.date <= date)?.habit;
    const entry = logs.get(date);
    if (scoringPaused(data, date) || !version || entry?.status === 'rest') continue;
    if (entry?.status === 'restart' || entry?.restart || reaches(version, entry, true)) break;
    if (entry?.status === 'skipped' || plannedFor(version, date, sessions)) missed.push(date);
  }
  if (!missed.length) return undefined;
  const third = missed.length >= 3 ? missed[missed.length - 3] : undefined;
  const firstStep = habit.thresholds ? Math.min(habit.thresholds.minimum, habit.thresholds.target - 1) : 0;
  const value = (missed.length === 1 ? firstStep : Math.floor(firstStep / 2)) || undefined;
  return {
    missed: missed.length, third, nextSession, value,
    consequenceDone: !!third && (data.consequenceChecks ?? []).some(({ habitId, date }) => habitId === habit.id && date === third),
    label: value ? `${value} ${habit.unit}` : habit.tinyRestart ??
      (missed.length === 1 && !habit.thresholds ? 'Try a two-minute version' : 'Take the smallest step you can'),
  };
}

export type Recovery = NonNullable<ReturnType<typeof recoveryFor>>;

export type PhoneCompletion = { id: string; habitId: string; date: string; recordedAt?: number };

export function applyPhoneCompletions(data: AppData, actions: PhoneCompletion[]) {
  const receipts = new Set(data.phoneReceipts ?? []);
  const sessions = sessionKeys(data);
  let next = data;
  for (const action of actions) {
    if (receipts.has(action.id)) continue;
    const habit = next.habits.find((candidate) => candidate.id === action.habitId);
    const alreadyLogged = next.logs.some((log) => log.id === logKey(action.habitId, action.date));
    if (habit?.trackingType === 'checkbox' && !alreadyLogged && plannedFor(habit, action.date, sessions)) {
      next = writeLog(next, habit.id, action.date, { status: 'done', value: 1 }, action.recordedAt ? new Date(action.recordedAt) : null);
    }
    receipts.add(action.id);
  }
  return { ...next, phoneReceipts: [...receipts].slice(-500) };
}
