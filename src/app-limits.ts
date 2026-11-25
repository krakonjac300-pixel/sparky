import { type AppData, type AppLimit, type ScreenDay } from './model.ts';

export type LimitApp = Pick<AppLimit, 'id' | 'name'>;

export function latestAppLimitChange(limit: AppLimit, date: string) {
  let latest: AppLimit['changes'][number] | undefined;
  for (const change of limit.changes) {
    if (change.date <= date && (!latest || change.date > latest.date)) latest = change;
  }
  return latest;
}

export function appLimitForDay(limit: AppLimit, date: string) {
  const change = latestAppLimitChange(limit, date);
  return change && change.minutes !== null ? { ...change, minutes: change.minutes } : undefined;
}

export function saveAppLimit(data: AppData, app: LimitApp, date: string, minutes: number | null, apps?: LimitApp[]): AppData {
  const limits = data.appLimits ?? [];
  const previous = limits.find((limit) => limit.id === app.id);
  const latest = previous && latestAppLimitChange(previous, date);
  const resumeMinutes = minutes === null ? latest?.minutes ?? latest?.resumeMinutes : undefined;
  const change = { date, minutes, ...(apps ? { apps } : {}), ...(resumeMinutes !== undefined ? { resumeMinutes } : {}) };
  const changes = [...(previous?.changes ?? []).filter((entry) => entry.date !== date), change];
  return { ...data, appLimits: [...limits.filter((limit) => limit.id !== app.id), { ...app, changes }] };
}

export function checkAppLimit(id: string, minutes: number, day?: ScreenDay, apps?: LimitApp[]) {
  if (!day) return undefined;
  const ids = new Set(apps?.map((app) => app.id) ?? [id]);
  const used = day.apps.reduce((seconds, app) => seconds + (ids.has(app.id) ? app.seconds : 0), 0);
  const remaining = minutes * 60 - used;
  const state = remaining < 0 ? 'over' : remaining === 0 ? 'at' : 'under';
  return { used, remaining, state } as const;
}

export function countAppLimitDays(limit: AppLimit, dates: string[], today: string, usage: Map<string, ScreenDay>) {
  let active = false;
  let within = 0;
  let over = 0;
  for (const date of dates) {
    if (date > today) continue;
    const change = appLimitForDay(limit, date);
    if (!change) continue;
    active = true;
    if (date === today) continue;
    const result = checkAppLimit(limit.id, change.minutes, usage.get(date), change.apps);
    if (result?.state === 'over') over++;
    else if (result) within++;
  }
  return { active, within, over };
}
