import assert from 'node:assert/strict';
import test from 'node:test';
import { focusCycle } from '../src/focus-cycle.ts';
import { guideKeys, programLevels, programStep } from '../src/program-guide.ts';

test('two focus rounds each end with a full break and excludes breaks from work time', () => {
  const at = (seconds: number) => focusCycle(1500, 300, 2, seconds);
  const stages = [0, 1499, 1500, 1799, 1800, 3299, 3300, 3599, 3600].map((seconds) => {
    const step = at(seconds);
    return [step.round, step.onBreak, step.remaining, step.focused, step.finished];
  });
  assert.deepEqual(stages, [
    [1, false, 1500, 0, false], [1, false, 1, 1499, false], [1, true, 300, 1500, false],
    [1, true, 1, 1500, false], [2, false, 1500, 1500, false], [2, false, 1, 2999, false],
    [2, true, 300, 3000, false], [2, true, 1, 3000, false], [2, false, 0, 3000, true],
  ]);
  assert.equal(at(3601).seconds, 3600);
  assert.equal(focusCycle(60, 0, 2, 60).onBreak, false);
  assert.equal(focusCycle(60, 0, 2, 60).remaining, 60);
});

test('all starter guides progress in four stages and offer a smaller fallback', () => {
  for (const guide of guideKeys) {
    for (const duration of [7, 14, 30]) {
      const steps = Array.from({ length: duration }, (_, count) => programStep(guide, count, duration));
      assert.deepEqual([...new Set(steps.map((step) => step.number))], [1, 2, 3, 4]);
      assert.equal(steps[0].easier, undefined);
      assert.ok(steps.at(-1)?.easier);
    }
    const choices = programLevels.map((_, index) => programStep(guide, 0, 7, index + 1));
    assert.equal(new Set(choices.map(({ action }) => action)).size, 8);
    assert.equal(choices.at(-1)?.number, 8);
  }
});
