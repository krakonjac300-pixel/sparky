import { useState } from 'react';
import { Flag, RotateCcw } from 'lucide-react';
import { availableHabits, calendarDate, logKey, type AppData, type Habit, type Priority } from './model.ts';
import { prioritiesFor, reaches, recoveryFor, weekDates } from './planning.ts';

export function PrioritiesForm({ data, today, save, busy }: {
  data: AppData; today: string; save: (items: Priority[]) => void; busy: boolean;
}) {
  const habits = availableHabits(data, today).sort((a, b) => a.sortOrder - b.sortOrder);
  const [items, setItems] = useState(() => prioritiesFor(data, today).filter(({ habitId }) => habits.some(({ id }) => id === habitId)));
  const change = (habitId: string, fields: Partial<Priority>) =>
    setItems((current) => current.map((item) => item.habitId === habitId ? { ...item, ...fields } : item));
  return <form className="form-stack" onSubmit={(event) => {
    event.preventDefault();
    save(items.map((item) => ({ ...item, cue: item.cue.trim() })));
  }}>
    <p className="muted">Choose up to three habits for today. {items.length}/3 selected.</p>
    {habits.map((habit) => {
      const item = items.find(({ habitId }) => habitId === habit.id);
      return <div className="plan-choice" key={habit.id}>
        <label className="check-label"><input type="checkbox" checked={!!item} disabled={!item && items.length >= 3}
          onChange={() => setItems((current) => item ? current.filter(({ habitId }) => habitId !== habit.id)
            : [...current, { habitId: habit.id, cue: '', minimum: false }])} /> {habit.title}</label>
        {item && <>
          <label>Cue for {habit.title}<input maxLength={140} value={item.cue} placeholder="e.g. after coffee"
            onChange={(event) => change(habit.id, { cue: event.target.value })} /></label>
          {habit.thresholds && <label className="check-label">
            <input type="checkbox" checked={item.minimum} onChange={(event) => change(habit.id, { minimum: event.target.checked })} />
            Use the minimum today ({habit.thresholds.minimum} {habit.unit})
          </label>}
        </>}
      </div>;
    })}
    <button className="primary-button" disabled={busy}>Save priorities</button>
  </form>;
}

export function SessionsForm({ data, habit, today, save, busy }: {
  data: AppData; habit: Habit; today: string; save: (dates: string[]) => void; busy: boolean;
}) {
  const dates = weekDates(today).filter((date) => date >= today);
  const [selected, setSelected] = useState(() => dates.filter((date) => (data.weeklySessions ?? []).some(
    (entry) => entry.date === date && entry.habitId === habit.id)));
  const labels = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric' });
  return <form className="form-stack" onSubmit={(event) => { event.preventDefault(); save(selected); }}>
    <p className="muted">Choose days to commit to this week. You can still log sessions on other days.</p>
    {dates.map((date) => <label className="check-label" key={date}>
      <input type="checkbox" checked={selected.includes(date)} onChange={() => setSelected((current) => current.includes(date)
        ? current.filter((day) => day !== date) : [...current, date])} /> {labels.format(calendarDate(date))}
    </label>)}
    <button className="primary-button" disabled={busy}>Save sessions</button>
  </form>;
}

export function TodayPlanning({ data, today, busy, edit, log, consequence, configure }: {
  data: AppData; today: string; busy: boolean; edit: () => void;
  log: (habit: Habit) => void;
  consequence: (habit: Habit, date: string) => void; configure: (habit: Habit) => void;
}) {
  const habits = availableHabits(data, today);
  const pinned = prioritiesFor(data, today);
  const restarts = habits.flatMap((habit) => {
    const recovery = recoveryFor(data, habit, today);
    return recovery ? [{ habit, recovery }] : [];
  });
  const todayLogs = new Map(data.logs.filter((entry) => entry.date === today).map((entry) => [entry.id, entry]));
  return <div className="today-planning" id="today-plan" tabIndex={-1}>
    <section className="panel settings-panel">
      <div className="section-heading"><h2><Flag size={16} /> Today’s priorities</h2><button className="text-button" onClick={edit}>Choose priorities</button></div>
      {pinned.length ? <ul className="plan-list">{pinned.map((item) => {
        const habit = habits.find(({ id }) => id === item.habitId);
        if (!habit) return null;
        const entry = todayLogs.get(logKey(habit.id, today));
        const done = reaches(habit, entry, item.minimum) || entry?.status === 'restart' || entry?.restart;
        return <li key={habit.id}><div><strong>{habit.title}</strong>
          {item.cue && <p className="muted">{item.cue}</p>}
          {item.minimum && habit.thresholds && <p className="muted">Today’s minimum · {habit.thresholds.minimum} {habit.unit}</p>}
        </div><button className="text-button" onClick={() => log(habit)}>{done ? 'View log' : 'Log'}</button></li>;
      })}</ul> : <p className="muted">Pick up to three habits to focus on today.</p>}
    </section>
    {restarts.length > 0 && <section className="panel settings-panel">
      <div className="section-heading"><h2><RotateCcw size={17} /> Start again</h2></div>
      <ul className="restart-list">{restarts.map(({ habit, recovery }) => <li key={habit.id}>
        <strong>{habit.title}</strong>
        <p className="muted">{recovery.missed === 1 ? 'One session missed.' : `${recovery.missed} sessions missed in a row.`}</p>
        <p>{recovery.nextSession ? 'Next session' : 'Easier step'} · {recovery.label}</p>
        {recovery.third && habit.consequence && <div className="consequence">
          <p>Your chosen consequence · {habit.consequence}</p>
          <button className="secondary-button" disabled={busy || recovery.consequenceDone}
            onClick={() => consequence(habit, recovery.third!)}>{recovery.consequenceDone ? 'Consequence recorded' : 'I did the consequence'}</button>
        </div>}
        {recovery.third && !habit.consequence && <button className="secondary-button" onClick={() => configure(habit)}>Choose a consequence</button>}
        {!recovery.nextSession && <button className="text-button" onClick={() => log(habit)}>Log a restart</button>}
      </li>)}</ul>
    </section>}
  </div>;
}
