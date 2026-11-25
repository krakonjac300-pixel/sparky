import { calendarDate, localDate, shiftDate, type AppData, type Habit } from './model.ts';
import { prioritiesFor, reaches } from './planning.ts';
import { unfinishedToday } from './reminders.ts';

export type TimeBlock = { start: number; end: number };
export type EveningPlan = NonNullable<AppData['eveningPlans']>[number];

export function carryHabit(data: AppData, today: string) {
  const unfinished = unfinishedToday(data, today).filter((habit) => habit.trackingType !== 'avoid' &&
    !reaches(habit, data.logs.find((log) => log.habitId === habit.id && log.date === today), true));
  for (const priority of prioritiesFor(data, today)) {
    const habit = unfinished.find((item) => item.id === priority.habitId);
    if (habit) return habit;
  }
  return unfinished.sort((a, b) => a.sortOrder - b.sortOrder)[0];
}

export function freeSlot(date: string, habit: Habit, busy: TimeBlock[]): TimeBlock | undefined {
  const morning = calendarDate(date);
  morning.setHours(8, 0, 0, 0);
  const evening = calendarDate(date);
  evening.setHours(20, 0, 0, 0);
  const duration = (habit.trackingType === 'minutes' ? habit.thresholds!.target : 15) * 60000;
  for (let start = morning.getTime(); start + duration <= evening.getTime(); start += 15 * 60000) {
    const end = start + duration;
    if (busy.every((event) => event.end <= start || event.start >= end)) return { start, end };
  }
}

export function reserveSlot(data: AppData, today: string, plan: EveningPlan, previous?: EveningPlan): AppData {
  const existing = data.eveningPlans?.find((item) => item.date === plan.date);
  if (localDate() !== today || plan.date !== shiftDate(today, 1) || localDate(new Date(plan.start)) !== plan.date ||
    plan.end <= plan.start || localDate(new Date(plan.end - 1)) !== plan.date ||
    (previous?.habitId ?? carryHabit(data, today)?.id) !== plan.habitId) throw new Error('Your day changed. Check the evening suggestion again.');
  if (previous) {
    if (!existing || existing.start !== previous.start || existing.end !== previous.end || existing.habitId !== previous.habitId)
      throw new Error('Your saved plan changed. Reopen it to choose a time.');
    return { ...data, eveningPlans: data.eveningPlans!.map((item) => item.date === plan.date ? plan : item) };
  }
  if (existing) throw new Error('You already have a plan for tomorrow.');
  return { ...data, eveningPlans: [...(data.eveningPlans ?? []), plan] };
}
