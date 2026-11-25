import { useState, type FormEvent } from 'react';
import { Dialog } from './forms.tsx';
import type { Commit } from './expansion.tsx';
import { newId, type AppData } from './model.ts';
import { guideKeys, programGuides, programLevels } from './program-guide.ts';
import { exerciseFor, guideFor } from './program-exercise.ts';
import { ProgramTips } from './program-tips.tsx';

type Program = NonNullable<AppData['programs']>[number];

export function Programs({ data, today, commit }: { data: AppData; today: string; commit: Commit }) {
  const [editor, setEditor] = useState<Partial<Program>>();
  const [removing, setRemoving] = useState<string>();
  const target = data.programs?.find((item) => item.id === removing);
  const [busy, setBusy] = useState(false);
  async function update(change: (items: Program[], current: AppData) => Program[], message: string) {
    if (busy) return false;
    setBusy(true);
    try { return await commit((current) => ({ ...current, programs: change(current.programs ?? [], current) }), message); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const title = String(fields.get('title')).trim();
    const guide = editor && guideFor(editor);
    const action = String(fields.get('action')).trim() || (guide ? programGuides[guide].original : '');
    if (!title || !action) return;
    const habitId = String(fields.get('habit') ?? '') || undefined;
    const duration = Number(fields.get('duration')) as Program['duration'];
    const id = editor?.id ?? newId();
    if (await update((items) => {
      const original = items.find((item) => item.id === id);
      const next = { id, title, action, habitId, duration, started: original?.started ?? today,
        status: original?.status ?? 'active' as const, days: original?.days ?? [], entries: original?.entries,
        guide, repeatDays: original?.repeatDays, level: original?.level };
      return original ? items.map((item) => item.id === id ? next : item) : [...items, next];
    }, 'Program saved.')) setEditor(undefined);
  }

  return <div className="expanded-stack">
    {target && <Dialog title={`Remove ${target.title}?`} confirmation close={() => { if (!busy) setRemoving(undefined); }}>
      <p>This permanently deletes this program, its practice days and journal. Linked habits and their logs are kept.</p>
      {data.pinnedProgramId === target.id && <p>This also removes the pinned exercise from Today.</p>}
      <div className="connection-actions">
        <button className="secondary-button" disabled={busy} onClick={() => setRemoving(undefined)}>Cancel</button>
        <button className="danger-button" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            if (await commit((current) => ({
              ...current, programs: (current.programs ?? []).filter((item) => item.id !== target.id),
              pinnedProgramId: current.pinnedProgramId === target.id ? undefined : current.pinnedProgramId,
            }), 'Program removed.')) {
              if (editor?.id === target.id) setEditor(undefined);
              setRemoving(undefined);
            }
          } finally { setBusy(false); }
        }}>Confirm removal</button>
      </div>
    </Dialog>}
    <section className="panel settings-panel">
      <h2>Programs</h2>
      <p className="muted">Pick a program and start with a small practice. You can repeat a step whenever you need more time.</p>
      <div className="connection-actions">{guideKeys.map((guide) => {
        const { title, original } = programGuides[guide];
        return <button key={guide} className="secondary-button" onClick={() => setEditor({ title, action: original, guide })}>{title}</button>;
      })}
        <button className="secondary-button" onClick={() => setEditor({})}>Create a program</button>
      </div>
      {editor && <form key={editor.id ?? editor.title ?? 'new'} className="form-stack" onSubmit={(event) => void save(event)}>
        <label>Objective<input name="title" required maxLength={80} defaultValue={editor.title} /></label>
        {(() => {
          const guide = guideFor(editor);
          return guide ? <>
            <p><strong>First step</strong> · {programGuides[guide].steps[0]}</p>
            <label>Personal practice cue (optional)<textarea name="action" maxLength={160}
              defaultValue={editor.action === programGuides[guide].original ? '' : editor.action} /></label>
          </> : <label>Daily action<textarea name="action" required maxLength={160} defaultValue={editor.action} /></label>;
        })()}
        <label>Practice days<select name="duration" defaultValue={editor.duration ?? 7}>
          {[7, 14, 30].map((days) => <option key={days} value={days}>{days} days</option>)}
        </select></label>
        <label>Count an existing habit<select name="habit" defaultValue={editor.habitId ?? ''}>
          <option value="">Track the action in Programs</option>
          {data.habits.filter((habit) => !habit.archivedAt || habit.id === editor.habitId).map((habit) =>
            <option key={habit.id} value={habit.id}>{habit.title}</option>)}
        </select></label>
        <div className="connection-actions"><button className="primary-button" disabled={busy}>Save program</button>
          <button type="button" className="secondary-button" onClick={() => setEditor(undefined)}>Cancel</button></div>
      </form>}
    </section>
    {(data.programs ?? []).map((program) => {
      const days = new Set(program.days);
      const linked = data.habits.find((habit) => habit.id === program.habitId);
      const todayHit = linked && data.logs.some((log) => log.date === today && log.habitId === linked.id && log.status === 'done' &&
        (log.achievement === 'target' || log.achievement === 'stretch'));
      const finished = days.size >= program.duration;
      const entry = program.entries?.find(({ date }) => date === today);
      const canCount = program.status === 'active' && !finished && !days.has(today) && (!linked || todayHit);
      const guide = guideFor(program);
      const step = exerciseFor(program, today);
      const setStatus = (status: Program['status']) => void update((items) => items.map((item) => item.id === program.id ? { ...item, status } : item), 'Program updated.');
      const pinned = data.pinnedProgramId === program.id;
      return <section className="panel settings-panel" key={program.id} id={`program-${program.id}`} tabIndex={-1}>
        <h3>{program.title}</h3>
        {(pinned || (!finished && program.status === 'active')) && <button className="text-button" disabled={busy} onClick={() => {
          void commit((current) => ({ ...current, pinnedProgramId: current.pinnedProgramId === program.id ? undefined : program.id }),
            pinned ? 'Program unpinned.' : 'Program pinned to Today.');
        }}>{pinned ? 'Unpin from Today' : 'Pin to Today'}</button>}
        {(!guide || program.action !== programGuides[guide].original) && <p>{program.action}</p>}
        {step && <div className="connection-row">
          <label>Practice difficulty<select disabled={busy} value={program.level ?? ''} onChange={(event) => {
            const level = event.target.value ? Number(event.target.value) : undefined;
            void update((items) => items.map((item) => item.id === program.id ? { ...item, level } : item), 'Practice difficulty updated.');
          }}>
            <option value="">Automatic starter progression</option>
            {programLevels.map((name, index) => <option key={name} value={index + 1}>{index + 1} · {name}</option>)}
          </select></label>
          <h4>{programLevels[step.number - 1]}</h4><p>{step.action}</p>
          {step.easier && <p className="muted">Easier option: {step.easier}</p>}
        </div>}
        <ProgramTips title={program.title} action={step ? step.action : program.action} />
        <progress aria-label={`${program.title} progress`} max={program.duration} value={Math.min(days.size, program.duration)} />
        <p>{Math.min(days.size, program.duration)} of {program.duration} practice days · {finished ? 'Complete' : program.status}</p>
        {!finished && days.size >= Math.ceil(program.duration / 2) && <p>Halfway milestone reached.</p>}
        {linked && <p className="muted">Linked to {linked.title}. Reach its target to count today.</p>}
        {(program.status === 'active' || days.has(today) || entry) && <form className="form-stack" key={`${program.id}:${today}`} onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const action = String(fields.get('action') ?? '').trim();
          const reflection = String(fields.get('reflection') ?? '').trim();
          const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          const count = submitter?.value === 'count';
          void update((items, current) => items.map((item) => {
            if (item.id !== program.id) return item;
            const hit = !item.habitId || current.logs.some((log) => log.date === today && log.habitId === item.habitId && log.status === 'done' &&
              (log.achievement === 'target' || log.achievement === 'stretch'));
            const add = count && hit && item.status === 'active' && !item.days.includes(today) && item.days.length < item.duration;
            const entries = (item.entries ?? []).filter(({ date }) => date !== today);
            if (action || reflection) entries.push({ date: today, action, reflection });
            const repeatDays = add && fields.has('repeat') ? [...(item.repeatDays ?? []), today] : item.repeatDays;
            return { ...item, entries, repeatDays, days: add ? [...item.days, today] : item.days };
          }), count ? 'Practice saved.' : 'Reflection saved.');
        }}>
          <label>What did you do?<textarea name="action" rows={2} maxLength={500} defaultValue={entry?.action} placeholder="For example, I asked a question in a meeting." /></label>
          <label>What did you learn?<textarea name="reflection" rows={3} maxLength={2000} defaultValue={entry?.reflection} /></label>
          {guide && canCount && program.level === undefined && <label className="check-label"><input name="repeat" type="checkbox" /> Count today and keep practicing this step</label>}
          <div className="connection-actions">
            {canCount && <button className="primary-button" value="count" disabled={busy}>Count today</button>}
            <button className="secondary-button" value="notes" disabled={busy}>Save notes</button>
          </div>
        </form>}
        {(program.entries?.length ?? 0) > 0 && <details className="audit"><summary>Practice journal</summary>
          <ul>{[...(program.entries ?? [])].sort((a, b) => b.date.localeCompare(a.date)).map((item) => <li key={item.date}>
            <time dateTime={item.date}>{item.date}</time>{item.action && <p>{item.action}</p>}{item.reflection && <p>{item.reflection}</p>}
          </li>)}</ul>
        </details>}
        <div className="connection-actions">
          {!finished && program.status === 'active' && <button className="secondary-button" disabled={busy} onClick={() => setStatus('paused')}>Pause</button>}
          {!finished && program.status === 'paused' && <button className="secondary-button" disabled={busy} onClick={() => setStatus('active')}>Resume</button>}
          {program.status !== 'stopped' && <button className="secondary-button" disabled={busy} onClick={() => setEditor(program)}>Edit</button>}
          {!finished && program.status !== 'stopped' && <button className="text-button" disabled={busy} onClick={() => setStatus('stopped')}>Stop program</button>}
          <button className="text-button danger-text" disabled={busy} onClick={() => setRemoving(program.id)}>Remove program</button>
        </div>
      </section>;
    })}
  </div>;
}
