import { z } from 'zod';
import { guideKeys, programLevels } from './program-guide.ts';

export const weekdays = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun'],
] as const;

export function localDate(date = new Date()) {
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function calendarDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function recentDates(today: string) {
  return Array.from({ length: 7 }, (_, index) => shiftDate(today, -index));
}

export function shiftDate(key: string, days: number) {
  const date = calendarDate(key);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((key) => localDate(calendarDate(key)) === key);
const timestamp = z.string().datetime();
const reminderTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.string().min(1).max(100);
const order = z.number().int().nonnegative();
const rating = z.number().int().min(1).max(5);
export const icons = ['activity', 'book', 'heart', 'leaf', 'users', 'briefcase', 'compass'] as const;
const categorySchema = z.object({
  id, name: z.string().trim().min(1).max(60), icon: z.enum(icons),
  sortOrder: order, color: z.string().regex(/^#[0-9a-f]{6}$/i),
  parentId: id.optional(),
});

const trackingType = z.enum(['checkbox', 'minutes', 'count', 'avoid', 'measurement', 'rating']);
const healthSource = z.enum(['steps', 'sleep', 'exercise', 'distance']);
const thresholds = z.object({
  minimum: z.number().positive().max(100000),
  target: z.number().positive().max(100000),
  stretch: z.number().positive().max(100000),
}).refine((levels) => levels.minimum <= levels.target && levels.target <= levels.stretch);

export const habitSchema = z.object({
  id, categoryId: id, title: z.string().trim().min(1).max(80), description: z.string().trim().max(240).optional(),
  trackingType, unit: z.string().max(18),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine((days) => new Set(days).size === days.length),
  thresholds: thresholds.optional(), createdAt: timestamp, createdDate: dateKey, archivedAt: timestamp.optional(),
  reminderTime: reminderTime.optional(),
  learnedLead: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  extraReminderTime: reminderTime.optional(),
  weeklyTarget: z.number().int().min(1).max(7).optional(),
  onceOn: dateKey.optional(),
  pauseThrough: dateKey.optional(),
  afterHabitId: id.optional(),
  healthSource: healthSource.optional(),
  restartFrom: dateKey.optional(), restartDisabled: z.boolean().optional(), tinyRestart: z.string().trim().min(1).max(140).optional(),
  consequence: z.string().trim().min(1).max(140).optional(),
  replacement: z.object({ cue: z.string().trim().min(1).max(140), action: z.string().trim().min(1).max(140),
    time: reminderTime.optional() }).optional(),
  sortOrder: order,
  /** Avoid habits only: what to count when you slip (e.g. beers), up to `little` is a little, `lot` or more is a lot. */
  slipCount: z.object({ unit: z.string().trim().min(1).max(18), little: z.number().int().min(1).max(1000), lot: z.number().int().min(2).max(1000) })
    .refine((count) => count.little < count.lot).optional(),
}).refine((habit) => (habit.trackingType === 'checkbox' || habit.trackingType === 'avoid') === (habit.thresholds === undefined))
  .refine((habit) => !habit.slipCount || habit.trackingType === 'avoid')
  .refine((habit) => !habit.onceOn || (!habit.weeklyTarget && habit.onceOn >= habit.createdDate))
  .refine((habit) => !habit.healthSource || (habit.healthSource === 'steps' ? habit.trackingType === 'count' && habit.unit === 'steps' :
    habit.healthSource === 'distance' ? habit.trackingType === 'measurement' && habit.unit === 'km' : habit.trackingType === 'minutes'))
  .refine((habit) => !habit.thresholds || habit.trackingType === 'measurement' ||
    Object.values(habit.thresholds).every((value) => Number.isInteger(value) && (habit.trackingType !== 'rating' || value <= 5)));

const logSchema = z.object({
  id, habitId: id, date: dateKey, value: z.number().nonnegative().max(100000),
  status: z.enum(['done', 'skipped', 'rest', 'slipped', 'restart']), note: z.string().max(1000).optional(), timestamp,
  /** How much of the avoided thing happened. A little counts like a minimum; a normal amount or a lot is a miss. */
  slip: z.enum(['little', 'normal', 'lot']).optional(),
  replacementUsed: z.boolean().optional(), restart: z.boolean().optional(),
  completionMinute: z.number().int().min(0).max(1439).nullable().optional(),
  imported: z.object({ source: healthSource, updated: z.number().positive() }).optional(),
  trackingType: trackingType.optional(),
  title: z.string().min(1).max(80), unit: z.string().max(18), achievement: z.enum(['logged', 'minimum', 'target', 'stretch']).optional(),
}).refine((log) => log.status === 'done' ? log.value > 0 : log.status === 'slipped' || log.value === 0)
  .refine((log) => !log.slip || log.status === 'slipped')
  .refine((log) => log.trackingType === 'measurement' || (Number.isInteger(log.value) && (log.trackingType !== 'rating' || log.value <= 5)));

const checkInSchema = z.object({ date: dateKey, mood: rating, energy: rating, note: z.string().max(1000).optional(), timestamp });
const coreFields = {
  categories: z.array(categorySchema).min(1),
  habits: z.array(habitSchema),
  logs: z.array(logSchema),
  checkIns: z.array(checkInSchema),
  settings: z.object({
    theme: z.enum(['dark', 'light']), timezone: z.literal('device'), preferredCategories: z.array(id),
    remindersEnabled: z.literal(false),
  }),
};
const legacySchema = z.object({ ...coreFields, version: z.literal(1) });
const planSchema = z.object({ date: dateKey, habit: habitSchema });
const goalSchema = z.object({
  id, title: z.string().trim().min(1).max(100), unit: z.string().trim().max(24), target: z.number().finite(),
  due: dateKey.optional(), measurements: z.array(z.object({ id, date: dateKey, value: z.number().finite(), note: z.string().max(1000) })),
});
const momentSchema = z.object({
  id, date: dateKey, title: z.string().trim().min(1).max(100), note: z.string().max(2000),
  kind: z.enum(['Milestone', 'Experience', 'Lesson', 'Memory']),
});
const routineSchema = z.object({ date: dateKey, plan: z.string().max(2000), reflection: z.string().max(2000) });
const sleepSchema = z.object({
  date: dateKey, minutes: z.number().int().positive().max(1440), source: z.literal('Health Connect'),
});
function hourValues(value: z.ZodNumber) {
  return z.array(z.object({ hour: z.number().int().min(0).max(23), value })).max(24)
    .refine((hours) => new Set(hours.map(({ hour }) => hour)).size === hours.length);
}
const stepCount = z.number().int().nonnegative().safe();
const stepDaySchema = z.object({ date: dateKey, steps: stepCount, hours: hourValues(stepCount).optional() });
const usageSeconds = z.number().int().min(0).max(172800);
const usageApp = { id: z.string().min(1).max(500), name: z.string().min(1).max(500) };
export const usageAppsSchema = z.array(z.object(usageApp));
export const minSharedLimitApps = 2;
const sharedLimitApps = usageAppsSchema.min(minSharedLimitApps)
  .refine((apps) => new Set(apps.map(({ id }) => id)).size === apps.length);
const screenDaySchema = z.object({
  date: dateKey, seconds: usageSeconds, hours: hourValues(usageSeconds).optional(),
  apps: z.array(z.object({ ...usageApp, seconds: usageSeconds })),
}).refine(({ seconds, apps }) => new Set(apps.map((app) => app.id)).size === apps.length &&
  apps.every((app) => app.seconds <= seconds));
export const maxAppLimitMinutes = 1440;
const limitMinutes = z.number().int().min(0).max(maxAppLimitMinutes);
const appLimitSchema = z.object({
  ...usageApp,
  changes: z.array(z.object({
    date: dateKey, minutes: limitMinutes.nullable(), apps: sharedLimitApps.optional(), resumeMinutes: limitMinutes.optional(),
  })).min(1).refine((changes) => new Set(changes.map(({ date }) => date)).size === changes.length &&
    changes.every(({ apps }) => (apps === undefined) === (changes[0].apps === undefined))),
});
const syncState = z.enum(['off', 'permission', 'connected', 'unavailable', 'error']);
const syncTime = z.number().int().positive().safe();
const healthWindow = { updated: syncTime, from: dateKey, through: dateKey };
const healthMetric = z.object({ date: dateKey, value: z.number().nonnegative().max(100000) });
const healthMetrics = z.array(healthMetric);
export const phoneActivitySchema = z.object({
  health: z.object({
    state: syncState, sleep: z.boolean().optional(), steps: z.boolean().optional(),
    exercise: z.boolean().optional(), distance: z.boolean().optional(),
    backgroundAvailable: z.boolean().optional(), background: z.boolean().optional(),
  }),
  usage: z.object({ state: syncState }),
  sleep: z.object({ ...healthWindow, days: z.array(sleepSchema) }).optional(),
  steps: z.object({ ...healthWindow, days: z.array(stepDaySchema) }).optional(),
  exercise: z.object({ ...healthWindow, days: healthMetrics }).optional(),
  distance: z.object({ ...healthWindow, days: healthMetrics }).optional(),
  screen: z.object({ updated: syncTime, days: z.array(screenDaySchema) }).optional(),
});
export type PhoneActivitySnapshot = z.infer<typeof phoneActivitySchema>;
export type ScreenDay = z.infer<typeof screenDaySchema>;
export type AppLimit = z.infer<typeof appLimitSchema>;
const habitDate = z.object({ habitId: id, date: dateKey });
const priority = z.object({ habitId: id, cue: z.string().trim().max(140), minimum: z.boolean() });
const priorityDay = z.object({ date: dateKey, items: z.array(priority).max(3) });
const smallWinDetails = z.object({
  title: z.string().trim().min(1).max(60), goal: z.number().int().min(1).max(50),
});
const smallWinRoster = z.array(smallWinDetails.extend({
  id, emoji: z.string().max(16), step: z.number().positive().max(100), unit: z.string().trim().max(12),
})).max(40).refine((items) => new Set(items.map((item) => item.id)).size === items.length);
const backupSchema = z.object({
  ...coreFields,
  version: z.literal(2),
  planStart: dateKey, plans: z.array(planSchema), goals: z.array(goalSchema), moments: z.array(momentSchema),
  routines: z.array(routineSchema), sleep: z.array(sleepSchema),
  programs: z.array(z.object({
    id, title: z.string().trim().min(1).max(80), action: z.string().trim().min(1).max(160),
    started: dateKey, duration: z.union([z.literal(7), z.literal(14), z.literal(30)]), habitId: id.optional(),
    status: z.enum(['active', 'paused', 'stopped']), days: z.array(dateKey),
    guide: z.enum(guideKeys).optional(),
    level: z.number().int().min(1).max(programLevels.length).optional(),
    repeatDays: z.array(dateKey).optional(),
    entries: z.array(z.object({ date: dateKey, action: z.string().trim().max(500), reflection: z.string().trim().max(2000) })).optional(),
  })).optional(),
  pinnedProgramId: id.optional(),
  activeFocus: z.object({ id, date: dateKey, title: z.string().min(1).max(100),
    work: z.number().int().min(60).max(7200), rest: z.number().int().min(0).max(3600),
    rounds: z.number().int().min(1).max(8), strict: z.boolean(), quiet: z.boolean(),
    elapsed: z.number().int().min(0).max(86400), started: z.number().int().positive().safe().optional(),
  }).refine((session) => session.elapsed <= (session.work + session.rest) * session.rounds).optional(),
  focusHistory: z.array(z.object({ id, date: dateKey, title: z.string().min(1).max(100),
    seconds: z.number().int().positive().max(86400) })).optional(),
  steps: z.array(stepDaySchema).optional(),
  exercise: healthMetrics.optional(), distance: healthMetrics.optional(),
  healthOverrides: z.array(habitDate).optional(),
  screenTime: z.array(screenDaySchema).optional(),
  habitTimers: z.array(z.object({ habit: habitSchema, date: dateKey, started: timestamp })).optional(),
  timerRemainders: z.array(habitDate.extend({ seconds: z.number().int().min(1).max(59) })).optional(),
  appLimits: z.array(appLimitSchema).optional(),
  budgetCoach: z.object({
    limitId: usageApp.id.optional(), headsUp: z.boolean().optional(), resetAction: z.string().trim().min(1).max(140).optional(),
    reviewHour: z.union([z.literal(21), z.literal(22)]).optional(),
    lastReset: z.object({ date: dateKey, limitId: usageApp.id }).optional(),
  }).optional(),
  audit: z.array(z.object({ id, timestamp, detail: z.string().max(300) })),
  reminder: reminderTime.optional(),
  reminderControls: z.object({ disabled: z.boolean(), quietFrom: reminderTime.optional(), quietThrough: reminderTime.optional() }).optional(),
  recoveryStart: dateKey.optional(),
  priorities: z.array(priorityDay).optional(),
  weeklySessions: z.array(habitDate).optional(),
  eveningPlans: z.array(z.object({ habitId: id, date: dateKey, start: z.number().int().positive(),
    end: z.number().int().positive() }).refine((plan) => plan.end > plan.start)).optional(),
  consequenceChecks: z.array(habitDate).optional(),
  phoneReceipts: z.array(id).max(500).optional(),
  streakPauses: z.array(z.object({ from: dateKey, resume: dateKey.optional() }))
    .refine((ranges) => ranges.every(({ from, resume }, i) => (!resume || from < resume) &&
      (i === 0 || !!ranges[i - 1].resume && ranges[i - 1].resume! <= from))).optional(),
  sparkyDays: z.array(z.object({ date: dateKey, pose: z.enum(['ready', 'proud', 'so-so', 'disappointed']),
    done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })).optional(),
  coachDataOwner: id.optional(),
  chats: z.array(z.object({ id, owner: id.optional(), started: timestamp, turns: z.array(z.object({
    question: z.string().min(1).max(4000), answer: z.string().min(1).max(20000), at: timestamp })).min(1).max(50) })).max(100).optional(),
  smallWins: z.object({
    items: smallWinRoster,
    snapshots: z.array(z.object({ before: dateKey, items: smallWinRoster }))
      .refine((rows) => rows.every((row, i) => i === 0 || rows[i - 1].before < row.before)).optional(),
    log: z.array(z.object({ date: dateKey, id, count: z.number().int().min(1).max(999), removed: smallWinDetails.optional() })),
  }).optional(),
  aiSummaries: z.array(z.object({ id, date: dateKey, days: z.number().int().min(1).max(366), label: z.string().min(1).max(20),
    text: z.string().min(1).max(20000) })).max(100).optional(),
}).superRefine((data, context) => {
  const unique = (keys: string[]) => new Set(keys).size === keys.length;
  const categories = new Set(data.categories.map((category) => category.id));
  const habits = new Set(data.habits.map((habit) => habit.id));
  if (categories.size !== data.categories.length || habits.size !== data.habits.length ||
      !unique(data.logs.map((log) => logKey(log.habitId, log.date))) ||
      !unique(data.logs.map((log) => log.id)) || !unique(data.checkIns.map((entry) => entry.date)) ||
      !unique((data.habitTimers ?? []).map((timer) => timer.habit.id)) ||
      !unique((data.timerRemainders ?? []).map((item) => logKey(item.habitId, item.date))) ||
      !unique(data.plans.map(({ date, habit }) => logKey(habit.id, date))) ||
      !unique(data.routines.map(({ date }) => date)) || !unique(data.sleep.map(({ date }) => date)) ||
      !unique((data.steps ?? []).map(({ date }) => date)) || !unique((data.screenTime ?? []).map(({ date }) => date)) ||
      !unique((data.exercise ?? []).map(({ date }) => date)) || !unique((data.distance ?? []).map(({ date }) => date)) ||
      !unique((data.appLimits ?? []).map(({ id }) => id)) ||
      !unique(data.goals.map(({ id }) => id)) || !unique(data.moments.map(({ id }) => id)) ||
      !unique(data.audit.map(({ id }) => id)) ||
      !unique((data.eveningPlans ?? []).map((plan) => plan.date)) ||
      !unique((data.weeklySessions ?? []).map(({ habitId, date }) => logKey(habitId, date))) ||
      !unique((data.healthOverrides ?? []).map(({ habitId, date }) => logKey(habitId, date))) ||
      !unique((data.consequenceChecks ?? []).map(({ habitId, date }) => logKey(habitId, date))) ||
      !unique((data.priorities ?? []).map(({ date }) => date)) ||
      !unique((data.sparkyDays ?? []).map(({ date }) => date)) ||
      !unique((data.aiSummaries ?? []).map(({ id }) => id)) ||
      !unique((data.smallWins?.items ?? []).map(({ id }) => id)) ||
      !unique((data.chats ?? []).map(({ id }) => id)) ||
      !unique((data.programs ?? []).map(({ id }) => id)) || (data.programs ?? []).some(({ days }) => !unique(days)) ||
      (data.programs ?? []).some(({ entries }) => !unique((entries ?? []).map(({ date }) => date))) ||
      (data.programs ?? []).some(({ days, repeatDays }) => !unique(repeatDays ?? []) || repeatDays?.some((date) => !days.includes(date))) ||
      !unique((data.focusHistory ?? []).map(({ id }) => id)) ||
      !unique((data.smallWins?.log ?? []).map(({ id, date }) => logKey(id, date))) ||
      (data.priorities ?? []).some(({ items }) => !unique(items.map(({ habitId }) => habitId))) ||
      data.goals.some((goal) => !unique(goal.measurements.map(({ id }) => id)))) {
    context.addIssue({ code: 'custom', message: 'The backup contains duplicate entries.' });
  }
  if (data.habits.some((habit) => !categories.has(habit.categoryId)) ||
      data.categories.some((category) => category.parentId && (category.parentId === category.id ||
        !data.categories.some((parent) => parent.id === category.parentId && !parent.parentId))) ||
      data.habits.some((habit) => habit.afterHabitId && (habit.afterHabitId === habit.id || !habits.has(habit.afterHabitId))) ||
      data.logs.some((log) => !habits.has(log.habitId) || log.id !== logKey(log.habitId, log.date)) ||
      data.plans.some(({ habit }) => !habits.has(habit.id) || !categories.has(habit.categoryId)) ||
      (data.programs ?? []).some(({ habitId }) => habitId !== undefined && !habits.has(habitId)) ||
      [...(data.eveningPlans ?? []), ...(data.weeklySessions ?? []), ...(data.consequenceChecks ?? []), ...(data.healthOverrides ?? []), ...(data.priorities ?? []).flatMap(({ items }) => items)]
        .some(({ habitId }) => !habits.has(habitId)) ||
      data.settings.preferredCategories.some((category) => !categories.has(category))) {
    context.addIssue({ code: 'custom', message: 'The backup contains invalid references.' });
  }
});

export type AppData = z.infer<typeof backupSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Habit = z.infer<typeof habitSchema>;
export type HabitLog = z.infer<typeof logSchema>;
export type CheckIn = z.infer<typeof checkInSchema>;
export type Theme = AppData['settings']['theme'];
export type Goal = z.infer<typeof goalSchema>;
export type Moment = z.infer<typeof momentSchema>;
export type Routine = z.infer<typeof routineSchema>;
export type SleepNight = z.infer<typeof sleepSchema>;
export type Priority = z.infer<typeof priority>;
export type LogEntry = Pick<HabitLog, 'status' | 'value' | 'note' | 'replacementUsed' | 'restart' | 'slip'>;

/** How big a counted slip was, from the habit's own limits. */
export function slipSize(habit: Habit, count: number): NonNullable<HabitLog['slip']> {
  if (!habit.slipCount) return 'normal';
  return count <= habit.slipCount.little ? 'little' : count >= habit.slipCount.lot ? 'lot' : 'normal';
}

/** Seconds already logged for a minutes habit that day, so a new timer counts down only what is left. */
export function timerBaseSeconds(data: AppData, habitId: string, date: string) {
  const log = data.logs.find((entry) => entry.id === logKey(habitId, date));
  const minutes = log?.status === 'done' && (!log.trackingType || log.trackingType === 'minutes') ? log.value : 0;
  return minutes * 60 + (data.timerRemainders?.find((item) => item.habitId === habitId && item.date === date)?.seconds ?? 0);
}

export function mergePhoneActivity(data: AppData, snapshot: PhoneActivitySnapshot): AppData {
  const next = { ...data };
  if (snapshot.sleep) {
    const { from, through, days } = snapshot.sleep;
    next.sleep = [...data.sleep.filter(({ date }) => date < from || date > through), ...days];
  }
  if (snapshot.steps) {
    const { from, through, days } = snapshot.steps;
    next.steps = [...(data.steps ?? []).filter(({ date }) => date < from || date > through), ...days];
  }
  for (const key of ['exercise', 'distance'] as const) {
    const window = snapshot[key];
    if (window) next[key] = [...(data[key] ?? []).filter(({ date }) => date < window.from || date > window.through), ...window.days];
  }
  if (snapshot.screen) {
    const byDate = new Map((data.screenTime ?? []).map((day) => [day.date, day]));
    for (const day of snapshot.screen.days) byDate.set(day.date, day);
    next.screenTime = [...byDate.values()];
  }
  const logs = new Map(next.logs.map((log) => [log.id, log]));
  for (const [key, log] of logs) {
    const window = log.imported && snapshot[log.imported.source];
    if (window && log.date >= window.from && log.date <= window.through) logs.delete(key);
  }
  const overrides = new Set((next.healthOverrides ?? []).map(({ habitId, date }) => logKey(habitId, date)));
  const sessions = sessionKeys(next);
  const revisions = [...next.plans].sort((a, b) => b.date.localeCompare(a.date));
  for (const source of healthSource.options) {
    const window = snapshot[source];
    if (!window) continue;
    for (const day of window.days) {
      const value = 'steps' in day ? day.steps : 'minutes' in day ? day.minutes : day.value;
      if (day.date < window.from || day.date > window.through || value <= 0 || value > 100000) continue;
      for (const current of next.habits) {
        const habit = revisions.find((plan) => plan.habit.id === current.id && plan.date <= day.date)?.habit;
        if (!habit || habit.healthSource !== source || !plannedFor(habit, day.date, sessions)) continue;
        const key = logKey(habit.id, day.date);
        if (logs.has(key) || overrides.has(key)) continue;
        logs.set(key, logSchema.parse({ id: key, habitId: habit.id, date: day.date, title: habit.title, unit: habit.unit,
          trackingType: habit.trackingType, value, status: 'done', achievement: achievement(habit, value),
          timestamp: new Date(window.updated).toISOString(), imported: { source, updated: window.updated } }));
      }
    }
  }
  return { ...next, logs: [...logs.values()] };
}

export function newId() {
  return globalThis.crypto.getRandomValues(new Uint32Array(4)).join('-');
}

function emptyFeatures(habits: Habit[], date: string) {
  return {
    version: 2 as const, planStart: date, plans: habits.map((habit) => ({ date, habit })),
    goals: [], moments: [], routines: [], sleep: [], audit: [],
  };
}

export function parseBackup(value: unknown, today = localDate()): AppData {
  let source = value;
  if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
    const legacy = legacySchema.safeParse(value);
    if (legacy.success) source = { ...legacy.data, ...emptyFeatures(legacy.data.habits, today) };
  }
  const result = backupSchema.safeParse(source);
  if (!result.success) throw new Error('This file is not a valid Sparky backup.');
  return result.data;
}

const categoryDefaults = [
  ['physical', 'Physical health & performance', 'activity', '#8ad8b3'],
  ['mental', 'Mental & intellectual growth', 'book', '#a6c7ff'],
  ['emotional', 'Emotional well-being', 'heart', '#efaaa6'],
  ['spiritual', 'Spirituality & inner peace', 'leaf', '#d4b6fa'],
  ['social', 'Relationships & social life', 'users', '#f4c68e'],
  ['career', 'Career, skills & finances', 'briefcase', '#8dd5df'],
  ['experiences', 'Experiences & courage', 'compass', '#edc99b'],
] as const;

export function starterData(now = new Date()): AppData {
  const createdAt = now.toISOString();
  const createdDate = localDate(now);
  const everyDay = weekdays.map(([day]) => day);
  const examples = [
    ['read', 'mental', 'Read', [5, 20, 40]],
    ['move', 'physical', 'Move or train', [5, 20, 45]],
    ['meditate', 'spiritual', 'Meditate or reflect', [2, 10, 20]],
    ['learn', 'mental', 'Learn something', [5, 20, 45]],
    ['gratitude', 'emotional', 'Gratitude', null],
    ['reach-out', 'social', 'Reach out to someone', null],
    ['project', 'career', 'Personal project', [10, 30, 60]],
  ] as const;
  const habits: Habit[] = examples.map(([id, categoryId, title, levels], sortOrder) => ({
    id, categoryId, title, sortOrder, createdAt, createdDate,
    trackingType: levels ? 'minutes' : 'checkbox', unit: levels ? 'min' : '',
    thresholds: levels ? { minimum: levels[0], target: levels[1], stretch: levels[2] } : undefined,
    days: id === 'reach-out' ? [1, 3, 5] : everyDay,
  }));
  return {
    ...emptyFeatures(habits, createdDate),
    categories: categoryDefaults.map(([id, name, icon, color], sortOrder) => ({ id, name, icon, color, sortOrder })),
    habits,
    logs: [], checkIns: [],
    settings: { theme: 'light', timezone: 'device', preferredCategories: [], remindersEnabled: false },
  };
}

export function scoringPaused(data: AppData, date: string) {
  const ranges = data.streakPauses ?? [];
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (ranges[mid].from <= date) low = mid + 1;
    else high = mid;
  }
  const range = ranges[low - 1];
  return !!range && (!range.resume || date < range.resume);
}

export function setScoringPaused(data: AppData, today: string, paused: boolean): AppData {
  if (scoringPaused(data, today) === paused) return data;
  const ranges = data.streakPauses ?? [];
  if (paused) {
    const resume = ranges.find((range) => range.from > today)?.from;
    return { ...data, streakPauses: [...ranges, { from: today, resume }].sort((a, b) => a.from.localeCompare(b.from)) };
  }
  return { ...data, streakPauses: ranges.flatMap((range) => {
    if (range.from > today || (range.resume && range.resume <= today)) return [range];
    return range.from === today ? [] : [{ ...range, resume: today }];
  }) };
}

export function logKey(habitId: string, date: string) {
  return `${habitId}:${date}`;
}

export function plannedFor(habit: Habit, date: string, sessions: Set<string>, weekday?: number) {
  return !habit.archivedAt && habit.createdDate <= date && (!habit.pauseThrough || date > habit.pauseThrough) &&
    (habit.onceOn ? date === habit.onceOn :
      sessions.has(logKey(habit.id, date)) || (!habit.weeklyTarget && habit.days.includes(weekday ?? calendarDate(date).getDay())));
}

export function sessionKeys(data: AppData) {
  return new Set([...(data.weeklySessions ?? []), ...(data.eveningPlans ?? [])].map(({ habitId, date }) => logKey(habitId, date)));
}

export function dueHabits(habits: Habit[], date: string, sessions = new Set<string>()) {
  return habits.filter((habit) => plannedFor(habit, date, sessions));
}

export function availableHabits(data: AppData, date: string) {
  const sessions = sessionKeys(data);
  return data.habits.filter((habit) => habit.weeklyTarget
    ? !habit.archivedAt && habit.createdDate <= date && (!habit.pauseThrough || date > habit.pauseThrough) : plannedFor(habit, date, sessions));
}

export function savePlan(data: AppData, habit: Habit, date: string): AppData {
  return {
    ...data,
    habits: [...data.habits.filter((item) => item.id !== habit.id), habit],
    plans: [...data.plans.filter((plan) => plan.date !== date || plan.habit.id !== habit.id), { date, habit }],
  };
}

export function replaceSleep(data: AppData, nights: unknown) {
  const entries = z.array(sleepSchema).parse(nights);
  const merged = new Map(data.sleep.map((entry) => [entry.date, entry]));
  entries.forEach((entry) => merged.set(entry.date, entry));
  return { ...data, sleep: [...merged.values()] };
}

export function achievement(habit: Habit, value: number): HabitLog['achievement'] {
  if (value <= 0) return undefined;
  if (!habit.thresholds) return 'target';
  const { minimum, target, stretch } = habit.thresholds;
  if (value >= stretch) return 'stretch';
  if (value >= target) return 'target';
  return value >= minimum ? 'minimum' : 'logged';
}

export function dailyProgress(habits: Habit[], logs: Map<string, HabitLog>) {
  let target = 0;
  let minimum = 0;
  let rest = 0;
  for (const habit of habits) {
    const log = logs.get(habit.id);
    if (log?.status === 'rest') rest++;
    if (log?.status === 'slipped' && log.slip === 'little' && habit.trackingType === 'avoid') minimum++;
    if (log?.status !== 'done' || (log.trackingType && log.trackingType !== habit.trackingType) || log.unit !== habit.unit) continue;
    const level = achievement(habit, log.value);
    if (level === 'target' || level === 'stretch') target++;
    if (level && level !== 'logged') minimum++;
  }
  return { target, minimum, rest, scheduled: habits.length - rest };
}

export function writeLog(data: AppData, habitId: string, date: string, entry?: LogEntry, recordedAt: Date | null = new Date()): AppData {
  const habit = (date < localDate() ? historicalHabit(data, habitId, date) : undefined) ??
    availableHabits(data, date).find((candidate) => candidate.id === habitId) ?? historicalHabit(data, habitId, date);
  const timerRemainders = data.timerRemainders?.filter((item) => item.habitId !== habitId || item.date !== date);
  if (!entry) {
    const key = logKey(habitId, date);
    const overrides = data.healthOverrides ?? [];
    const healthOverrides = (habit?.healthSource || data.logs.some((log) => log.id === key && log.imported)) &&
      !overrides.some((item) => item.habitId === habitId && item.date === date) ? [...overrides, { habitId, date }] : data.healthOverrides;
    return { ...data, healthOverrides, timerRemainders, logs: data.logs.filter((item) => item.id !== key) };
  }
  if (!habit) throw new Error('This habit is no longer scheduled for that day.');
  return saveHabitEntry({ ...data, timerRemainders }, habit, date, entry, recordedAt);
}

export function historicalHabit(data: AppData, habitId: string, date: string) {
  if (!data.logs.some((log) => log.id === logKey(habitId, date))) return undefined;
  return data.plans.filter((plan) => plan.habit.id === habitId && plan.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.habit ?? data.habits.find((habit) => habit.id === habitId);
}

function saveHabitEntry(data: AppData, habit: Habit, date: string, entry: LogEntry, recordedAt: Date | null): AppData {
  const habitId = habit.id;
  const id = logKey(habitId, date);
  const logs = data.logs.filter((log) => log.id !== id);
  if (entry.status === 'slipped' && habit.trackingType !== 'avoid') throw new Error('This outcome requires an avoidance habit.');
  if (entry.status === 'restart' && habit.trackingType === 'avoid') throw new Error('Log an outcome for a Break List habit.');
  const previous = data.logs.find((item) => item.id === id);
  const level = achievement(habit, entry.value);
  let minute: number | null = null;
  if (entry.status === 'done' && (level === 'target' || level === 'stretch')) {
    const priorTarget = previous?.status === 'done' && !previous.imported &&
      (previous.achievement === 'target' || previous.achievement === 'stretch');
    const first = priorTarget ? new Date(previous.timestamp) : recordedAt;
    minute = priorTarget && previous.completionMinute !== undefined ? previous.completionMinute
      : first && localDate(first) === date ? first.getHours() * 60 + first.getMinutes() : null;
  }
  const log = logSchema.parse({
    ...entry, id, habitId, date, title: habit.title, unit: habit.unit, trackingType: habit.trackingType,
    completionMinute: minute, achievement: entry.status === 'done' ? level : undefined,
    timestamp: new Date().toISOString(),
  });
  return { ...data, logs: [...logs, log] };
}

export function startHabitTimer(data: AppData, habitId: string, now = new Date()): AppData {
  if (data.habitTimers?.some((timer) => timer.habit.id === habitId)) return data;
  const date = localDate(now);
  const habit = availableHabits(data, date).find((item) => item.id === habitId && item.trackingType === 'minutes');
  if (!habit) throw new Error('This habit is unavailable for timing today.');
  return { ...data, habitTimers: [...data.habitTimers ?? [], { habit, date, started: now.toISOString() }] };
}

export function stopHabitTimer(data: AppData, habitId: string, started: string, now = new Date()): AppData {
  const timer = data.habitTimers?.find((item) => item.habit.id === habitId && item.started === started);
  if (!timer) return data;
  const { date, habit } = timer;
  const sameDay = (item: { habitId: string; date: string }) => item.habitId === habitId && item.date === date;
  const carry = data.timerRemainders?.find(sameDay)?.seconds ?? 0;
  const seconds = carry + Math.max(0, Math.floor((now.getTime() - Date.parse(started)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const timerRemainders = (data.timerRemainders ?? []).filter((item) => !sameDay(item));
  if (seconds % 60) timerRemainders.push({ habitId, date, seconds: seconds % 60 });
  const next = { ...data, timerRemainders, habitTimers: data.habitTimers!.filter((item) => item !== timer) };
  if (!minutes) return next;
  const previous = data.logs.find(sameDay);
  if (previous?.trackingType && previous.trackingType !== 'minutes') throw new Error('This entry now uses another unit. Finish editing it before saving the timer.');
  return saveHabitEntry(next, habit, date, { status: 'done', value: Math.min(100000, (previous?.value ?? 0) + minutes),
    note: previous?.note, restart: previous?.restart }, now);
}
