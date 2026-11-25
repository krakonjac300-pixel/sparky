import type { AppData } from './model.ts';

export type SavedChat = NonNullable<AppData['chats']>[number];
export type ChatTurn = SavedChat['turns'][number];
export const maxChats = 100;
export const maxTurns = 50;

export function ownedChats(chats: SavedChat[], owner?: string) {
  return owner ? chats.filter((chat) => chat.owner === owner) : [];
}

export function chatAtRisk(chats: SavedChat[], id: string | undefined, owner: string) {
  const existing = chats.find((chat) => chat.id === id);
  if (existing) return existing.owner === owner && existing.turns.length >= maxTurns ? existing : undefined;
  return chats.length >= maxChats ? ownedChats(chats, owner).at(-1) : undefined;
}

/** At capacity a new chat can replace only the same owner's oldest chat. */
export function saveChatTurn(data: AppData, id: string, turn: ChatTurn, owner: string): AppData {
  const chats = data.chats ?? [];
  const existing = chats.find((chat) => chat.id === id);
  if (!owner || (existing && existing.owner !== owner)) throw new Error('This chat belongs to a different session.');
  const evicted = !existing && chats.length >= maxChats ? ownedChats(chats, owner).at(-1) : undefined;
  if (!existing && chats.length >= maxChats && !evicted) throw new Error('Device chat history is full.');
  const clean = { ...turn, question: turn.question.slice(0, 4000), answer: turn.answer.slice(0, 20000) };
  const chat: SavedChat = existing
    ? { ...existing, turns: [...existing.turns, clean].slice(-maxTurns) }
    : { id, owner, started: turn.at, turns: [clean] };
  return { ...data, chats: [chat, ...chats.filter((item) => item.id !== id && item.id !== evicted?.id)] };
}

export function deleteChat(data: AppData, id: string, owner: string): AppData {
  return { ...data, chats: (data.chats ?? []).filter((chat) => chat.id !== id || chat.owner !== owner) };
}

export function exportTranscript(chat: SavedChat, owner: string) {
  if (!owner || chat.owner !== owner) throw new Error('Sign in to the account that saved this chat.');
  return JSON.stringify({ id: chat.id, started: chat.started, turns: chat.turns }, null, 2);
}

/** The first question, shortened, names the chat in the list. */
export function chatTitle(chat: SavedChat) {
  const first = chat.turns[0]?.question.replace(/\s+/g, ' ').trim() ?? 'Chat';
  return first.length > 70 ? `${first.slice(0, 67)}...` : first;
}
