import { achievement, calendarDate, localDate, scoringPaused, plannedFor, sessionKeys, logKey, shiftDate, type AppData, type Habit, type HabitLog } from './model.ts';

export const periods = ['Day', 'Week', 'Month', 'Quarter', '6 months', 'Year'] as const;
export type Period = typeof periods[number];

export function periodStart(anchor: string, period: Period, offset = 0) {
  if (period === 'Day') return shiftDate(anchor, offset);
  const date = calendarDate(anchor);
  if (period === 'Week') return shiftDate(anchor, offset * 7 - ((date.getDay() + 6) % 7));
  const months = { Month: 1, Quarter: 3, '6 months': 6, Year: 12 }[period];
  date.setMonth((Math.floor(date.getMonth() / months) + offset) * months, 1);
  return localDate(date);
}

export function periodDates(anchor: string, period: Period, offset = 0) {
  const first = calendarDate(periodStart(anchor, period, offset));
  const until = calendarDate(periodStart(anchor, period, offset + 1));
  const dates: string[] = [];
  for (const day = first; day < until; day.setDate(day.getDate() + 1)) dates.push(localDate(day));
  return dates;
}

export function phonePeriodDates(anchor: string, period: Period | 'Today', offset = 0) {
  return periodDates(anchor, period === 'Today' ? 'Day' : period, offset);
}

export function makeReport(data: AppData, end: string, days: number, today = end) {
  const dates = Array.from({ length: days }, (_, index) => shiftDate(end, index + 1 - days));
  const logs = new Map(data.logs.map((log) => [logKey(log.habitId, log.date), log]));
  const sessions = sessionKeys(data);
  const byArea = new Map(data.categories.map((area) => [area.id, { name: area.name, planned: 0, hit: 0 }]));
  const byHabit = new Map<string, { title: string; planned: number; hit: number; rest: number }>();
  const revisions = new Map<string, { date: string; habit: Habit }[]>();
  for (const plan of data.plans) {
    const entries = revisions.get(plan.habit.id) ?? [];
    entries.push(plan);
    revisions.set(plan.habit.id, entries);
  }
  for (const entries of revisions.values()) entries.sort((a, b) => b.date.localeCompare(a.date));

  const levelFor = (habit: Habit, log?: HabitLog) => {
    if (log?.status === 'slipped' && log.slip === 'little' && habit.trackingType === 'avoid') return 'minimum';
    if (log?.status !== 'done' || (log.trackingType && log.trackingType !== habit.trackingType) || log.unit !== habit.unit) return undefined;
    return achievement(habit, log.value);
  };
  const isCovered = (date: string) => date >= data.planStart;
  const daily = dates.map((date) => {
    const stats = { date, covered: isCovered(date), planned: 0, hit: 0, minimum: 0, rest: 0 };
    if (!stats.covered || scoringPaused(data, date)) return stats;
    for (const entries of revisions.values()) {
      const habit = entries.find((rule) => rule.date <= date)?.habit;
      if (!habit || !plannedFor(habit, date, sessions)) continue;
      const log = logs.get(logKey(habit.id, date));
      const own = byHabit.get(habit.id) ?? { title: habit.title, planned: 0, hit: 0, rest: 0 };
      byHabit.set(habit.id, own);
      if (log?.status === 'rest') { stats.rest++; own.rest++; continue; }
      const area = byArea.get(habit.categoryId);
      stats.planned++;
      own.planned++;
      if (area) area.planned++;
      const level = levelFor(habit, log);
      if (level === 'minimum' || level === 'target' || level === 'stretch') stats.minimum++;
      if (level === 'target' || level === 'stretch') {
        stats.hit++;
        own.hit++;
        if (area) area.hit++;
      }
    }
    return stats;
  });

  const inPeriod = ({ date }: { date: string }) => date >= dates[0] && date <= end;
  const checkIns = data.checkIns.filter(inPeriod);
  const sleep = data.sleep.filter(inPeriod);
  const focus = (data.focusHistory ?? []).filter(inPeriod);
  const steps = (data.steps ?? []).filter(inPeriod);
  const exercise = (data.exercise ?? []).filter(inPeriod);
  const distance = (data.distance ?? []).filter(inPeriod);
  const actions = data.logs.filter((log) => inPeriod(log) && log.status === 'done').length;
  const minutes = data.logs.filter((log) => inPeriod(log) && log.status === 'done' &&
    (log.trackingType === 'minutes' || (!log.trackingType && log.unit === 'min'))).reduce((sum, log) => sum + log.value, 0);
  const minimum = daily.reduce((total, day) => total + day.minimum, 0);
  const planned = daily.reduce((total, day) => total + day.planned, 0);
  const hit = daily.reduce((total, day) => total + day.hit, 0);
  let streak = 0;
  for (const day of [...daily].reverse()) {
    if (!day.covered) break;
    if (day.planned === 0 || (day.date === today && day.hit < day.planned)) continue;
    if (day.hit < day.planned) break;
    streak++;
  }
  const average = (numbers: number[]) => numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : undefined;
  let longest = 0;
  let run = 0;
  for (const day of daily) {
    if (!day.covered || !day.planned) continue;
    run = day.hit === day.planned ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return {
    from: dates[0], end, daily, planned, hit, minimum, actions, minutes, streak, longest, checkIns, sleep, focus, steps, exercise, distance,
    focusMinutes: focus.reduce((total, entry) => total + entry.seconds, 0) / 60,
    averageSteps: average(steps.map((entry) => entry.steps)),
    exerciseMinutes: exercise.reduce((total, entry) => total + entry.value, 0),
    distanceKm: distance.reduce((total, entry) => total + entry.value, 0),
    rate: planned ? Math.round(100 * hit / planned) : undefined,
    areas: [...byArea.values()].filter((area) => area.planned),
    habits: [...byHabit.values()].filter((habit) => habit.planned),
    mood: average(checkIns.map((entry) => entry.mood)), energy: average(checkIns.map((entry) => entry.energy)),
    sleepAverage: average(sleep.map((entry) => entry.minutes)),
  };
}

export function minutesLabel(minutes: number) {
  const whole = Math.round(minutes);
  return `${Math.floor(whole / 60)} h ${whole % 60} min`;
}
