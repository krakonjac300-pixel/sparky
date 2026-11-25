import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Commit } from './expansion.tsx';
import { newId, shiftDate, type AppData } from './model.ts';
import { androidRequest, onAndroid } from './android.ts';
import { FocusDialog, FocusStage } from './focus-mode.tsx';
import { focusCycle } from './focus-cycle.ts';
import { useFocusAwake } from './focus-awake.ts';
import { feedback, feedbackEnabled } from './feedback.ts';

type Session = NonNullable<AppData['activeFocus']>;

export function FocusSessions({ data, today, commit, visible }: { data: AppData; today: string; commit: Commit; visible: boolean }) {
  const session = data.activeFocus;
  const started = session?.started;
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startButton = useRef<HTMLButtonElement>(null);
  const returnToStart = useRef(false);
  useEffect(() => {
    if (!visible) returnToStart.current = false;
    else if (session) returnToStart.current = true;
    else if (!busy && returnToStart.current) {
      returnToStart.current = false;
      startButton.current?.focus();
    }
  }, [visible, !!session, busy]);
  useEffect(() => {
    if (started === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [started]);
  const { total, seconds, round, onBreak, remaining, focused, progress, finished } = focusCycle(
    session?.work ?? 1, session?.rest ?? 0, session?.rounds ?? 1,
    (session?.elapsed ?? 0) + (started === undefined ? 0 : Math.max(0, Math.floor((now - started) / 1000))),
  );
  useFocusAwake(visible && !!session && started !== undefined && !finished);
  const previousPhase = useRef('');
  const phase = session ? `${session.id}:${round}:${finished ? 'finished' : onBreak ? 'break' : 'work'}` : '';
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (!session || started === undefined || previous === phase || !previous.startsWith(`${session.id}:`)) return;
    const cue = finished ? 'finished' : onBreak ? 'break' : 'work';
    if (onAndroid()) void androidRequest('focusCue', JSON.stringify({ phase: cue, sound: feedbackEnabled('sound'),
      vibration: feedbackEnabled('haptics') }), 3000).catch(() => undefined);
    else feedback(finished ? 'allDone' : onBreak ? 'done' : 'win');
  }, [finished, onBreak, phase, session, started]);
  const history = data.focusHistory ?? [];
  const minutes = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  function replace(current: AppData, next?: Session): AppData {
    if (current.activeFocus?.id !== session?.id || current.activeFocus?.started !== started ||
        current.activeFocus?.elapsed !== session?.elapsed) throw new Error('Focus changed in another window.');
    return { ...current, activeFocus: next };
  }
  async function runTimer(next: Session, duration: number) {
    if (next.quiet) await androidRequest('focusSilenceStart', String(duration));
    const time = Date.now();
    setNow(time);
    if (!(await commit((current) => replace(current, { ...next, started: time }), '')) && next.quiet) {
      await androidRequest('focusSilenceEnd');
    }
  }
  async function protect(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not change Do Not Disturb.'); }
    finally { setBusy(false); }
  }
  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const selected = fields.get('link');
    const title = data.goals.find(({ id }) => id === selected)?.title ?? (String(fields.get('task') ?? '').trim() || 'Personal focus');
    const next = { id: newId(), date: today, title, elapsed: 0, work: Number(fields.get('work')) * 60,
      rest: Number(fields.get('rest')) * 60, rounds: Number(fields.get('rounds')), strict: fields.has('strict'), quiet: onAndroid() && fields.has('quiet') };
    void protect(() => runTimer(next, focusCycle(next.work, next.rest, next.rounds, 0).total));
  }
  async function stop() {
    if (!session || busy) return;
    await protect(async () => {
      if (session.quiet) await androidRequest('focusSilenceEnd');
      await commit((current) => focused === 0 ? replace(current) : ({ ...replace(current), focusHistory: [
        ...(current.focusHistory ?? []).filter(({ id }) => id !== session.id),
        { id: session.id, date: session.date, title: session.title, seconds: focused },
      ] }), focused === 0 ? '' : 'Focus session saved.');
    });
  }
  return <div className="expanded-stack">
    <section className="panel settings-panel">
      <h2>Focus sessions</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {session ? visible && <FocusDialog title={session.title}>
        <div className="focus-top"><span className="focus-label">Focus with Sparky</span></div>
        <h3 className="focus-title">{session.title}</h3>
        <FocusStage key={`${round}:${onBreak}:${finished}`} progress={progress} proud={onBreak || finished} />
        <strong className="focus-time" role="timer" aria-live="off">{minutes(Math.max(0, remaining))}</strong>
        <p className="focus-detail" role="status">{finished ? 'Finished' : `${onBreak ? 'Break' : 'Work'} ${round} of ${session.rounds}`}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <p>{minutes(focused)} of focused time</p>
        <div className="connection-actions">
          {seconds < total && <button className="secondary-button" disabled={busy} onClick={() => void protect(async () => {
            if (started !== undefined) {
              if (session.quiet) await androidRequest('focusSilenceEnd');
              await commit((current) => replace(current, { ...session, elapsed: seconds, started: undefined }), '');
            } else {
              await runTimer(session, total - seconds);
            }
          })}>{started === undefined ? 'Resume' : 'Pause'}</button>}
          {!session.strict && <button className="secondary-button" disabled={busy} onClick={() => void protect(async () => {
            previousPhase.current = '';
            await runTimer({ ...session, elapsed: 0 }, total);
          })}>Restart</button>}
          <button className="primary-button" disabled={busy} onClick={() => {
            if (!session.strict || seconds === total || window.confirm('End your focus commitment early and save time already focused?')) void stop();
          }}>{seconds === total ? 'Save session' : 'Stop and save'}</button>
        </div>
      </FocusDialog> : <form className="form-stack" onSubmit={start}>
        <p className="muted">Use Today to time and log a habit. Start here for a quiet block for a separate task.</p>
        <label>Task (optional)<input name="task" maxLength={100} /></label>
        {data.goals.length > 0 && <label>Link a goal<select name="link"><option value="">No goal</option>
          <optgroup label="Goals">{data.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</optgroup>
        </select></label>}
        <div className="form-grid">
          <label>Work minutes<input name="work" type="number" min={1} max={120} defaultValue={25} required /></label>
          <label>Break minutes<input name="rest" type="number" min={0} max={60} defaultValue={5} required /></label>
          <label>Rounds<input name="rounds" type="number" min={1} max={8} defaultValue={2} required /></label>
        </div>
        <p className="muted">Every work round ends with a break, including the last round.</p>
        <label className="check-label"><input type="checkbox" name="strict" /> Confirm before ending early</label>
        {onAndroid() && <>
          <label className="check-label"><input type="checkbox" name="quiet" defaultChecked /> Turn on Do Not Disturb during this session</label>
          <p className="muted">Focus cues use Android’s alarm volume. Other alarms can still ring.</p>
          <div className="connection-actions">
            <button type="button" className="text-button" onClick={() => void protect(() => androidRequest<void>('focusSilenceSettings'))}>Allow Do Not Disturb access</button>
            <button type="button" className="text-button" onClick={() => void protect(() => androidRequest<void>('openExactReminderSettings'))}>Allow exact alarms</button>
          </div>
        </>}
        <button ref={startButton} className="primary-button" disabled={busy}>Start focus session</button>
      </form>}
    </section>
    <section className="panel settings-panel"><h2>Focus history</h2>
      <p>Today {minutes(history.filter(({ date }) => date === today).reduce((sum, item) => sum + item.seconds, 0))} · Past seven days {minutes(history.filter(({ date }) => date >= shiftDate(today, -6) && date <= today).reduce((sum, item) => sum + item.seconds, 0))}</p>
      {history.length ? <ul>{[...history].reverse().slice(0, 10).map((item) => <li key={item.id}>{item.date} · {item.title} · {minutes(item.seconds)}</li>)}</ul> : <p className="muted">No focus sessions saved.</p>}
    </section>
  </div>;
}
