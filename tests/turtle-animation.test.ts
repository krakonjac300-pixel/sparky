import assert from 'node:assert/strict';
import { test } from 'node:test';
import { thumbsUpCycle, thumbsUpRestStep } from '../src/turtle-animation.ts';

const idle = 302;
const frames = (at: (step: number) => { name: string; index: number }, steps: number[]) =>
  steps.map((step) => { const { name, index } = at(step); return `${name}${index}`; });

test('each thumbs up starts from the beginning: lift, wag, lower, then breathe', () => {
  const at = thumbsUpCycle(idle, (cycle) => [1, 2][cycle] ?? 1);
  // Lift from the standing pose, then wag the thumb once.
  assert.deepEqual(frames(at, [0, 120, 241, 242, 543]), ['proud0', 'proud120', 'proud241', 'proud242', 'proud543']);
  // The arm comes back down by replaying the lift backwards, ending on the standing pose.
  assert.deepEqual(frames(at, [544, thumbsUpRestStep - 1]), ['proud241', 'proud0']);
  // Sparky keeps breathing in his idle loop instead of freezing like a picture.
  assert.deepEqual(frames(at, [thumbsUpRestStep, thumbsUpRestStep + 150, thumbsUpRestStep + idle - 1]),
    ['idle0', 'idle150', 'idle301']);
  // After one idle loop the whole thumbs up starts again from the arm lift.
  const second = thumbsUpRestStep + idle;
  assert.deepEqual(frames(at, [second, second + 242]), ['proud0', 'proud242']);
  // The second rest lasts two idle loops before the third thumbs up.
  const third = second + thumbsUpRestStep + 2 * idle;
  assert.deepEqual(frames(at, [third - 1, third]), ['idle301', 'proud0']);
});

test('lowering never skips past the standing pose and every step is a real frame', () => {
  const at = thumbsUpCycle(idle, () => 1);
  let previous = Infinity;
  for (let step = 544; step < thumbsUpRestStep; step++) {
    const { name, index } = at(step);
    assert.equal(name, 'proud');
    assert.ok(index <= previous && index >= 0 && index < 242);
    previous = index;
  }
  for (let step = 0; step < 10 * (thumbsUpRestStep + idle); step += 7) {
    const { name, index } = at(step);
    assert.ok(Number.isInteger(index) && index >= 0 && index < (name === 'proud' ? 544 : idle), `${step}: ${name}${index}`);
  }
});

test('looking ahead past a cycle boundary does not disturb the frame shown now', () => {
  const at = thumbsUpCycle(idle, (cycle) => [1, 2, 1][cycle] ?? 1);
  const reference = thumbsUpCycle(idle, (cycle) => [1, 2, 1][cycle] ?? 1);
  const boundary = thumbsUpRestStep + idle;
  for (let step = boundary - 60; step < boundary + 60; step++) {
    for (const ahead of [1, 20, 40]) at(step + ahead);
    assert.deepEqual(at(step), reference(step), `step ${step}`);
    assert.ok(at(step).index >= 0);
  }
  // Rests stay fixed once chosen, even when asked out of order.
  assert.deepEqual(at(boundary + thumbsUpRestStep + 2 * idle), { name: 'proud', index: 0 });
});

test('the arm comes down at the same pace it went up', () => {
  const at = thumbsUpCycle(idle, () => 1);
  // Lowering replays all 242 lift frames one per step, in reverse.
  assert.equal(thumbsUpRestStep - 544, 242);
  for (let k = 0; k < 242; k++) assert.equal(at(544 + k).index, 241 - k);
});
