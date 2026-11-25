import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedPhoneScores } from '../src/phone-score.ts';

for (const first of ['summary', 'ack'] as const) {
  test(`${first} arriving first preserves new edits and clears only acknowledged check-ins`, async () => {
    let committed = first === 'summary' ? 0 : 1;
    let displayed = 0;
    const pending = new Set(['first']);
    const writes: number[] = [];
    let started!: () => void;
    let release!: () => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const publish = orderedPhoneScores(async () => committed, async (score, receipts) => {
      if (writes.length === 0) { started(); await hold; }
      writes.push(score);
      displayed = score;
      for (const id of receipts ?? []) pending.delete(id);
    });
    const earlier = publish(first === 'ack' ? ['first'] : undefined);
    await inFlight;
    const later = publish(first === 'summary' ? ['first'] : undefined);
    committed = 2;
    pending.add('second');
    release();
    await Promise.all([earlier, later]);
    assert.deepEqual(writes, [first === 'summary' ? 0 : 1, 2]);
    assert.equal(displayed, 2);
    assert.deepEqual([...pending], ['second']);
  });
}

test('a failed score write allows a later receipt retry', async () => {
  let fail = true;
  const saved: string[] = [];
  const publish = orderedPhoneScores(async () => 1, async (_, ids) => {
    if (fail) { fail = false; throw Error('Interrupted'); }
    saved.push(...(ids ?? []));
  });
  await assert.rejects(publish(['first']), /Interrupted/);
  await publish(['first']);
  assert.deepEqual(saved, ['first']);
});
