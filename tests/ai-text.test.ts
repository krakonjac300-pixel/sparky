import assert from 'node:assert/strict';
import test from 'node:test';
import { aiToPlain, parseAiText, plainText } from '../src/ai-text.ts';

const sample = `## Weekly review

1. **Verdict:** You hit **5 of 7** days. *Solid* week.
2. **Targets**
- **Read**: 7 of 7 at target
- Move or train: 3 of 7
* Gratitude, every day

**What to fix**
Your mornings slip after late nights. Try \`lights out\` by 23:00.
---
3. One focus for next week: protect the morning walk.`;

test('AI text loses every markdown mark and keeps the structure', () => {
  const blocks = parseAiText(sample);
  assert.deepEqual(blocks[0], { kind: 'heading', text: 'Weekly review' });
  assert.deepEqual(blocks[1], { kind: 'heading', text: 'Verdict', body: 'You hit 5 of 7 days. Solid week.' });
  assert.deepEqual(blocks[2], { kind: 'heading', text: 'Targets' });
  assert.deepEqual(blocks[3], { kind: 'list', items: ['Read: 7 of 7 at target', 'Move or train: 3 of 7', 'Gratitude, every day'] });
  assert.deepEqual(blocks[4], { kind: 'heading', text: 'What to fix' });
  assert.equal(blocks[5].kind === 'paragraph' && blocks[5].text, 'Your mornings slip after late nights. Try lights out by 23:00.');
  assert.deepEqual(blocks[6], { kind: 'heading', text: 'One focus for next week', body: 'protect the morning walk.' });
  assert.ok(!/[*#`]/.test(aiToPlain(sample)), 'no stars, hashes or backticks left');
});

test('a bold title with text on the same line becomes a titled section', () => {
  assert.deepEqual(parseAiText('**Verdict:** A solid week.'), [{ kind: 'heading', text: 'Verdict', body: 'A solid week.' }]);
  assert.deepEqual(parseAiText('**Verdict**: Good.'), [{ kind: 'heading', text: 'Verdict', body: 'Good.' }]);
});

test('plain answers and math-like stars survive', () => {
  assert.equal(plainText('5 * 3 is fine'), '5 * 3 is fine');
  assert.deepEqual(parseAiText('Just keep going, you are doing well.'), [{ kind: 'paragraph', text: 'Just keep going, you are doing well.' }]);
});
