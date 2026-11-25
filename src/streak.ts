import { scoringHistory } from './budget-coach.ts';
import { scoringPaused, shiftDate, type AppData } from './model.ts';

export const streakMilestones = [3, 7, 14, 30, 60, 100] as const;
/** Every 7 counted days earn one freeze; at most this many wait in the bank. */
export const maxFreezes = 2;

export type StreakDay = { date: string; state: 'done' | 'frozen' | 'missed' | 'rest' | 'pending' | 'paused' | 'none' };

/**
 * A day counts when Sparky ends it at least so-so (70% of habits, or the part-week allowance).
 * Days with nothing due are neutral. A missed day spends a banked freeze if there is one, otherwise the streak resets.
 * Today never breaks the streak; it only adds once it already counts.
 */
export function streakInfo(data: AppData, today: string) {
  let streak = 0;
  let best = 0;
  let freezes = 0;
  const week: StreakDay[] = Array.from({ length: 7 }, (_, i) => ({ date: shiftDate(today, i - 6), state: 'none' }));
  // Before the first recorded effort the streak and freeze bank are both empty.
  let first = week[0].date;
  for (const log of data.logs) if (log.date < first) first = log.date;
  for (const log of data.smallWins?.log ?? []) if (log.date < first) first = log.date;
  const from = first < data.planStart ? data.planStart : first;
  for (const day of scoringHistory(data, from, today, true)) {
    let state: StreakDay['state'];
    if (scoringPaused(data, day.date)) state = 'paused';
    else if ((day.done || day.bonus) && (day.pose === 'proud' || day.pose === 'so-so')) {
      streak++;
      best = Math.max(best, streak);
      if (streak % 7 === 0) freezes = Math.min(maxFreezes, freezes + 1);
      state = 'done';
    } else if (day.date === today) state = 'pending';
    else if (!day.total) state = 'rest';
    else if (freezes > 0) {
      freezes--;
      state = 'frozen';
    } else {
      streak = 0;
      state = 'missed';
    }
    if (day.date >= week[0].date) week.find(({ date }) => date === day.date)!.state = state;
  }
  const todayCounts = week[6].state === 'done';
  const paused = scoringPaused(data, today);
  return { streak, best, freezes, todayCounts, paused, week, nextMilestone: streakMilestones.find((goal) => goal > streak) };
}

export type FlameTier = { min: number; color: string; name: string };
export const flameTiers: FlameTier[] = [
  { min: 100, color: '#c58cff', name: 'Legendary' }, { min: 30, color: '#6cc7ff', name: 'Blue flame' },
  { min: 7, color: '#ffc94d', name: 'Golden' }, { min: 3, color: '#ff9a3d', name: 'Warm' }, { min: 1, color: '#ff7a45', name: 'Lit' },
];
export const flameTier = (days: number) => flameTiers.find(({ min }) => days >= min);
