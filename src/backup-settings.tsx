import { useEffect, useRef, useState } from 'react';
import { androidRequest, onAndroid } from './android.ts';
import { createBackupFile } from './backup.ts';
import type { AppData } from './model.ts';

type Status = { supported: boolean; enabled: boolean; last: number; copies?: number };

async function sameFile(a: Blob, b?: Blob) {
  if (!b || a.size !== b.size) return false;
  const step = 128 * 1024;
  for (let offset = 0; offset < a.size; offset += step) {
    const [left, right] = await Promise.all([a, b].map(async file =>
      new Uint8Array(await file.slice(offset, offset + step).arrayBuffer())));
    if (!left.every((byte, i) => byte === right[i])) return false;
  }
  return true;
}

export function useDownloadsBackup(data: AppData | undefined, today: string) {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  const latest = useRef({ data, today });
  latest.current = { data, today };
  const generation = useRef(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (onAndroid()) void androidRequest<Status>('backupStatus').then(setStatus)
      .catch(() => setError('Could not read backup settings. Reopen Sparky to retry.'));
  }, []);

  useEffect(() => {
    if (!status?.enabled) return;
    let active = true;
    let timer: number;
    let previous: Blob | undefined;
    let previousDay = '';
    let previousData: AppData | undefined;
    const refresh = async () => {
      const { data: snapshot, today: day } = latest.current;
      const started = generation.current;
      try {
        if (snapshot && (snapshot !== previousData || previousDay !== day)) {
          const content = createBackupFile(snapshot);
          if (previousDay !== day || !await sameFile(content, previous)) {
            if (!active || started !== generation.current) return;
            const saved = await androidRequest<Status>('autoBackup', content);
            if (active && started === generation.current) { setStatus(saved); setError(''); }
            previous = content;
            previousDay = day;
          }
          previousData = snapshot;
        }
      } catch (cause) {
        if (active && started === generation.current) setError((cause instanceof Error ? cause.message : 'Backup failed.') + ' Will retry in one minute.');
      } finally {
        if (active) timer = window.setTimeout(refresh, 60000);
      }
    };
    timer = window.setTimeout(refresh, 1000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [status?.enabled]);

  async function change(action: 'on' | 'off' | 'clear') {
    generation.current++;
    setPending(true);
    try {
      setStatus(await androidRequest<Status>(action === 'clear' ? 'backupClear' : 'backupEnabled', action));
      setError('');
    } catch {
      const actual = await androidRequest<Status>('backupStatus').catch(() => undefined);
      setStatus(actual);
      const state = actual ? `Automatic copies are ${actual.enabled ? 'on' : 'off'}.` : 'Could not verify the automatic copy setting.';
      const remaining = actual?.copies === undefined ? '' : ` ${actual.copies} automatic ${actual.copies === 1 ? 'file remains' : 'files remain'}.`;
      const message = `${state}${remaining} Check Downloads/Sparky and try again.`;
      setError(message);
      throw new Error(message);
    } finally { setPending(false); }
  }
  return { status, error, pending, change };
}

export function BackupSettings({ control }: { control: ReturnType<typeof useDownloadsBackup> }) {
  const { status, error, pending, change } = control;
  const [confirm, setConfirm] = useState(false);
  return <>
    <p className="muted">A full backup includes device records, including saved chats from all accounts, even when signed out. It can also include reflections, health history, app usage and AI reviews. Anyone with the file can read it. Choose a new filename in a private location.</p>
    <p className="muted">Backups over 32 MiB use a Sparky JSON archive. Copy the whole file to another device and use Import JSON in this version of Sparky or later. Earlier Sparky JSON backups can also be restored.</p>
    {status?.supported ? <>
      <p>Automatic copies in Downloads/Sparky are {status.enabled ? 'on' : 'off'}. They contain the same readable device records as a full export. While Sparky is open, it checks every minute and keeps one copy for each of the latest 30 saved dates. Files can survive reset and uninstall.</p>
      <p>Last verified automatic copy: {status.last ? new Date(status.last).toLocaleString() : 'None recorded'}</p>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => void change(status.enabled ? 'off' : 'on').catch(() => {})}>{status.enabled ? 'Turn off automatic copies' : 'Allow automatic copies'}</button>
      <button type="button" className="text-button" disabled={pending} onClick={() => setConfirm(true)}>Remove automatic copies</button>
      {confirm && <div><p>Turn off copying and delete automatic files owned by this installation? Check Files for other copies.</p>
        <button type="button" disabled={pending} onClick={() => void change('clear').then(() => setConfirm(false)).catch(() => {})}>Delete automatic files</button>
        <button type="button" onClick={() => setConfirm(false)}>Cancel removal</button></div>}
    </> : <p>{onAndroid() && !status ? 'Checking automatic backup availability.' : 'This device supports manual exports only.'}</p>}
    {error && <p role="alert">{error}</p>}
  </>;
}
