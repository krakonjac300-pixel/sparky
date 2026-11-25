import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyError, looksOffline, timeAgo } from '../src/friendly.ts';

test('technical failures become plain words, clear messages pass through', () => {
  assert.match(friendlyError(new Error('Failed to fetch'), 'x'), /offline/);
  assert.match(friendlyError(new Error('The Android request timed out.'), 'x'), /offline/);
  assert.match(friendlyError(new Error('OpenAI returned 401 Unauthorized'), 'x'), /sign-in expired/);
  assert.match(friendlyError(new Error('429 Too Many Requests'), 'x'), /busy/);
  assert.equal(friendlyError(new Error('unknown error'), 'Backup did not save.'), 'Backup did not save.');
  assert.equal(friendlyError(undefined, 'Fallback.'), 'Fallback.');
  assert.equal(friendlyError(new Error('Connect ChatGPT first.'), 'x'), 'Connect ChatGPT first.');
  assert.equal(looksOffline('socket closed'), true);
});

test('sync times read like a person would say them', () => {
  const now = Date.parse('2026-11-21T12:00:00');
  assert.equal(timeAgo(now - 20_000, now), 'just now');
  assert.equal(timeAgo(now - 4 * 60_000, now), '4 min ago');
  assert.equal(timeAgo(now - 3 * 3600_000, now), '3 h ago');
});

test('styles avoid :has(), which Android WebView before version 105 ignores', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['src/styles.css', 'src/daybook.css']) {
    assert.ok(!readFileSync(new URL('../' + file, import.meta.url), 'utf8').includes(':has('), `${file} uses :has()`);
  }
});
