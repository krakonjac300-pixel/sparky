import { localDate, parseBackup, starterData, type AppData } from './model.ts';

const STORE = 'state';
let connection: Promise<IDBDatabase> | undefined;

export function storageError(cause: unknown) {
  if (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'QuotaExceededError') {
    return new Error('Device storage is full. Your previous records are still saved. Free up space on this device, then try again.');
  }
  return cause instanceof Error && cause.message.trim() ? cause : new Error('The local save was interrupted. Please try again.');
}

function openDatabase() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('one-life', 1);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        connection = undefined;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Sparky tabs and try again.'));
  }).catch((error) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

export async function updateData(update?: (data: AppData) => AppData): Promise<AppData> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get('app');
    let next: AppData;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? starterData() : parseBackup(request.result);
        next = update ? parseBackup(update(current)) : current;
        const needsRecoveryStart = !next.recoveryStart;
        if (needsRecoveryStart) next = { ...next, recoveryStart: current.recoveryStart ?? localDate() };
        if (update || needsRecoveryStart || request.result?.version !== next.version) store.put(next, 'app');
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = (event) => { failure ??= (event.target as IDBRequest)?.error; };
    transaction.onabort = () => reject(storageError(failure ?? transaction.error));
  });
}
