import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveHeader, createBackupFile, fileChunks, legacyBackupCharacters, maxBackupBytes, maxImportBytes, readBackupFile, restoreBackup, serializeBackup } from '../src/backup.ts';
import { starterData } from '../src/model.ts';
import { androidRequest, readAndroidBackup } from '../src/android.ts';
import { storageError } from '../src/storage.ts';

test('multibyte backups cross the former limit and legacy snapshots remain recoverable', () => {
  const data = starterData();
  const at = '2026-10-01T00:00:00Z';
  const question = 'What happened?';
  const answer = '日'.repeat(20_000);
  const turns = Array.from({ length: 50 }, () => ({ question, answer, at }));
  data.chats = Array.from({ length: 4 }, (_, i) => ({ id: String(i), started: at, turns }));
  const content = serializeBackup(data);
  assert.ok(Buffer.byteLength(content) > 8 * 1024 * 1024);
  assert.deepEqual(restoreBackup(content).chats, data.chats);
  data.chats = Array.from({ length: 12 }, (_, i) => ({ id: String(i), started: at, turns }));
  const legacy = JSON.stringify(data);
  assert.ok(Buffer.byteLength(legacy) > maxBackupBytes);
  assert.deepEqual(restoreBackup(serializeBackup(data)).chats, data.chats);
  assert.deepEqual(restoreBackup(legacy).chats, data.chats);
  assert.throws(() => restoreBackup('{}', maxImportBytes + 1), /too large/);
  assert.throws(() => restoreBackup('malformed'), SyntaxError);
});

function chatHistory(count: number, answer: string) {
  const at = '2026-01-01T00:00:00Z';
  return Array.from({ length: count }, (_, i) => ({
    id: String(i), started: at, turns: Array.from({ length: 50 }, () => ({ question: '?', answer, at })),
  }));
}

test('the exact ordinary boundary stays compatible and a one-byte-larger legacy file recovers after an edit', async () => {
  const data = starterData();
  data.chats = chatHistory(34, 'a');
  const turns = data.chats.flatMap(chat => chat.turns);
  const extra = maxBackupBytes - Buffer.byteLength(JSON.stringify(data));
  turns.forEach((turn, i) => { turn.answer += 'a'.repeat(Math.floor(extra / turns.length) + Number(i < extra % turns.length)); });
  const ordinary = createBackupFile(data);
  assert.equal(ordinary.size, maxBackupBytes);
  assert.equal((await ordinary.slice(0, 1).text()), '{');
  turns[0].answer += 'x';
  const legacy = new Blob([JSON.stringify(data)]);
  assert.equal(legacy.size, maxBackupBytes + 1);
  const edited = await readBackupFile(fileChunks(legacy), legacy.size);
  edited.settings.theme = 'dark';
  edited.recoveryStart = '2026-11-23';
  const archive = createBackupFile(edited);
  assert.equal(await archive.slice(0, archiveHeader.length).text(), archiveHeader);
  assert.deepEqual(await readBackupFile(fileChunks(archive), archive.size), edited);
});

test('near-ceiling multilingual import with additional records transfers beyond the absolute legacy limit', async () => {
  const data = starterData();
  data.chats = chatHistory(40, '日'.repeat(19800));
  const legacy = new Blob([JSON.stringify(data)]);
  assert.ok(legacy.size > 118_000_000 && legacy.size < maxImportBytes);
  const restored = await readBackupFile(fileChunks(legacy), legacy.size);
  restored.chats!.push({ ...chatHistory(1, '界'.repeat(20000))[0], id: 'after-import' });
  const archive = createBackupFile(restored);
  assert.ok(archive.size > maxImportBytes);
  const copied = await readBackupFile(fileChunks(archive), archive.size);
  assert.deepEqual(copied, restored);
  const invalid = new Blob([legacy, ' '.repeat(maxImportBytes + 1 - legacy.size)]);
  await assert.rejects(readBackupFile(fileChunks(invalid), invalid.size), /too large/);
});

test('legacy character boundary, version one migration and incomplete archives', async () => {
  const data = starterData();
  const json = JSON.stringify({ ...data, version: 1 }).padEnd(legacyBackupCharacters);
  assert.equal(restoreBackup(json).version, 2);
  assert.throws(() => restoreBackup(json + ' '), /too large/);
  for (const body of ['["a",2],\n["v",1],\nnull]', '["v",{}],\n["v",{}],\nnull]', '["v",{}],\nnull', 'x'.repeat(300000)]) {
    const file = new Blob([archiveHeader, body]);
    await assert.rejects(readBackupFile(fileChunks(file)));
  }
  assert.match(storageError(new DOMException('', 'QuotaExceededError')).message, /Free up space/);
  assert.ok(storageError(new Error('')).message);
});

test('native transfers fit bounded messages and preserve split Unicode characters', async () => {
  const data = starterData();
  data.chats = chatHistory(1, '😀'.repeat(300));
  const content = JSON.stringify(data);
  const utf8 = Buffer.from(content);
  const parts: Buffer[] = [];
  let position = 0;
  let closed = false;
  const bridge = {
    onmessage: (_event: { data: string }) => {},
    postMessage(json: string) {
      const { action, id, value } = JSON.parse(json);
      let result: unknown = true;
      if (action === 'backupAppendBytes') {
        assert.ok(value.length <= 65536);
        parts.push(Buffer.from(value, 'base64'));
      }
      if (action === 'backupRead') {
        result = utf8.subarray(position, position + 8191).toString('base64');
        position += 8191;
      }
      if (action === 'backupClose') closed = true;
      queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ id, value: result }) }));
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { OneLifeAndroid: bridge, setTimeout, clearTimeout } });
  try {
    await androidRequest('autoBackup', content);
    assert.deepEqual(Buffer.concat(parts), utf8);
    assert.deepEqual((await readAndroidBackup())?.chats, data.chats);
    assert.equal(closed, true);
  } finally { Reflect.deleteProperty(globalThis, 'window'); }
});
