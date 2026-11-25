import { androidRequest } from './android.ts';
import { appLimitForDay, countAppLimitDays } from './app-limits.ts';
import { sparkyHistory } from './budget-coach.ts';
import { shiftDate, type AppData } from './model.ts';
import { prioritiesFor } from './planning.ts';
import { makeReport, minutesLabel } from './reports.ts';
import { smallWinTotals } from './small-wins.ts';

export type ChatModel = { id: string; name: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function optionalAiData(data: AppData): AppData {
  return { ...data, sleep: [], steps: [], exercise: [], distance: [], screenTime: [], sparkyDays: [], aiSummaries: [],
    logs: data.logs.filter((log) => !log.imported) };
}

export function weeklyAiRequest(data: AppData, today: string, weeklyGrant?: string) {
  const report = makeReport(optionalAiData(data), today, 7);
  const prompt = `Give a short weekly habit review using only these totals. Suggest one small next step. In the recorded week, ${report.hit} of ${report.planned} scheduled targets were reached. ${report.minimum} reached at least the minimum. ${report.actions} habit actions were logged. Treat missing information as unknown.`;
  return JSON.stringify({ date: today, model: savedChatModel(), prompt, owner: modelOwner, dataOwner: data.coachDataOwner ?? '', weeklyGrant });
}

let weeklyChoice = 0;
export function invalidateWeeklyChoice() { weeklyChoice++; }
export function weeklySession() {
  const revision = weeklyChoice;
  const owner = modelOwner;
  return { owner, active: () => !!owner && revision === weeklyChoice && owner === modelOwner };
}

let modelOwner = '';
const modelKey = () => 'one-life-chat-model:' + modelOwner;
/** The Android side rejects any single message longer than 60000 characters; keep room for the question. */
export const maxMessageLength = 58000;
/** Character budget for the optional context preview. */
export const chatContextLength = 20000;

export function savedChatModel() {
  try { return modelOwner ? localStorage.getItem(modelKey()) ?? '' : ''; } catch { return ''; }
}

export function saveChatModel(id: string) {
  try { if (modelOwner) localStorage.setItem(modelKey(), id); } catch { /* Storage unavailable. */ }
}

/** The model picked in Settings, or the first one OpenAI offers when that choice is gone or was never made. */
export function pickModel(models: ChatModel[], saved = savedChatModel()) {
  return models.some(({ id }) => id === saved) ? saved : models[0]?.id ?? '';
}

let modelCache: Promise<ChatModel[]> | undefined;
export function setModelOwner(owner: string) {
  if (owner !== modelOwner) {
    invalidateWeeklyChoice();
    modelOwner = owner;
    modelCache = undefined;
    if (typeof window !== 'undefined') window.dispatchEvent?.(new Event('daybook-coach-account'));
  }
}
export function chatModels(reload = false) {
  if (reload || !modelCache) {
    const request = androidRequest<ChatModel[]>('chatModels');
    modelCache = request;
    void request.catch(() => { if (modelCache === request) modelCache = undefined; });
  }
  return modelCache;
}

export async function askChatGpt(messages: ChatMessage[], session?: { owner: string; active: () => boolean }) {
  const owner = session?.owner ?? modelOwner;
  const model = pickModel(await chatModels());
  if (owner !== modelOwner || (session && !session.active())) throw new Error('The Coach session changed.');
  if (!model) throw new Error('OpenAI did not return a model for this account.');
  return androidRequest<string>('chatAsk', JSON.stringify({ model, messages, owner: owner || undefined }));
}

export type AiSummaryEntry = NonNullable<AppData['aiSummaries']>[number];
/** How many past summaries Sparky keeps. */
export const keptSummaries = 60;

/** Saves a new summary, newest first, and forgets the oldest past the limit. */
export function rememberSummary(data: AppData, entry: AiSummaryEntry): AppData {
  const kept = (data.aiSummaries ?? []).filter(({ id }) => id !== entry.id);
  return { ...data, aiSummaries: [{ ...entry, text: entry.text.slice(0, 20000) }, ...kept].slice(0, keptSummaries) };
}

/** The latest past summaries as context, so the AI can check whether its advice was followed. */
function pastSummaries(data: AppData, count: number, each: number) {
  return (data.aiSummaries ?? []).slice(0, count).map((entry) =>
    `- ${entry.date}, ${entry.label.toLowerCase()} review:\n${entry.text.trim().slice(0, each)}${entry.text.length > each ? ' (cut)' : ''}`);
}

const percent = (hit: number, planned: number) => planned ? `${Math.round(100 * hit / planned)}%` : 'none';
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Adds lines until the budget runs out and says how many were left out. */
function fit(title: string, lines: string[], budget: number, empty = '') {
  if (!lines.length) return empty ? `${title}\n${empty}` : '';
  let text = title;
  for (const [index, line] of lines.entries()) {
    if (text.length + line.length + 60 > budget) return `${text}\n- (${lines.length - index} more entries left out)`;
    text += '\n' + line;
  }
  return text;
}

function habitSetup(data: AppData) {
  const areas = new Map(data.categories.map((area) => [area.id, area.name]));
  return data.habits.filter((habit) => !habit.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder).map((habit) => {
    const schedule = habit.weeklyTarget ? `${habit.weeklyTarget} times a week`
      : habit.days.length === 7 ? 'every day' : habit.days.map((day) => weekdayNames[day]).join(' ');
    const goal = habit.trackingType === 'avoid' ? 'avoid it' : habit.thresholds
      ? `minimum ${habit.thresholds.minimum}, target ${habit.thresholds.target}, stretch ${habit.thresholds.stretch} ${habit.unit}` : 'done or not';
    return [`- ${habit.title} (${areas.get(habit.categoryId) ?? 'no area'}): ${schedule}, ${goal}`,
      habit.description && `why: ${habit.description}`,
      habit.consequence && `if I skip it: ${habit.consequence}`,
      habit.replacement && `instead, when ${habit.replacement.cue}: ${habit.replacement.action}`,
      habit.tinyRestart && `restart step: ${habit.tinyRestart}`,
      habit.slipCount && `slips counted in ${habit.slipCount.unit}: up to ${habit.slipCount.little} is a little, ${habit.slipCount.lot}+ is a lot`,
      habit.reminderTime && `reminder ${habit.reminderTime}`].filter(Boolean).join('; ');
  });
}

const clean = (text: string) => text.trim().replace(/\s+/g, ' ');

/** Every dated note and event in the period, newest first. */
function journal(data: AppData, from: string, to: string) {
  const inside = (date: string) => date >= from && date <= to;
  const entries: [string, string][] = [];
  for (const log of data.logs) {
    const note = clean(log.note ?? '');
    if (!inside(log.date) || (!note && log.status !== 'slipped' && log.status !== 'skipped' && !log.replacementUsed)) continue;
    const what = log.status === 'done' ? (log.trackingType === 'avoid' ? 'avoided' : `done${log.unit ? ` ${log.value} ${log.unit}` : ''}`)
      : log.status === 'slipped' ? `did not avoid it, ${{ little: 'just a little', normal: 'a normal amount', lot: 'a lot' }[log.slip ?? 'normal']}${log.value ? ` (${log.value})` : ''}` : log.status;
    entries.push([log.date, `${log.title} (${what}${log.replacementUsed ? ', used the replacement' : ''})${note ? `: ${note}` : ''}`]);
  }
  for (const entry of data.checkIns) if (inside(entry.date)) {
    const note = clean(entry.note ?? '');
    entries.push([entry.date, `check-in, mood ${entry.mood}/5, energy ${entry.energy}/5${note ? `: ${note}` : ''}`]);
  }
  for (const routine of data.routines) if (inside(routine.date)) {
    if (clean(routine.plan)) entries.push([routine.date, `morning plan: ${clean(routine.plan)}`]);
    if (clean(routine.reflection)) entries.push([routine.date, `evening reflection: ${clean(routine.reflection)}`]);
  }
  for (const moment of data.moments) if (inside(moment.date)) {
    entries.push([moment.date, `${moment.kind.toLowerCase()} "${moment.title}"${clean(moment.note) ? `: ${clean(moment.note)}` : ''}`]);
  }
  for (const goal of data.goals) for (const measure of goal.measurements) if (inside(measure.date)) {
    entries.push([measure.date, `goal ${goal.title} measured ${measure.value} ${goal.unit}${clean(measure.note) ? `: ${clean(measure.note)}` : ''}`]);
  }
  return entries.sort((a, b) => b[0].localeCompare(a[0])).map(([date, text]) => `- ${date} ${text}`);
}

function periodFacts(data: AppData, today: string, days: number, label: string, previousDays = days, currentDate = today) {
  const report = makeReport(data, today, days, currentDate);
  const previous = makeReport(data, shiftDate(today, -days), previousDays, currentDate);
  const dates = report.daily.map(({ date }) => date);
  const usage = new Map((data.screenTime ?? []).map((day) => [day.date, day]));
  const faces = sparkyHistory(data, today, days).reduce<Record<string, number>>((count, { pose }) => {
    if (pose && pose !== 'ready') count[pose] = (count[pose] ?? 0) + 1;
    return count;
  }, {});
  const limits = (data.appLimits ?? []).flatMap((limit) => {
    const count = countAppLimitDays(limit, dates, today, usage);
    if (!count.active) return [];
    const minutes = appLimitForDay(limit, today)?.minutes;
    return [`- ${limit.name}${minutes !== undefined ? ` (limit ${minutes} min a day)` : ''}: within on ${count.within} days, over on ${count.over} days`];
  });
  const screenDays = dates.flatMap((date) => usage.get(date) ?? []);
  const screenAverage = screenDays.length ? screenDays.reduce((total, day) => total + day.seconds, 0) / screenDays.length / 60 : undefined;
  const todayScreen = usage.get(today);
  const topApps = todayScreen && [...todayScreen.apps].sort((a, b) => b.seconds - a.seconds).slice(0, 5)
    .map((app) => `${app.name} ${minutesLabel(app.seconds / 60)}`).join(', ');
  const goals = data.goals.map((goal) => {
    const latest = [...goal.measurements].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    return `- ${goal.title}: target ${goal.target} ${goal.unit}${latest ? `, latest ${latest.value}` : ', no measurement yet'}${goal.due ? `, due ${goal.due}` : ''}`;
  });
  const wins = smallWinTotals(data, report.from, today)
    .map((win) => `- ${win.title}: done on ${win.days} days (full goal on ${win.goalDays}), ${win.times} taps`);
  const facts = [
    `Today is ${currentDate}. Period: ${label.toLowerCase()} from ${report.from} to ${today} (${days} days).${today === currentDate ? " Today's habits may still be in progress." : ''}`,
    `Scheduled habits at target: ${report.hit} of ${report.planned} (${percent(report.hit, report.planned)}). Previous ${previousDays} days: ${percent(previous.hit, previous.planned)}.`,
    `Habit actions logged: ${report.actions}. Current full-day streak: ${report.streak} days.`,
    Object.keys(faces).length ? `Sparky's daily verdicts: ${faces.proud ?? 0} proud, ${faces['so-so'] ?? 0} so-so, ${faces.disappointed ?? 0} disappointed.` : '',
    report.areas.length ? `Life areas:\n${report.areas.map((area) => `- ${area.name}: ${area.hit} of ${area.planned}`).join('\n')}` : '',
    report.checkIns.length ? `Check-ins: ${report.checkIns.length}, average mood ${report.mood?.toFixed(1)}/5, energy ${report.energy?.toFixed(1)}/5.` : 'No mood check-ins.',
    report.sleepAverage ? `Sleep: ${minutesLabel(report.sleepAverage)} average over ${report.sleep.length} nights.` : '',
    screenAverage !== undefined ? `Screen time: ${minutesLabel(screenAverage)} a day on average over ${screenDays.length} recorded days.` : '',
    todayScreen ? `Screen time on ${today}: ${minutesLabel(todayScreen.seconds / 60)}${topApps ? `, top apps ${topApps}` : ''}.` : '',
    limits.length ? `App limits:\n${limits.join('\n')}` : '',
    goals.length ? `Goals:\n${goals.join('\n')}` : '',
    wins.length ? `Small wins (everyday basics, separate from habits):\n${wins.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  const scores = [...report.habits].sort((a, b) => a.hit / a.planned - b.hit / b.planned)
    .map((habit) => `- ${habit.title}: ${habit.hit} of ${habit.planned} at target (${percent(habit.hit, habit.planned)})${habit.rest ? `, ${habit.rest} rest days` : ''}`);
  return { facts, scores, from: report.from };
}

/** Everything going on in Sparky for the period: numbers, the plan behind each habit, and every note. */
export function appContext(data: AppData, today: string, days: number, label: string, budget: number, previousDays = days, currentDate = today) {
  const { facts, scores, from } = periodFacts(data, today, days, label, previousDays, currentDate);
  const names = new Map(data.habits.map((habit) => [habit.id, habit.title]));
  const priorities = prioritiesFor(data, today)
    .map((item) => `- ${names.get(item.habitId) ?? 'a habit'}${item.cue ? `: ${item.cue}` : ''}${item.minimum ? ' (minimum version)' : ''}`);
  const sections: [string, string[], number, string?][] = [
    ['Habit scores, weakest first:', scores, 0.3, '- no scheduled habits in this period'],
    ['My habit plan and the reasons behind it:', habitSetup(data), 0.3],
    ["Today's priorities:", priorities, 0.05],
    ['Your earlier AI reviews of me, newest first:', pastSummaries(data, 3, Math.round(budget * 0.07)), 0.22],
    ['Journal, newest first (log notes, slips, check-ins, plans, reflections, timeline, goal notes):', journal(data, from, today), 1],
  ];
  let text = facts.slice(0, budget);
  for (const [title, lines, share, empty] of sections) {
    const room = budget - text.length - 2;
    const part = fit(title, lines, share === 1 ? room : Math.min(room, Math.max(2000, budget * share)), empty);
    if (part) text += '\n\n' + part;
  }
  return text.slice(0, budget);
}

/** The period review: everything in the app plus the questions to answer. */
export function summaryPrompt(data: AppData, today: string, days: number, label: string, previousDays = days, currentDate = today) {
  const period = label.toLowerCase();
  const ask = `Write my ${period} review from my Sparky habit data below. You can see everything in the app, including my notes, so use them. Use these short sections:
1. Verdict: how I am doing overall, in two sentences.
2. Targets: which habits and limits I am reaching and which I am missing.
3. What is working, and what my notes say about why.
4. What to fix, with one concrete change for each problem.
5. Habits to add: at most two that fit my data, each with a small first version.
6. Habits to drop or shrink: anything I keep missing or that is not pulling its weight.
7. One focus for the next ${period}.
8. Since your last review: if earlier reviews are included below, say whether I followed that advice and what changed. Skip this if there are none.
Be honest and direct, like a coach who wants me to win. Keep it under 400 words. Only use the facts given.
Format: each section name on its own line (for example "Verdict"), then one or two short sentences or a few lines starting with "- ". Plain text only: no asterisks, no bold, no hashes, no tables.

`;
  return ask + appContext(data, today, days, label, maxMessageLength - ask.length, previousDays, currentDate);
}

/** The optional context shown for review before sending a question. */
export function chatContext(data: AppData, today: string) {
  return 'Here is what is going on in my Sparky habit app, from the records I chose to share:\n\n'
    + appContext(data, today, 30, 'Month', chatContextLength);
}
