import { appLimitForDay, checkAppLimit, countAppLimitDays } from './app-limits.ts';
import { smallWinsAsHabit } from './small-wins.ts';
import { calendarDate, localDate, plannedFor, scoringPaused, sessionKeys, shiftDate, type AppData } from './model.ts';
import { reaches, weeklyProgress } from './planning.ts';
import { phonePeriodDates } from './reports.ts';
import { type TurtlePose } from './turtle-motion.ts';

export function activeBudgets(data: AppData, date: string) {
  return (data.appLimits ?? []).flatMap((limit) => {
    const change = appLimitForDay(limit, date);
    return change ? [{ limit, change }] : [];
  }).sort((a, b) => Number(!!b.change.apps) - Number(!!a.change.apps) || a.limit.name.localeCompare(b.limit.name) || a.limit.id.localeCompare(b.limit.id));
}

type Budget = ReturnType<typeof activeBudgets>[number];

function preferredBudget(data: AppData, budgets: Budget[]) {
  return budgets.find(({ limit }) => limit.id === data.budgetCoach?.limitId) ?? budgets[0];
}

function planFor(data: AppData, { limit, change }: Budget) {
  return { id: limit.id, name: limit.name, from: change.date, seconds: change.minutes * 60,
    apps: change.apps?.map(({ id }) => id) ?? [limit.id], headsUp: data.budgetCoach?.headsUp === true };
}

export function budgetPlan(data: AppData, today: string) {
  const selected = preferredBudget(data, activeBudgets(data, today));
  return selected ? planFor(data, selected) : null;
}

export function budgetCoachStatus(data: AppData, today: string) {
  const budgets = activeBudgets(data, today);
  const current = preferredBudget(data, budgets);
  if (!current) return undefined;
  const { limit } = current;
  const days = new Map((data.screenTime ?? []).map((day) => [day.date, day]));
  const todayUsage = days.get(today);
  const checked = budgets.map(({ limit, change }) => ({ limit, result: checkAppLimit(limit.id, change.minutes, todayUsage, change.apps) }));
  const progress = checked.find((item) => item.limit.id === limit.id)?.result;
  const over = checked.flatMap(({ limit: { id, name }, result }) => result?.state === 'over' ? [{ id, name, seconds: -result.remaining }] : []);
  const exceeded = over.find(({ id }) => id === limit.id) ?? over[0];
  const yesterday = shiftDate(today, -1);
  const previous = appLimitForDay(limit, yesterday);
  const result = previous && checkAppLimit(limit.id, previous.minutes, days.get(yesterday), previous.apps);
  const week = countAppLimitDays(limit, phonePeriodDates(today, 'Week'), today, days);
  const reset = data.budgetCoach?.lastReset;
  return { plan: planFor(data, current), progress, exceeded, week, yesterdayWithin: !!result && result.state !== 'over',
    resetDone: reset?.date === today && reset.limitId === (exceeded?.id ?? limit.id) };
}

function habitReview(data: AppData, date: string, weekday: number, weekLogs?: AppData['logs']) {
  const latest = new Map<string, AppData['plans'][number]>();
  for (const revision of data.plans) {
    const previous = latest.get(revision.habit.id);
    if (revision.date <= date && (!previous || revision.date > previous.date)) latest.set(revision.habit.id, revision);
  }
  const sessions = sessionKeys(data);
  const logs = new Map(data.logs.filter((log) => log.date === date).map((log) => [log.habitId, log]));
  const missed: Pick<AppData['habits'][number], 'title' | 'days' | 'weeklyTarget'>[] = [];
  /** Avoid habits that slipped (beyond a little): a miss that is settled, nothing left to finish. */
  const slipped: AppData['habits'] = [];
  const weekly: { id: string; title: string; count: number; target: number; avoid: boolean }[] = [];
  let done = 0;
  let bonus = 0;
  for (const { habit } of latest.values()) {
    if (date < data.planStart || habit.archivedAt || habit.createdDate > date || (habit.pauseThrough && date <= habit.pauseThrough)) continue;
    if (habit.weeklyTarget) weekly.push({ id: habit.id, title: habit.title, target: habit.weeklyTarget,
      count: weekLogs ? weekLogs.filter((log) => log.habitId === habit.id && reaches(habit, log, false)).length : weeklyProgress(data, habit, date, date), avoid: habit.trackingType === 'avoid' });
    const log = logs.get(habit.id);
    const complete = log?.status === 'restart' || log?.restart || reaches(habit, log, true);
    if (plannedFor(habit, date, sessions, weekday)) {
      if (log?.status === 'rest') continue;
      if (complete) done++;
      else if (habit.trackingType === 'avoid' && log?.status === 'slipped') slipped.push(habit);
      else missed.push(habit);
    } else if (habit.weeklyTarget && complete) bonus++;
  }
  const wins = smallWinsAsHabit(data, date);
  if (wins.reached) done++;
  else if (wins.counted) missed.push({ title: `Small wins (${wins.needed} of ${wins.total})`, days: [0, 1, 2, 3, 4, 5, 6] });
  return { done, total: done + missed.length + slipped.length, missed, slipped, bonus, weekly };
}

export function turtleHabitProgress(data: AppData, date: string) {
  const { done, total } = habitReview(data, date, calendarDate(date).getDay());
  return { done, total };
}

export function dayReaction(data: AppData, date: string, finished: boolean, weekday = calendarDate(date).getDay(), weekLogs?: AppData['logs']) {
  const { done, total, missed, slipped, bonus, weekly } = habitReview(data, date, weekday, weekLogs);
  const weeklyMet = weekly.filter(({ count, target }) => count >= target).length;
  const weeklyShort = finished && weekday === 0 && weeklyMet < weekly.length;
  const misses = [...missed, ...slipped];
  const budgets = activeBudgets(data, date);
  const usage = data.screenTime?.find((day) => day.date === date);
  let slightOver = false;
  let overLimit = '';
  for (const { limit, change } of budgets) {
    const checked = checkAppLimit(limit.id, change.minutes, usage, change.apps);
    if (checked?.state !== 'over') continue;
    if (-checked.remaining * 10 > change.minutes * 60) overLimit = limit.name;
    else slightOver = true;
  }
  const mostDone = done * 10 >= total * 7;
  const partWeekAllowance = misses.length > 0 && misses.length <= 2 && done * 2 >= total &&
    misses.every((habit) => habit.weeklyTarget ? habit.weeklyTarget < 7 : habit.days.length < 7);
  const allDone = done === total;
  let pose: TurtlePose | undefined;
  const emptyWeek = weeklyShort && !done && !bonus && weekly.every(({ count }) => count === 0);
  if (overLimit || emptyWeek || (finished && !mostDone && !partWeekAllowance)) pose = 'disappointed';
  else if ((slightOver && mostDone) || (finished && !allDone) || weeklyShort) pose = 'so-so';
  else if (slightOver) pose = 'ready';
  else if (allDone && (total > 0 || bonus > 0 || weeklyMet > 0 || (finished && usage && budgets.length > 0)) && (budgets.length === 0 || usage)) pose = 'proud';
  if (scoringPaused(data, date)) pose = undefined;
  return { date, done, total, pose, missed, slipped, bonus, weekly, weeklyShort, slightOver, overLimit, partWeekAllowance };
}

/** Hour of day after which Sparky stops showing yesterday's verdict and judges today only. */
export const sparkyResetHour = 12;

/** The line on Sparky's card that states tonight's rule before the evening check. */
export function sparkyBar(done: number, total: number, hour: number) {
  if (!total || done >= total) return undefined;
  const needed = Math.ceil(total * 0.7);
  const time = `${String(hour).padStart(2, '0')}:00`;
  return done >= needed ? `Bar met. All ${total} by ${time} makes him proud.` : `Sparky's bar tonight: ${needed} of ${total} by ${time}`;
}

export function dailyTurtleReaction(data: AppData, today: string, resetDone = false, reviewing = false, morning = true) {
  const current = dayReaction(data, today, reviewing);
  const yesterday = dayReaction(data, shiftDate(today, -1), true);
  const todayDone = current.done + current.bonus;
  const yesterdayMissed = scoringPaused(data, yesterday.date) ? 0 : yesterday.missed.length + yesterday.slipped.length;
  // Yesterday's verdict carries over only in the morning, until something happens today.
  const reaction = scoringPaused(data, today) || !morning || reviewing || current.pose || todayDone > 0 || !yesterday.pose ? current : yesterday;
  const pose = reaction.pose ?? 'ready';
  const key = reviewing ? `${today}-review-${pose}` : `${reaction.date}-${pose}`;
  return { ...reaction, pose, key, todayDone, todayWeekly: current.weekly, yesterdayMissed,
    comeback: !scoringPaused(data, today) && yesterdayMissed > 0 && todayDone > 0, resetDone };
}

function byDate<T extends { date: string }>(rows: T[], from: string, through: string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (row.date < from || row.date > through) continue;
    const bucket = map.get(row.date);
    if (bucket) bucket.push(row);
    else map.set(row.date, [row]);
  }
  return map;
}

/** Replay revisions in order and give the daily scorer only the records it needs. */
export function* scoringHistory(data: AppData, from: string, through: string, finishToday: boolean) {
  const monday = shiftDate(from, -((calendarDate(from).getDay() + 6) % 7));
  const logs = byDate(data.logs, monday, through);
  const usage = byDate(data.screenTime ?? [], from, through);
  const sessions = byDate(data.weeklySessions ?? [], from, through);
  const evenings = byDate(data.eveningPlans ?? [], from, through);
  const revisions = [...data.plans].sort((a, b) => a.date.localeCompare(b.date));
  const latest = new Map<string, AppData['plans'][number]>();
  const changes = (data.appLimits ?? []).flatMap((limit) => limit.changes.map((change) => ({ limit, change })))
    .sort((a, b) => a.change.date.localeCompare(b.change.date));
  const limits = new Map<string, NonNullable<AppData['appLimits']>[number]>();
  let limitRevision = 0;
  let revision = 0;
  let weekLogs: AppData['logs'] = [];
  const slice = { ...data };
  const cursor = calendarDate(monday);
  for (let date = monday; date <= through; cursor.setDate(cursor.getDate() + 1), date = localDate(cursor)) {
    const weekday = cursor.getDay();
    if (weekday === 1) weekLogs = [];
    for (const log of logs.get(date) ?? []) weekLogs.push(log);
    if (date < from) continue;
    while (revision < revisions.length && revisions[revision].date <= date) {
      const plan = revisions[revision++];
      latest.set(plan.habit.id, plan);
    }
    while (limitRevision < changes.length && changes[limitRevision].change.date <= date) {
      const { limit, change } = changes[limitRevision++];
      if (change.minutes === null) limits.delete(limit.id);
      else limits.set(limit.id, { ...limit, changes: [change] });
    }
    slice.appLimits = [...limits.values()];
    slice.plans = [...latest.values()];
    slice.logs = logs.get(date) ?? [];
    slice.weeklySessions = sessions.get(date);
    slice.eveningPlans = evenings.get(date);
    slice.screenTime = usage.get(date);
    yield dayReaction(slice, date, finishToday || date !== through, weekday, weekLogs);
  }
}

export type SparkyDay = NonNullable<AppData['sparkyDays']>[number];

/** Refresh the optional legacy snapshots for callers that export them. */
export function withSparkyDays(data: AppData, today: string): AppData {
  const start = shiftDate(today, -30);
  const days: SparkyDay[] = [];
  for (const day of scoringHistory(data, start < data.planStart ? data.planStart : start, shiftDate(today, -2), true)) {
    if (!scoringPaused(data, day.date)) days.push({ date: day.date, pose: day.pose ?? 'ready', done: day.done, total: day.total });
  }
  const old = data.sparkyDays ?? [];
  if (old.length === days.length && days.every((day, i) => old[i].date === day.date && old[i].pose === day.pose &&
    old[i].done === day.done && old[i].total === day.total)) return data;
  return { ...data, sparkyDays: days };
}

export function sparkyHistory(data: AppData, today: string, count = 14) {
  if (count <= 0) return [];
  return Array.from(scoringHistory(data, shiftDate(today, 1 - count), today, false), (day) => {
    if (day.date < data.planStart || scoringPaused(data, day.date)) return { date: day.date, pose: undefined };
    return { date: day.date, pose: day.pose ?? (day.date === today ? undefined : 'ready'), done: day.done, total: day.total };
  });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What it takes, right now, to make Sparky proud tonight. */
export function sparkyTarget(data: AppData, today: string) {
  const day = dayReaction(data, today, true);
  if (scoringPaused(data, today)) return 'Scoring is paused today.';
  if (day.overLimit) return `You're over your ${day.overLimit} limit, so Sparky can't be proud today. Finishing your habits still helps.`;
  if (day.weeklyShort) return 'It’s the last day of the week. Open weekly goals affect Sparky’s evening mood.';
  if (!day.total) return '';
  const left = day.total - day.done - day.slipped.length;
  if (left <= 0 && day.slipped.length) return `Nothing left to do today. ${day.slipped.map(({ title }) => title).join(', ')} slipped, so Sparky can't be proud today, but he counts everything you did.`;
  if (left > 0 && day.slipped.length) {
    const forSoSo = Math.ceil(day.total * 0.7) - day.done;
    return forSoSo > 0 && forSoSo <= left ? `${plural(forSoSo, 'more habit')} for a so-so Sparky today.` : `${plural(left, 'more habit')} left today.`;
  }
  if (left > 0) {
    const forSoSo = Math.ceil(day.total * 0.7) - day.done;
    const wins = day.missed.some(({ title }) => title.startsWith('Small wins')) ? ' Small wins count as one.' : '';
    return (forSoSo > 0 && forSoSo < left
      ? `${plural(forSoSo, 'more habit')} for a so-so Sparky, ${left} to make him proud.`
      : `${plural(left, 'more habit')} to make Sparky proud tonight.`) + wins;
  }
  if (day.slightOver) return 'All habits done. You are a little over an app limit, so Sparky is so-so.';
  return 'All habits done. Sparky is proud of you.';
}

/** The summary Android uses to post Sparky's evening check while Sparky is closed. */
export function eveningSummary(data: AppData, today: string) {
  const day = dayReaction(data, today, true);
  return { date: today, streakPaused: scoringPaused(data, today), hour: data.budgetCoach?.reviewHour ?? 21, done: day.done, total: day.total,
    livePose: dayReaction(data, today, false).pose ?? 'ready',
    pose: day.pose ?? 'ready', missed: day.missed.slice(0, 4).map((habit) => habit.title), overLimit: day.overLimit,
    /** Habits that can still be done today; a settled slip is not one of them. */
    open: day.missed.length };
}
