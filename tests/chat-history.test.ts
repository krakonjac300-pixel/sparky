import assert from 'node:assert/strict';
import test from 'node:test';
import { privateCoachCommit } from '../src/coach-private.ts';
import { askChatGpt, saveChatModel, setModelOwner } from '../src/ai.ts';
import type { AppData } from '../src/model.ts';
import { calendarDate, parseBackup, starterData } from '../src/model.ts';
import { chatAtRisk, maxTurns, chatTitle, deleteChat, maxChats, saveChatTurn, ownedChats, exportTranscript } from '../src/chat-history.ts';

const at = '2026-11-21T10:00:00.000Z';

test('a delayed model lookup cannot dispatch an old prompt or carry a model choice into another account', async () => {
  const storage = new Map<string, string>();
  const asks: { owner: string; model: string }[] = [];
  const models = [{ id: 'default', name: 'Default' }, { id: 'preferred', name: 'Preferred' }];
  let finishModels!: () => void;
  const bridge = {
    onmessage: (event: { data: string }) => { assert.fail('Unexpected bridge reply ' + event.data); },
    postMessage(raw: string) {
      const { id, action, value } = JSON.parse(raw);
      const reply = (result: unknown) => bridge.onmessage({ data: JSON.stringify({ id, value: result }) });
      if (action === 'chatModels') finishModels = () => reply(models);
      if (action === 'chatAsk') { asks.push(JSON.parse(value)); reply('Answer'); }
    },
  };
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value),
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { OneLifeAndroid: bridge, setTimeout, clearTimeout } });
  try {
    setModelOwner('A');
    saveChatModel('preferred');
    const prompt = [{ role: 'user' as const, content: 'Private A prompt' }];
    const pending = askChatGpt(prompt, { owner: 'A', active: () => true });
    const finishA = finishModels;
    setModelOwner('B');
    const fresh = askChatGpt([{ role: 'user', content: 'B prompt' }], { owner: 'B', active: () => true });
    finishA();
    await assert.rejects(pending, /session changed/);
    assert.equal(asks.length, 0);
    finishModels();
    await fresh;
    assert.equal(asks[0].owner, 'B');
    assert.equal(asks[0].model, 'default');
    const obsolete = askChatGpt(prompt, { owner: 'B', active: () => false });
    await assert.rejects(obsolete, /session changed/);
    assert.equal(asks.length, 1);
  } finally {
    setModelOwner('');
    Reflect.deleteProperty(globalThis, 'window');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('account history isolates legacy and foreign turns, exports and eviction', () => {
  const turn = { question: 'Private question', answer: 'Private answer', at };
  const old = { id: 'legacy', started: at, turns: [turn] };
  let data: AppData = { ...starterData(), chats: [old] };
  data = saveChatTurn(data, 'a', turn, 'A');
  for (let i = 0; i < maxChats - 2; i++) data = saveChatTurn(data, 'b' + i, turn, 'B');
  const chats = parseBackup(data).chats!;
  assert.deepEqual(ownedChats(chats, 'A').map(c => c.id), ['a']);
  assert.deepEqual(ownedChats(chats), []);
  assert.equal(chatAtRisk(chats, undefined, 'A')?.id, 'a');
  assert.equal(chatAtRisk(chats, undefined, 'C'), undefined);
  assert.throws(() => saveChatTurn(data, 'new', turn, 'C'));
  assert.throws(() => saveChatTurn(data, 'a', turn, 'B'));
  assert.throws(() => exportTranscript(old, 'A'));
  const selected = ownedChats(chats, 'A')[0];
  assert.throws(() => exportTranscript(selected, ''));
  assert.throws(() => exportTranscript(selected, 'B'));
  assert.deepEqual(JSON.parse(exportTranscript(selected, 'A')), { id: 'a', started: at, turns: [turn] });
  assert.deepEqual(deleteChat(data, 'a', 'B').chats, chats);
  const next = saveChatTurn(data, 'new', turn, 'A');
  assert.deepEqual(next.chats!.filter(c => c.owner !== 'A'), chats.filter(c => c.owner !== 'A'));
});

test('queued storage updater checks account lifetime and replacement ownership at write time', async () => {
  for (const boundary of ['account', 'reset', 'restore']) {
    let current: AppData = { ...starterData(), coachDataOwner: 'original' };
    let active = true;
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const commit = privateCoachCommit(async update => {
      await wait;
      current = update(current);
      return true;
    }, current.coachDataOwner, () => active);
    const pending = commit(data => saveChatTurn(data, 'late', { at, question: 'late', answer: 'late' }, 'A'), '');
    if (boundary === 'account') active = false;
    else current = { ...current, coachDataOwner: boundary };
    release();
    await assert.rejects(pending, /changed/);
    assert.equal(current.chats?.length ?? 0, 0);
  }
});

test('answers are kept per chat, newest chat first, and survive backup', () => {
  let data = starterData(calendarDate('2026-11-21'));
  data = saveChatTurn(data, 'a', { question: 'How was my week?', answer: 'Solid.', at }, 'A');
  data = saveChatTurn(data, 'b', { question: 'What should I drop?', answer: 'Personal project.', at }, 'A');
  data = saveChatTurn(data, 'a', { question: 'And next week?', answer: 'Protect mornings.', at }, 'A');
  assert.deepEqual(data.chats?.map(({ id }) => id), ['a', 'b'], 'the chat you just used moves to the top');
  assert.equal(data.chats?.[0].turns.length, 2);
  assert.equal(chatTitle(data.chats![0]), 'How was my week?');
  assert.ok(parseBackup(data));
  data = deleteChat(data, 'a', 'A');
  assert.deepEqual(data.chats?.map(({ id }) => id), ['b']);
});

test('old chats fall off past the limit', () => {
  let data = starterData(calendarDate('2026-11-21'));
  for (let i = 0; i < maxChats + 5; i++) data = saveChatTurn(data, `c${i}`, { question: `Q${i}`, answer: 'A', at }, 'A');
  assert.equal(data.chats?.length, maxChats);
  assert.equal(data.chats?.[0].id, `c${maxChats + 4}`);
  assert.ok(parseBackup(data));
});

test('warns about exactly the saved history the next answer would displace', () => {
  let data = starterData(calendarDate('2026-11-21'));
  const turn = { question: 'First', answer: 'Answer', at };
  for (let i = 0; i < maxChats; i++) data = saveChatTurn(data, String(i), turn, 'A');
  assert.equal(chatAtRisk(data.chats!, undefined, 'A')?.id, '0');
  assert.equal(chatAtRisk(data.chats!, '0', 'A'), undefined);
  for (let i = 1; i < maxTurns; i++) data = saveChatTurn(data, '0', { ...turn, question: String(i) }, 'A');
  const endangered = chatAtRisk(data.chats!, '0', 'A')!;
  assert.equal(endangered.turns[0].question, 'First');
  const exported = JSON.stringify(endangered);
  data = saveChatTurn(data, '0', turn, 'A');
  assert.equal(data.chats?.[0].turns[0].question, '1');
  assert.equal(JSON.parse(exported).turns.length, maxTurns);
  assert.equal(chatAtRisk(data.chats!, undefined, 'A')?.id, '1');
});
