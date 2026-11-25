import assert from 'node:assert/strict';
import test from 'node:test';
import { localDate, parseBackup, startHabitTimer, starterData, stopHabitTimer, writeLog } from '../src/model.ts';

test('elapsed time survives backups, midnight and retries, adding to a manual entry on its start day', () => {
  const start = new Date(2026, 10, 18, 23, 50);
  const date = localDate(start);
  const initial = writeLog(starterData(start), 'read', date, { status: 'done', value: 30, note: 'First chapter' });
  const running = startHabitTimer(initial, 'read', start);
  assert.equal(startHabitTimer(running, 'read', start), running);
  const restored = parseBackup(JSON.parse(JSON.stringify(running)), date);
  const end = new Date(+start + (20 * 60 + 40) * 1000);
  const stopped = stopHabitTimer(restored, 'read', start.toISOString(), end);
  assert.equal(stopped.logs.length, 1);
  assert.equal(stopped.logs[0].value, 50);
  assert.equal(stopped.logs[0].date, date);
  assert.equal(stopped.logs[0].note, 'First chapter');
  assert.equal(stopped.timerRemainders?.[0].seconds, 40);
  assert.equal(stopHabitTimer(stopped, 'read', start.toISOString(), end), stopped);
  assert.deepEqual(parseBackup(stopped,date).habitTimers, []);
});

test('two short sessions earn one whole minute and old stop events cannot stop a newer timer', () => {
  const first = new Date(2026, 10, 18, 11);
  const initial = starterData(first);
  const second = new Date(+first + 65_000);
  const partial = stopHabitTimer(startHabitTimer(initial, 'read', first), 'read', first.toISOString(), new Date(+first+35_000));
  assert.equal(partial.logs.length, 0);
  const running = startHabitTimer(partial, 'read', second);
  assert.equal(stopHabitTimer(running, 'read', first.toISOString(), second), running);
  const final = stopHabitTimer(running, 'read', second.toISOString(), new Date(+second+25_000));
  assert.equal(final.logs[0].value, 1);
  assert.equal(final.timerRemainders?.length, 0);
});


test('a timer crossing its target rings once even when several screens show the same timer', async () => {
  // Outside a browser: a bare window (no Android bridge) so feedback falls back to navigator.vibrate.
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  const { timerCue } = await import('../src/feedback.ts');
  const played: string[] = [];
  const realVibrate = (globalThis.navigator as { vibrate?: unknown } | undefined)?.vibrate;
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (pattern: number[]) => { played.push(pattern.join(',')); return true; } }, configurable: true });
  try {
    const started = '2026-11-24T10:00:00.000Z';
    // Today, the habit sheet and full-screen Focus all see the same crossing.
    for (let screen = 0; screen < 3; screen++) timerCue(started, 'target');
    assert.equal(played.length, 1);
    timerCue(started, 'stretch');
    assert.equal(played.length, 2);
    // A new timer rings again.
    timerCue('2026-11-24T11:00:00.000Z', 'target');
    assert.equal(played.length, 3);
  } finally {
    if (realVibrate === undefined) Reflect.deleteProperty(globalThis, 'navigator');
    if (!hadWindow) Reflect.deleteProperty(globalThis, 'window');
  }
});
