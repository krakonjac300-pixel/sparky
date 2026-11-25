import { parseBackup, type AppData } from './model.ts';

export const maxBackupBytes = 32 * 1024 * 1024;

export const legacyBackupCharacters = 40_000_000;
export const maxImportBytes = legacyBackupCharacters * 3;
export const archiveHeader = '["One Life Daybook archive v1",\n';
const recordLimit = 256 * 1024;
const tooLarge = 'This backup is too large.';
const invalid = 'This file is not a valid Sparky backup.';

// Stop a size probe before JSON.stringify has to allocate a whole large snapshot.
function compactWithin(value: unknown, limit: number): string | undefined {
  let minimum = 0;
  const overflow = {};
  try {
    const json = JSON.stringify(value, function (key, item) {
      if (item === undefined) return item;
      minimum += (Array.isArray(this) ? 0 : key.length) + (typeof item === 'string' ? item.length : 1);
      if (minimum > limit) throw overflow;
      return item;
    });
    return json.length <= limit ? json : undefined;
  } catch (cause) {
    if (cause !== overflow) throw cause;
  }
}

// Each JSON array or object declares its children before their records. A leaf
// fits on one line. This also handles collections nested inside a single record.
function* archiveRecords(value: unknown): Generator<string> {
  const json = compactWithin(value, recordLimit - 16);
  if (json !== undefined) { yield '["v",' + json + '],\n'; return; }
  if (Array.isArray(value)) {
    yield '["a",' + value.length + '],\n';
    for (const child of value) yield* archiveRecords(child);
  } else if (typeof value === 'string') {
    const width = 16 * 1024;
    yield '["s",' + Math.ceil(value.length / width) + '],\n';
    for (let start = 0; start < value.length; start += width) yield* archiveRecords(value.slice(start, start + width));
  } else {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined);
    yield '["o",' + JSON.stringify(entries.map(([key]) => key)) + '],\n';
    for (const [, child] of entries) yield* archiveRecords(child);
  }
}

function* backupParts(data: AppData): Generator<string> {
  const snapshot = parseBackup(data);
  const ordinary = compactWithin(snapshot, maxBackupBytes);
  if (ordinary !== undefined && new Blob([ordinary]).size <= maxBackupBytes) { yield ordinary; return; }
  let batch = archiveHeader;
  for (const record of archiveRecords(snapshot)) {
    batch += record;
    if (batch.length >= recordLimit) { yield batch; batch = ''; }
  }
  yield batch + 'null]';
}

export function createBackupFile(data: AppData) {
  const parts: Blob[] = [];
  for (const part of backupParts(data)) parts.push(new Blob([part]));
  return new Blob(parts, { type: 'application/json' });
}

type Container = { kind: 'a' | 'o' | 's'; remaining: number; children: unknown[]; keys?: string[] };

class ArchiveReader {
  private stack: Container[] = [];
  private root: unknown;
  private complete = false;
  private tail = '';

  private record(line: string) {
    if (this.complete || line.length > recordLimit || !line.endsWith(',')) throw new Error(invalid);
    const row = JSON.parse(line.slice(0, -1));
    if (!Array.isArray(row) || row.length !== 2) throw new Error(invalid);
    const [kind, payload] = row;
    let value: unknown = payload;
    if (kind !== 'v') {
      if (kind !== 'a' && kind !== 'o' && kind !== 's') throw new Error(invalid);
      if (kind === 'o' && (!Array.isArray(payload) || !payload.every(k => typeof k === 'string') ||
          new Set(payload).size !== payload.length)) throw new Error(invalid);
      const count = kind === 'o' ? payload.length : payload;
      if (!Number.isSafeInteger(count) || count < 1 || this.stack.length >= 64) throw new Error(invalid);
      this.stack.push({ kind, remaining: count, children: [], keys: kind === 'o' ? payload : undefined });
      return;
    }
    while (this.stack.length) {
      const parent = this.stack[this.stack.length - 1];
      if (parent.kind === 's' && typeof value !== 'string') throw new Error(invalid);
      parent.children.push(value);
      if (--parent.remaining) return;
      this.stack.pop();
      value = parent.kind === 'a' ? parent.children : parent.kind === 's' ? parent.children.join('') :
        Object.fromEntries(parent.keys!.map((key, i) => [key, parent.children[i]]));
    }
    this.complete = true;
    this.root = value;
  }

  append(chunk: string) {
    let start = 0;
    for (let end = chunk.indexOf('\n'); end >= 0; end = chunk.indexOf('\n', start)) {
      this.record(this.tail + chunk.slice(start, end));
      this.tail = '';
      start = end + 1;
    }
    this.tail += chunk.slice(start);
    if (this.tail.length > recordLimit) throw new Error(invalid);
  }

  finish() {
    if (this.tail !== 'null]' || !this.complete) throw new Error(invalid);
    return parseBackup(this.root);
  }
}

export function restoreBackup(content: string, bytes = new Blob([content]).size) {
  if (content.startsWith(archiveHeader)) {
    const reader = new ArchiveReader();
    reader.append(content.slice(archiveHeader.length));
    return reader.finish();
  }
  if (bytes > maxImportBytes || (bytes > maxBackupBytes && content.length > legacyBackupCharacters)) throw new Error(tooLarge);
  return parseBackup(JSON.parse(content));
}

export function serializeBackup(data: AppData) {
  return [...backupParts(data)].join('');
}

export async function* fileChunks(file: Blob) {
  for (let offset = 0; offset < file.size; offset += 64 * 1024) {
    yield new Uint8Array(await file.slice(offset, offset + 64 * 1024).arrayBuffer());
  }
}

export async function readBackupFile(chunks: AsyncIterable<Uint8Array>, knownSize?: number) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let header = '';
  let decided = false;
  let reader: ArchiveReader | undefined;
  const legacy: string[] = [];
  let characters = 0;
  let bytes = 0;
  function append(text: string) {
    if (!decided) {
      header += text;
      if (header.length < archiveHeader.length && archiveHeader.startsWith(header)) return;
      decided = true;
      if (header.startsWith(archiveHeader)) {
        reader = new ArchiveReader();
        text = header.slice(archiveHeader.length);
      } else text = header;
      header = '';
    }
    if (reader) reader.append(text);
    else {
      characters += text.length;
      if ((knownSize ?? bytes) > maxImportBytes || (bytes > maxBackupBytes && characters > legacyBackupCharacters)) throw new Error(tooLarge);
      legacy.push(text);
    }
  }
  for await (const chunk of chunks) {
    bytes += chunk.byteLength;
    append(decoder.decode(chunk, { stream: true }));
  }
  append(decoder.decode());
  return reader ? reader.finish() : restoreBackup(decided ? legacy.join('') : header, bytes);
}

export function downloadJson(content: string | Blob, name: string) {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type: 'application/json' }) : content);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
