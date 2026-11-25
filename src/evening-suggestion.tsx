import { useEffect, useRef, useState } from 'react';
import { androidRequest, onAndroid } from './android.ts';
import { freeSlot, reserveSlot, type TimeBlock } from './evening-plan.ts';
import type { Commit } from './expansion.tsx';
import { shiftDate, type AppData, type Habit } from './model.ts';

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

async function readBusy(date: string) {
  const result = await androidRequest<TimeBlock[] | null>('calendarBusy', date, 10000);
  if (result !== null && (!Array.isArray(result) || result.some((item) =>
    !item || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end < item.start))) {
    throw new Error('Could not read the calendar. Try checking again.');
  }
  return result;
}

export function EveningSuggestion({ data, today, habit, commit }: {
  data: AppData; today: string; habit?: Habit; commit: Commit;
}) {
  const tomorrow = shiftDate(today, 1);
  const saved = data.eveningPlans?.find((plan) => plan.date === tomorrow);
  const [busy, setBusy] = useState<TimeBlock[] | null>();
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const lock = useRef(false);
  const open = !saved || editing;
  const target = saved ? data.habits.find((item) => item.id === saved.habitId) : habit;
  const shouldRead = !!target && open && onAndroid();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!shouldRead) return;
    let active = true;
    setChecking(true);
    void readBusy(tomorrow).then((value) => { if (active) setBusy(value); })
      .catch((error: unknown) => { if (active) setNote(error instanceof Error ? error.message : 'Calendar unavailable. Try again.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [tomorrow, shouldRead]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setNote('');
    try { await action(); }
    catch (error) { setNote(error instanceof Error ? error.message : 'Could not complete the calendar request.'); }
    finally { lock.current = false; setWorking(false); }
  }

  if ((!habit && !saved) || !onAndroid()) return null;
  const suggested = target && busy ? freeSlot(tomorrow, target, busy) : undefined;
  const initial = saved?.start ?? suggested?.start;
  const timeValue = chosen ?? (initial === undefined ? '' : new Date(initial).toTimeString().slice(0, 5));
  const start = timeValue ? new Date(tomorrow + 'T' + timeValue).getTime() : NaN;
  const duration = saved ? saved.end - saved.start : (target?.trackingType === 'minutes' ? target.thresholds!.target : 15) * 60000;
  const end = start + duration;
  const fits = Number.isFinite(start) && new Date(end - 1).toDateString() === new Date(start).toDateString();
  const available = (list: TimeBlock[]) => list.every(event => event.end <= start || event.start >= end);
  const title = target?.title ?? 'Habit';
  const pending = working || checking;
  const refresh = async () => {
    const latest = await readBusy(tomorrow);
    setBusy(latest);
    if (latest) setNote(chosen && fits ? available(latest) ? 'Your chosen time is free.' : 'That time overlaps a calendar event.' : 'Calendar checked.');
  };
  return <section className="sparky-planner" aria-label="Plan with Sparky">
    <h3>{saved ? 'Tomorrow’s plan' : 'Make time for tomorrow'}</h3>
    {saved && !editing ? <>
      <p>{title} · {clock(saved.start)} to {clock(saved.end)} · Saved in Sparky</p>
      {target && <button className="secondary-button" onClick={() => { setNote(''); setChosen(undefined); setEditing(true); }}>Change time</button>}
      <button className="text-button" disabled={working} onClick={() => void run(async () => {
        await androidRequest('calendarBlockEditor', JSON.stringify({ ...saved, title }));
      })}>Add to phone calendar</button>
      <button className="text-button" disabled={working} onClick={() => void run(async () => {
        await commit((current) => ({ ...current, eveningPlans: current.eveningPlans?.filter((plan) => plan.date !== tomorrow) }), 'Tomorrow’s block removed.');
        setChosen(undefined);
      })}>Remove block</button>
    </> : target && <>
      <p>{title} · {duration / 60000} min tomorrow</p>
      <label>Start time<input type="time" value={timeValue} disabled={working}
        onChange={(event) => { setChosen(event.target.value); setNote(''); }} /></label>
      {busy === null && <button className="text-button" disabled={pending} onClick={() => void run(async () => {
        if (await androidRequest<boolean>('requestCalendarRead')) await refresh();
        else setNote('You can still save a time in Sparky.');
      })}>Connect calendar</button>}
      {busy && !suggested && chosen === undefined && !saved && <p>No opening fits between 8 AM and 8 PM. You can choose another time.</p>}
      {timeValue && !fits && <p>Choose a time that finishes tomorrow.</p>}
      {busy && fits && !available(busy) && <p>That time overlaps a calendar event.</p>}
      {fits && <button className="secondary-button" disabled={pending || busy === undefined || (!!busy && !available(busy))}
        onClick={() => void run(async () => {
          const latest = await readBusy(tomorrow);
          setBusy(latest);
          if (latest === null && busy !== null) { setNote('Calendar access changed. Review the time before saving.'); return; }
          if (latest && !available(latest)) {
            setNote(chosen === undefined ? 'Your calendar changed. Check the updated suggestion.' : 'Choose another start time.');
            return;
          }
          const ok = await commit((current) => reserveSlot(current, today, { start, end, date: tomorrow, habitId: target.id }, saved), 'Tomorrow’s block saved.');
          if (ok) { setEditing(false); setChosen(undefined); }
          else setNote('The plan could not be saved. Try again.');
        })}>{saved ? 'Save new time' : 'Plan ' + title + ' at ' + clock(start)}</button>}
      <button className="text-button" disabled={pending} onClick={() => void run(refresh)}>{pending ? 'Checking…' : 'Check again'}</button>
      {saved && <button className="text-button" disabled={pending} onClick={() => { setEditing(false); setChosen(undefined); setNote(''); }}>Cancel</button>}
    </>}
    {note && <p role="status">{note}</p>}
  </section>;
}
