import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDate, parseBackup, shiftDate, starterData, writeLog, type AppData } from '../src/model.ts';
import { chatContext, chatContextLength, keptSummaries, maxMessageLength, optionalAiData, pickModel, rememberSummary, summaryPrompt } from '../src/ai.ts';

const models = [{ id: 'gpt-a', name: 'A' }, { id: 'gpt-b', name: 'B' }];

test('the model chosen in Settings is used until it disappears', () => {
  assert.equal(pickModel(models, 'gpt-b'), 'gpt-b');
  assert.equal(pickModel(models, ''), 'gpt-a');
  assert.equal(pickModel(models, 'retired-model'), 'gpt-a');
  assert.equal(pickModel([], 'gpt-b'), '');
});

function habits(today: string, count: number): AppData {
  const start = starterData(calendarDate(shiftDate(today, -40)));
  const template = start.habits.find(({ id }) => id === 'gratitude')!;
  const list = Array.from({ length: count }, (_, index) => ({ ...template, id: `habit-${index}`, title: `Habit number ${index}`, sortOrder: index }));
  return { ...start, habits: list, plans: list.map((habit) => ({ date: start.planStart, habit })) };
}

test('optional AI context keeps manual records and omits device imports and earlier AI text', () => {
  const today = '2026-11-20';
  let data = habits(today, 2);
  data = writeLog(data, 'habit-0', today, { status: 'done', value: 1, note: 'Manual habit note' });
  data = writeLog(data, 'habit-1', today, { status: 'done', value: 1, note: 'Imported value marker' });
  const safe = optionalAiData({ ...data, logs: data.logs.map((log) => log.habitId === 'habit-1'
    ? { ...log, imported: { source: 'steps', updated: 100 } } : log),
  aiSummaries: [{ id: 'old', date: today, days: 7, label: 'Week', text: 'Earlier AI review marker' }] });
  const prompt = chatContext(safe, today);
  assert.match(prompt, /Manual habit note/);
  assert.doesNotMatch(prompt, /Imported value marker|Earlier AI review marker/);
  assert.equal(safe.logs.length, 1);
});

test('the summary prompt carries scores, weakest habit first, and asks for add and drop advice', () => {
  const today = '2026-11-20';
  let data = habits(today, 3);
  for (let day = 0; day < 7; day++) data = writeLog(data, 'habit-0', shiftDate(today, -day), { status: 'done', value: 1 });
  const prompt = summaryPrompt(data, today, 7, 'Week');
  assert.match(prompt, /week review/);
  assert.match(prompt, /Habits to add/);
  assert.match(prompt, /Habits to drop/);
  assert.match(prompt, /7 of 21 \(33%\)/);
  assert.match(prompt, /- Habit number 0: 7 of 7 at target \(100%\)/);
  assert.ok(prompt.indexOf('Habit number 1') < prompt.indexOf('Habit number 0'), 'weakest habits are listed first');
});

test('the AI sees notes, check-ins, reflections, timeline and why each habit exists', () => {
  const today = '2026-11-20';
  let data = habits(today, 2);
  data = { ...data, habits: data.habits.map((habit, index) => index ? habit : { ...habit, description: 'Calms my head before work' }) };
  data = writeLog(data, 'habit-0', today, { status: 'done', value: 1, note: 'Felt great after' });
  data = {
    ...data,
    checkIns: [{ date: shiftDate(today, -1), mood: 2, energy: 3, note: 'Slept badly', timestamp: new Date().toISOString() }],
    routines: [{ date: today, plan: 'Gym at 7', reflection: 'Skipped gym, too tired' }],
    moments: [{ id: 'm1', date: shiftDate(today, -3), title: 'New job offer', note: 'Big week', kind: 'Milestone' }],
  };
  for (const prompt of [summaryPrompt(data, today, 7, 'Week'), chatContext(data, today)]) {
    for (const text of ['Felt great after', 'Slept badly', 'Gym at 7', 'Skipped gym, too tired', 'New job offer', 'why: Calms my head before work']) {
      assert.ok(prompt.includes(text), `missing ${text}`);
    }
    assert.ok(prompt.indexOf('Skipped gym') < prompt.indexOf('Slept badly'), 'newest journal entries come first');
  }
});

test('a huge history still fits in one message and the chat context stays small', () => {
  const today = '2026-11-20';
  let data = habits(today, 600);
  for (let day = 0; day < 300; day++) {
    data = { ...data, routines: [...data.routines, { date: shiftDate(today, -day), plan: 'x'.repeat(1500), reflection: 'y'.repeat(1500) }] };
  }
  const prompt = summaryPrompt(data, today, 365, 'Year');
  assert.ok(prompt.length <= maxMessageLength);
  assert.match(prompt, /more entries left out/);
  assert.ok(prompt.includes(`- ${today} morning plan`), 'the newest entries survive the cut');
  assert.ok(chatContext(data, today).length <= chatContextLength + 200);
});

test('Sparky remembers past summaries, keeps the newest 60, and shows them to the AI next time', () => {
  const today = '2026-11-20';
  let data = habits(today, 2);
  for (let index = 0; index < 65; index++) {
    data = rememberSummary(data, { id: `s${index}`, date: shiftDate(today, index - 70), days: 7, label: 'Week', text: `Advice number ${index}` });
  }
  assert.equal(data.aiSummaries?.length, keptSummaries);
  assert.equal(data.aiSummaries?.[0].id, 's64', 'newest first');
  assert.ok(parseBackup(data), 'saved summaries survive backup and restore');
  data = rememberSummary(data, { id: 's64', date: today, days: 7, label: 'Week', text: 'Rewritten today' });
  assert.equal(data.aiSummaries?.filter(({ id }) => id === 's64').length, 1, 'writing it again replaces the same summary');
  for (const prompt of [summaryPrompt(data, today, 7, 'Week'), chatContext(data, today)]) {
    assert.ok(prompt.includes('Rewritten today') && prompt.includes('Advice number 63') && prompt.includes('Advice number 62'));
    assert.ok(!prompt.includes('Advice number 61'), 'only the last 3 go back to the AI');
  }
  assert.match(summaryPrompt(data, today, 7, 'Week'), /Since your last review/);
});
