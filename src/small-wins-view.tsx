import { useState, type FormEvent } from 'react';
import { Check, Minus, Pencil, Plus, X } from 'lucide-react';
import type { AppData } from './model.ts';
import type { Commit } from './expansion.tsx';
import { feedback } from './feedback.ts';
import { turtleHabitProgress } from './budget-coach.ts';
import {
  defaultSmallWins, removeSmallWin, saveSmallWin, smallWinsAsHabit, smallWinCount, smallWinItems, smallWinProgress, tapSmallWin, undoSmallWin,
  type SmallWin,
} from './small-wins.ts';

/** Everyday basics that together count as one habit for Sparky. */
export function SmallWins({ data, today, commit }: { data: AppData; today: string; commit: Commit }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const wins = smallWinItems(data, today);
  const sparky = smallWinsAsHabit(data, today);
  const done = sparky.done;
  const missingPresets = defaultSmallWins.filter((preset) => !wins.some((win) => win.id === preset.id));

  async function change(update: (current: AppData) => AppData, message: string) {
    if (busy) return false;
    setBusy(true);
    try { return await commit(update, message); } finally { setBusy(false); }
  }

  function tap(win: SmallWin) {
    const before = smallWinCount(data, win.id, today);
    const undo = win.goal === 1 && before >= 1;
    const finished = (state: AppData) => { const day = turtleHabitProgress(state, today); return day.total > 0 && day.done >= day.total; };
    const allDone = !undo && !finished(data) && finished(tapSmallWin(data, win, today));
    feedback(allDone ? 'allDone' : undo ? 'undo' : before + 1 >= win.goal ? 'done' : 'win');
    if (allDone) window.dispatchEvent(new Event('one-life-all-done'));
    void change((current) => tapSmallWin(current, win, today), undo ? `${win.title} undone.` : `${win.title} · small win`);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;
    const target = event.currentTarget;
    const goal = Math.min(50, Math.max(1, Math.round(Number(form.get('goal')) || 1)));
    if (await change((current) => saveSmallWin(current, {
      title, emoji: String(form.get('emoji') ?? '').trim().slice(0, 16) || '⭐', goal, step: 1, unit: String(form.get('unit') ?? '').trim().slice(0, 12),
    }, today), `${title} added to small wins.`)) target.reset();
  }

  return <section className="small-wins" aria-labelledby="small-wins-title">
    <div className="section-heading">
      <div><h2 id="small-wins-title">Small wins</h2>
        <p className="muted small-wins-count">{done ? `${done} of ${wins.length} done today` : 'Tap one when you do it'}</p></div>
      <button type="button" className="text-button" onClick={() => setEditing(!editing)}>
        {editing ? <><Check size={16} /> Done</> : <><Pencil size={15} /> Edit</>}</button>
    </div>
    {sparky.counted && <div className={`win-sparky${sparky.reached ? ' reached' : ''}`}>
      <span className="win-sparky-face" aria-hidden="true" />
      <span>{sparky.reached ? 'Counts as a habit for Sparky today' : `${sparky.needed - done} more for Sparky to count them as a habit`}</span>
      <span className="win-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, 100 * done / Math.max(1, sparky.needed))}%` }} /></span>
    </div>}
    <ul className="win-grid">{wins.map((win) => {
      const count = smallWinCount(data, win.id, today);
      const complete = count >= win.goal;
      const progress = smallWinProgress(win, count);
      return <li key={win.id} className={`win-tile${complete ? ' win-done' : ''}`}>
        <button type="button" className="win-tap" disabled={busy || editing} aria-pressed={complete}
          aria-label={`${win.title}${progress ? `, ${progress}` : ''}`} onClick={() => tap(win)}>
          <span className="win-emoji" aria-hidden="true">{win.emoji}</span>
          <span className="win-title">{win.title}</span>
          {progress && <span className="win-progress">{progress}</span>}
          {win.goal > 1 && <span className="win-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, 100 * count / win.goal)}%` }} /></span>}
          {complete && <span className="win-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>}
        </button>
        {!editing && win.goal > 1 && count > 0 && <button type="button" className="win-minus" disabled={busy} aria-label={`One less ${win.title}`}
          onClick={() => { feedback('undo'); void change((current) => undoSmallWin(current, win, today), `${win.title} updated.`); }}><Minus size={14} /></button>}
        {editing && <button type="button" className="win-minus win-remove" disabled={busy} aria-label={`Remove ${win.title}`}
          onClick={() => void change((current) => removeSmallWin(current, win.id, today), `${win.title} removed.`)}><X size={14} /></button>}
      </li>;
    })}</ul>
    {editing && <div className="panel settings-panel win-editor">
      <h3>Add a small win</h3>
      <form className="win-form" onSubmit={(event) => void add(event)}>
        <label className="win-emoji-field">Icon<input name="emoji" maxLength={16} placeholder="⭐" /></label>
        <label>Name<input name="title" maxLength={60} required placeholder="Water the plants" /></label>
        <label>Times a day<input name="goal" type="number" min={1} max={50} defaultValue={1} inputMode="numeric" /></label>
        <label>Unit (optional)<input name="unit" maxLength={12} placeholder="glasses" /></label>
        <button className="primary-button" disabled={busy}><Plus size={16} /> Add</button>
      </form>
      {missingPresets.length > 0 && <><h3>Bring back</h3>
        <div className="win-presets">{missingPresets.map((preset) => <button key={preset.id} type="button" className="secondary-button" disabled={busy}
          onClick={() => void change((current) => saveSmallWin(current, preset, today), `${preset.title} added back.`)}>{preset.emoji} {preset.title}</button>)}</div></>}
    </div>}
    <p className="muted small-wins-note">Finish {sparky.needed} of {wins.length} small wins (70%) and they count as one habit for Sparky. They also show up in your AI summaries.</p>
  </section>;
}
