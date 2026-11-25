import { readBackupFile } from './backup.ts';

type Bridge = { postMessage: (message: string) => void; onmessage?: (event: MessageEvent<string>) => void };

declare global {
  interface Window { OneLifeAndroid?: Bridge }
}

const requests = new Map<string, { finish: (value: unknown, error?: string) => void }>();
let nextRequest = 0;

export function onAndroid() {
  return typeof window.OneLifeAndroid?.postMessage === 'function';
}

export function isAndroidAppPage() {
  return window.location.origin === 'https://appassets.androidplatform.net';
}

// A small direct message fits even when JSON escaping expands every character.
const directLimit = 16 * 1024;
let uploading = Promise.resolve();

export function androidRequest<T>(action: string, value: string | Blob = '', timeoutMs = 240000): Promise<T> {
  if (value instanceof Blob || (['export', 'exportChat', 'autoBackup'].includes(action) && value.length > directLimit)) {
    const file = typeof value === 'string' ? new Blob([value]) : value;
    const upload = uploading.then(async () => {
      if (file.size <= directLimit) return bridgeRequest<T>(action, await file.text(), timeoutMs);
      await bridgeRequest('backupBegin');
      try {
        const chunkSize = 48 * 1024;
        for (let start = 0; start < file.size; start += chunkSize) {
          const bytes = new Uint8Array(await file.slice(start, start + chunkSize).arrayBuffer());
          await bridgeRequest('backupAppendBytes', btoa(String.fromCharCode(...bytes)));
        }
        return await bridgeRequest<T>('backupFinish', action, timeoutMs);
      } catch (cause) {
        await bridgeRequest('backupAbort').catch(() => {});
        throw cause;
      }
    });
    uploading = upload.then(() => {}, () => {});
    return upload;
  }
  return bridgeRequest<T>(action, value, timeoutMs);
}

let reading = false;
export async function readAndroidBackup() {
  if (reading) throw new Error('Finish the current backup import first.');
  reading = true;
  try {
    if (!await bridgeRequest<boolean>('import')) return;
    async function* chunks() {
      for (;;) {
        const encoded = await bridgeRequest<string>('backupRead');
        if (!encoded) return;
        yield Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      }
    }
    try { return await readBackupFile(chunks()); }
    finally { await bridgeRequest('backupClose'); }
  } finally { reading = false; }
}

function bridgeRequest<T>(action: string, value = '', timeoutMs = 240000) {
  const bridge = window.OneLifeAndroid;
  if (!bridge) return Promise.reject<T>(new Error('Available in the installed Android app.'));
  bridge.onmessage = (event) => {
    const reply = JSON.parse(event.data) as { id: string; value: unknown; error?: string };
    requests.get(reply.id)?.finish(reply.value, reply.error);
  };
  return new Promise<T>((resolve, reject) => {
    const id = String(++nextRequest);
    const timer = window.setTimeout(() => {
      requests.delete(id);
      reject(new Error('The Android request timed out.'));
    }, timeoutMs);
    requests.set(id, { finish(result, error) {
      window.clearTimeout(timer);
      requests.delete(id);
      if (error) reject(new Error(error));
      else resolve(result as T);
    } });
    try { bridge.postMessage(JSON.stringify({ id, action, value })); }
    catch { requests.get(id)?.finish(undefined, 'Could not reach the Android app.'); }
  });
}

export async function shareText(text: string) {
  if (onAndroid()) await androidRequest('share', text);
  else if (navigator.share) await navigator.share({ text });
  else throw new Error('This browser does not have a share menu. Select the text and copy it instead.');
}
