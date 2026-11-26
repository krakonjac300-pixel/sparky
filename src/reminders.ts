import { dueHabits, localDate, sessionKeys, shiftDate, type AppData, type Habit, type HabitLog } from './model.ts';
import { prioritiesFor, reaches } from './planning.ts';

function accountedFor(habit: Habit, log?: HabitLog, useMinimum = false) {
  if (!log) return false;
  if (log.status === 'rest' || log.status === 'skipped') return true;
  if (habit.trackingType === 'avoid' && log.trackingType === 'avoid') return true;
  return log.status === 'restart' || log.restart === true || reaches(habit, log, useMinimum);
}

export function unfinishedToday(data: AppData, date: string) {
  const logs = new Map(data.logs.filter((log) => log.date === date).map((log) => [log.habitId, log]));
  const minimums = new Set(prioritiesFor(data, date).filter((entry) => entry.minimum).map((entry) => entry.habitId));
  return dueHabits(data.habits, date, sessionKeys(data)).filter((habit) => !accountedFor(habit, logs.get(habit.id), minimums.has(habit.id)));
}

export function suggestedReminder(data: AppData, habitId: string, today: string) {
  const habit = data.habits.find((item) => item.id === habitId);
  if (!habit || habit.onceOn || habit.trackingType === 'avoid') return undefined;
  const earliest = shiftDate(today, -29);
  const minutes = data.logs.filter((log) => log.habitId === habitId && log.date >= earliest && log.date <= today &&
    !log.imported && !log.restart && reaches(habit, log, false)).sort((a, b) => b.date.localeCompare(a.date)).flatMap((log) => {
    if (log.completionMinute !== undefined) return log.completionMinute === null ? [] : [log.completionMinute];
    const recorded = new Date(log.timestamp);
    return localDate(recorded) === log.date ? [recorded.getHours() * 60 + recorded.getMinutes()] : [];
  }).slice(0, 7);
  // Find a majority within one hour, allowing routines on either side of midnight.
  const clusters = minutes.map((start) => minutes.map((minute) => (minute - start + 1440) % 1440)
    .filter((offset) => offset <= 60).sort((a, b) => a - b).map((offset) => start + offset));
  const best = clusters.sort((a, b) => b.length - a.length || (a.at(-1)! - a[0]) - (b.at(-1)! - b[0]))[0];
  if (!best || best.length < Math.max(3, Math.ceil(minutes.length * 2 / 3))) return undefined;
  const middle = Math.floor(best.length / 2);
  const median = Math.round((best[middle] + best[Math.floor((best.length - 1) / 2)]) / 2) % 1440;
  return clockTime(median);
}

function clockTime(minute: number) {
  return [Math.floor(minute / 60), minute % 60].map((part) => String(part).padStart(2, '0')).join(':');
}

export function beforeRoutine(time: string, lead: number) {
  const [hours, minutes] = time.split(':').map(Number);
  return clockTime(Math.max(0, hours * 60 + minutes - lead));
}

function permittedTime(time: string | undefined, controls: AppData['reminderControls']) {
  if (!time || controls?.disabled) return undefined;
  const from = controls?.quietFrom, through = controls?.quietThrough;
  if (!from || !through || from === through) return time;
  const quiet = from < through ? time >= from && time < through : time >= from || time < through;
  return quiet ? undefined : time;
}

export function learnedReminderText(routine: string | undefined, lead: number, controls?: AppData['reminderControls']) {
  if (controls?.disabled) return 'Habit reminders are turned off in Settings.';
  if (!routine) return `Learning from your check-ins. Until then Sparky checks at ${learningReminder} if it is still open.`;
  const time = beforeRoutine(routine, lead);
  const prefix = `Usually logged around ${routine}.`;
  if (!permittedTime(time, controls)) {
    return `${prefix} The ${time} reminder falls in quiet hours (${controls?.quietFrom} to ${controls?.quietThrough}) and will be skipped.`;
  }
  const [hour, minute] = routine.split(':').map(Number);
  const detail = hour * 60 + minute < lead ? ' The reminder stays on the scheduled day, so the lead is shorter.' : '';
  return `${prefix} Reminder at ${time} on scheduled days.${detail}`;
}

/** Minutes before the usual finish time when Sparky reminds, for habits with no reminder of their own. */
export const adaptiveLead = 30;
/** Until Sparky has learned when a habit usually gets done, he checks on it once in the late afternoon. */
export const learningReminder = '18:00';

/** The lead Sparky uses for a habit: its own choice, or the adaptive default when it has no fixed time. */
export function reminderLead(habit: Habit, data: AppData) {
  if (habit.learnedLead) return habit.learnedLead;
  if (habit.reminderTime || data.reminder || habit.onceOn || habit.trackingType === 'avoid') return undefined;
  return adaptiveLead;
}

export function reminderPlan(data: AppData, today: string) {
  const controls = data.reminderControls;
  const permitted = (time?: string) => permittedTime(time, controls);
  const logs = new Map<string, typeof data.logs>();
  const earliest = shiftDate(today, -1);
  for (const entry of data.logs) {
    if (entry.date < earliest) continue;
    const entries = logs.get(entry.habitId) ?? [];
    entries.push(entry);
    logs.set(entry.habitId, entries);
  }
  const daily = new Map((data.priorities ?? []).map((day) => [day.date, day.items]));
  return [...data.habits].sort((a, b) => a.sortOrder - b.sortOrder).flatMap((habit) => {
    if (habit.archivedAt) return [];
    const lead = reminderLead(habit, data);
    const routine = lead && suggestedReminder(data, habit.id, today);
    const time = permitted(lead ? (routine ? beforeRoutine(routine, lead) : learningReminder)
      : habit.reminderTime ?? data.reminder);
    const extraTime = permitted(habit.extraReminderTime);
    const dates = (logs.get(habit.id) ?? []).filter((log) => accountedFor(habit, log,
      daily.get(log.date)?.some((item) => item.habitId === habit.id && item.minimum))).map((log) => log.date);
    const since = habit.pauseThrough && habit.pauseThrough >= habit.createdDate ? shiftDate(habit.pauseThrough, 1) : habit.createdDate;
    const rule = { id: habit.id, title: habit.title, days: habit.days, since, time, extraTime, notificationsDisabled: controls?.disabled,
      quietFrom: controls?.quietFrom, quietThrough: controls?.quietThrough,
      avoid: habit.trackingType === 'avoid', checkbox: habit.trackingType === 'checkbox', accountedFor: dates,
      extraDates: habit.onceOn ? [] : (data.eveningPlans ?? []).filter((plan) => plan.habitId === habit.id && plan.date >= earliest).map((plan) => plan.date),
      committedDates: habit.onceOn ? [habit.onceOn] : habit.weeklyTarget ? (data.weeklySessions ?? []).filter((item) => item.habitId === habit.id && item.date >= earliest)
        .map((item) => item.date) : undefined,
      priorityDates: (data.priorities ?? []).filter((day) => day.date >= today && day.items.some((item) => item.habitId === habit.id)).map((day) => day.date),
    };
    return [{ ...rule, kind: 'habit', message: (routine ? `You usually finish this around ${routine}.` : undefined) as string | undefined }, ...(habit.replacement?.time
      ? [{ ...rule, kind: 'replacement', time: permitted(habit.replacement.time), extraTime: undefined, message: habit.replacement.action }] : [])];
  });
}
