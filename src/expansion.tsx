import { useState, type CSSProperties, type FormEvent } from 'react';
import { Activity, ArrowUpRight, CalendarDays, CirclePlus, Flag, Moon } from 'lucide-react';
import { AppLimits } from './app-limit-views.tsx';
import { Dialog } from './forms.tsx';
import { calendarDate, newId, type AppData, type Goal, type Moment } from './model.ts';
import { makeReport, minutesLabel, periods, periodDates, type Period } from './reports.ts';
import { PeriodNavigation } from './period-navigation.tsx';
import { AiSummary } from './ai-views.tsx';
import { Segments } from './swipe.tsx';
import { SparkyEmpty } from './sparky-empty.tsx';
import { Programs } from './programs.tsx';
import { ProgressCard } from './progress-card.tsx';

export type Commit = (change: (data: AppData) => AppData, message: string) => Promise<boolean>;
const dateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });
export const displayDate = (key: string) => dateFormatter.format(calendarDate(key));

/** Habits at target per day (or per week for long periods), as simple bars. */
function ReportBars({ daily }: { daily: { date: string; planned: number; hit: number }[] }) {
  const size = daily.length > 35 ? 7 : 1;
  const bars = Array.from({ length: Math.ceil(daily.length / size) }, (_, index) => daily.slice(index * size, index * size + size))
    .map((group) => ({ date: group[0].date, planned: group.reduce((sum, day) => sum + day.planned, 0), hit: group.reduce((sum, day) => sum + day.hit, 0) }));
  if (!bars.some((bar) => bar.planned)) return null;
  return <div className="report-bars" role="img" aria-label={`Habits at target per ${size === 1 ? 'day' : 'week'}`}>
    {bars.map((bar) => <span key={bar.date} title={`${displayDate(bar.date)}: ${bar.hit} of ${bar.planned}`}
      style={{ '--fill': bar.planned ? bar.hit / bar.planned : 0 } as CSSProperties} className={bar.planned ? '' : 'none'} />)}
  </div>;
}

export function Reports({ data, today, date, select, period, setPeriod, openDay, commit }: {
  data: AppData; today: string; date: string; select: (date: string) => void; period: Period;
  setPeriod: (period: Period) => void; openDay: (date: string) => void; commit: Commit;
}) {
  const dates = periodDates(date, period).filter((day) => day <= today);
  const days = dates.length;
  const end = dates[days - 1];
  const previousDates = periodDates(date, period, -1);
  const report = makeReport(data, end, days, today);
  const previous = makeReport(data, previousDates[previousDates.length - 1], previousDates.length, today);
  const delta = report.rate === undefined || previous.rate === undefined ? undefined : report.rate - previous.rate;
  return <div className="expanded-stack">
    <div className="periods" role="group" aria-label="Report period">{periods.map((label) =>
      <button key={label} className="secondary-button" aria-pressed={period === label} onClick={() => setPeriod(label)}>{label}</button>)}</div>
    <PeriodNavigation date={date} today={today} period={period} select={select} />
    <section className="panel settings-panel">
      <h2>{displayDate(report.from)} to {displayDate(end)}</h2>
      <ProgressCard data={data} end={end} today={today} reportPeriod={period} />
      <ReportBars daily={report.daily} />
      <div className="report-metrics">
        <div><strong>{report.rate === undefined ? 'None' : `${report.rate}%`}</strong><span>At target</span></div>
        <div><strong>{report.actions}</strong><span>Actions logged</span></div>
        <div><strong>{report.streak}</strong><span>{end === today ? 'Current streak' : 'Streak at period end'}</span></div>
      </div>
      <p className="muted">{report.planned ? `${report.hit} of ${report.planned} scheduled habits reached target.` : 'No scheduled habits recorded in this period.'}</p>
      {report.planned > 0 && <p>{report.minimum} of {report.planned} reached at least minimum · Longest full completion streak {report.longest} {report.longest === 1 ? 'day' : 'days'}</p>}
      {report.minutes > 0 && <p>{minutesLabel(report.minutes)} logged on timed habits</p>}
      {report.focus.length > 0 && <p>{report.focus.length} focus {report.focus.length === 1 ? 'session' : 'sessions'} · {Math.floor(report.focusMinutes * 60)} seconds focused ({report.focusMinutes.toFixed(1)} min)</p>}
      {delta !== undefined && <p className="muted">{delta === 0 ? 'The target rate matched the previous period.' :
        `The target rate was ${Math.abs(delta)} points ${delta > 0 ? 'higher' : 'lower'} than the previous period.`}</p>}
      {report.daily.some((day) => !day.covered) && <p className="muted">Schedule history starts {displayDate(data.planStart)}. Older logs count toward recorded actions.</p>}
    </section>
    <AiSummary key={`${period}-${end}`} data={data} today={end} currentDate={today} previousDays={previousDates.length} commit={commit} days={days} label={period} />
    <section className="panel settings-panel">
      <h2>Daily consistency</h2>
      <div className="heatmap" aria-label="Daily target progress">{report.daily.map((day) => {
        const level = !day.covered ? 'unknown' : day.planned ? (day.hit === day.planned ? 'full' : day.hit ? 'partial' : 'empty') : day.rest ? 'rest' : 'unknown';
        const label = `${displayDate(day.date)}, ${day.covered ? `${day.hit} of ${day.planned} at target, ${day.rest} planned rest` : 'no schedule history'}`;
        return <button type="button" key={day.date} onClick={() => openDay(day.date)} className={level} aria-label={label} title={label} />;
      })}</div>
      <p className="muted heat-legend">Bright green marks full completion. Blue marks a rest day.</p>
      {report.areas.length > 0 && <ul className="report-areas">{report.areas.map((area) => <li key={area.name}>
        <div><span>{area.name}</span><span>{area.hit} / {area.planned}</span></div>
        <progress aria-label={area.name} max={area.planned} value={area.hit} />
      </li>)}</ul>}
      {report.habits.length > 0 && <details className="audit"><summary>By habit</summary>
        <ul className="report-areas">{report.habits.map((habit, index) => <li key={index}>
          <div><span>{habit.title}</span><span>{habit.hit} / {habit.planned}</span></div>
          <progress aria-label={habit.title} max={habit.planned} value={habit.hit} />
        </li>)}</ul>
      </details>}
    </section>
    <section className="panel settings-panel">
      <h2>Mood, energy and sleep</h2>
      {report.checkIns.length > 0 ? <>
        <p>Mood {report.mood?.toFixed(1)}/5 · Energy {report.energy?.toFixed(1)}/5 <span className="muted">over {report.checkIns.length} check-ins</span></p>
        <ul className="checkin-trend">{[...report.checkIns].sort((a, b) => a.date.localeCompare(b.date)).slice(-7).map((entry) =>
          <li key={entry.date}><time dateTime={entry.date}>{displayDate(entry.date)}</time>
            <span aria-label={`Mood ${entry.mood} out of 5`}>Mood {entry.mood}/5</span><span aria-label={`Energy ${entry.energy} out of 5`}>Energy {entry.energy}/5</span></li>)}</ul>
      </> : <p className="muted">No check-ins this period.</p>}
      <p className="sleep-stat"><Moon size={16} /> {report.sleepAverage
        ? `${minutesLabel(report.sleepAverage)} average across ${report.sleep.length} recorded nights` : 'No imported sleep sessions this period.'}</p>
    </section>
    {(report.steps.length > 0 || report.exercise.length > 0 || report.distance.length > 0) && <section className="panel settings-panel">
      <h2>Recorded activity</h2>
      {report.averageSteps !== undefined && <p>{Math.round(report.averageSteps).toLocaleString()} average steps across {report.steps.length} recorded days</p>}
      {report.exercise.length > 0 && <p>{minutesLabel(report.exerciseMinutes)} of exercise across {report.exercise.length} recorded days</p>}
      {report.distance.length > 0 && <p>{report.distanceKm.toFixed(1)} km across {report.distance.length} recorded days</p>}
    </section>}
    {(period === 'Quarter' || period === '6 months' || period === 'Year') && <section className="panel settings-panel">
      <h2>Review</h2>
      <p>You recorded {report.actions} habit actions, {report.checkIns.length} check-ins, and {data.moments.filter((entry) => entry.date >= report.from && entry.date <= end).length} timeline entries in this period.</p>
      {report.areas.length > 0 && <p className="muted">Use the life area and check-in records above to review what changed.</p>}
    </section>}
  </div>;
}

// Goals and the life timeline share one section (Nov 2026): outcomes you measure, then the moments along the way.
export const lifeSections = ['Goals', 'Coach', 'Programs', 'Focus'] as const;
export type LifeSection = typeof lifeSections[number];

export function Life({ data, today, commit, lastUsageSync, section, setSection }: {
  data: AppData; today: string; commit: Commit; lastUsageSync?: number; section: LifeSection; setSection: (section: LifeSection) => void;
}) {
  const [editor, setEditor] = useState<{ kind: 'goal'; goal?: Goal } | { kind: 'measurement'; goal: Goal } | { kind: 'moment'; moment?: Moment }>();
  const [pending, setPending] = useState(false);
  const close = () => { if (!pending) setEditor(undefined); };
  const moments = [...data.moments].sort((a, b) => b.date.localeCompare(a.date));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || pending) return;
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => String(fields.get(name) ?? '').trim();
    if (editor.kind !== 'measurement' && !value('title')) return;
    setPending(true);
    const saved = await commit((current) => {
      if (editor.kind === 'moment') {
        const moment: Moment = { id: editor.moment?.id ?? newId(), date: value('date'), title: value('title'),
          note: value('note'), kind: value('kind') as Moment['kind'] };
        return { ...current, moments: [...current.moments.filter((entry) => entry.id !== moment.id), moment] };
      }
      if (editor.kind === 'measurement') return { ...current, goals: current.goals.map((goal) => goal.id === editor.goal.id ? {
        ...goal, measurements: [...goal.measurements, { id: newId(), date: value('date'), value: Number(fields.get('value')), note: value('note') }],
      } : goal) };
      const id = editor.goal?.id ?? newId();
      const goal: Goal = { id, title: value('title'), unit: value('unit'), target: Number(fields.get('value')),
        due: value('date') || undefined, measurements: current.goals.find((entry) => entry.id === id)?.measurements ?? [] };
      return { ...current, goals: [...current.goals.filter((entry) => entry.id !== id), goal] };
    }, 'Saved.');
    setPending(false);
    if (saved) setEditor(undefined);
  }

  return <>
    <div className="page-heading"><h1>Life</h1></div>
    <Segments label="Life view" options={lifeSections} value={section} onChange={setSection} />
    {section === 'Programs' && <Programs data={data} today={today} commit={commit} />}
    {section === 'Goals' ? <div className="expanded-stack">
      <div className="section-heading"><h2>Outcome goals</h2><button className="primary-button" onClick={() => setEditor({ kind: 'goal' })}><CirclePlus size={17} /> Add goal</button></div>
      {!data.goals.length && <SparkyEmpty line="No goals yet. Pick one thing you can measure, like kilometres run or books read, and I'll track it with you." />}
      {data.goals.map((goal) => {
        const history = [...goal.measurements].reverse().sort((a, b) => b.date.localeCompare(a.date));
        return <section className="panel settings-panel" key={goal.id}>
          <div className="section-heading"><h2><Flag size={17} /> {goal.title}</h2><button className="text-button" onClick={() => setEditor({ kind: 'goal', goal })}>Edit goal</button></div>
          <p>Target {goal.target} {goal.unit}{goal.due ? ` · by ${displayDate(goal.due)}` : ''}</p>
          {history.length > 0 && <ul className="checkin-trend">{history.map((entry) =>
            <li key={entry.id}><time>{displayDate(entry.date)}</time><span>{entry.value} {goal.unit}</span><span>{entry.note}</span></li>)}</ul>}
          <button className="text-button" onClick={() => setEditor({ kind: 'measurement', goal })}><Activity size={17} /> Record measurement</button>
        </section>;
      })}
      <div className="section-heading"><h2>Timeline</h2><button className="primary-button" onClick={() => setEditor({ kind: 'moment' })}><CirclePlus size={17} /> Add entry</button></div>
      {!moments.length && <SparkyEmpty line="Your timeline is empty. Save a milestone, a lesson or a good memory so we can look back on it." />}
      {moments.map((moment) => <article key={moment.id} className="panel settings-panel timeline-entry">
        <p className="muted"><CalendarDays size={15} /> {displayDate(moment.date)} · {moment.kind}</p>
        <div className="section-heading"><h2>{moment.title}</h2><button className="text-button" onClick={() => setEditor({ kind: 'moment', moment })}>Edit <ArrowUpRight size={16} /></button></div>
        {moment.note && <p className="entry-note">{moment.note}</p>}
      </article>)}
      <AppLimits data={data} today={today} commit={commit} lastSync={lastUsageSync} />
    </div> : null}
    {editor && <Dialog title={editor.kind === 'measurement' ? 'Record measurement' : editor.kind === 'moment' ? 'Timeline entry' : 'Outcome goal'} close={close}>
      <form className="form-stack" onSubmit={(event) => void save(event)}>
        {editor.kind !== 'measurement' && <label>Title<input required name="title" maxLength={100} defaultValue={editor.kind === 'goal' ? editor.goal?.title : editor.moment?.title} /></label>}
        {editor.kind === 'goal' && <label>Unit<input name="unit" maxLength={24} defaultValue={editor.goal?.unit} placeholder="e.g. km" /></label>}
        {editor.kind !== 'moment' && <label>{editor.kind === 'goal' ? 'Target value' : 'Measured value'}
          <input required name="value" type="number" step="any" defaultValue={editor.kind === 'goal' ? editor.goal?.target : undefined} /></label>}
        <label>{editor.kind === 'goal' ? 'Target date (optional)' : 'Date'}
          <input name="date" type="date" required={editor.kind !== 'goal'} max={editor.kind === 'goal' ? undefined : today}
            defaultValue={editor.kind === 'goal' ? editor.goal?.due : editor.kind === 'moment' ? editor.moment?.date ?? today : today} /></label>
        {editor.kind === 'moment' && <label>Kind<select name="kind" defaultValue={editor.moment?.kind}>
          {['Milestone', 'Experience', 'Lesson', 'Memory'].map((label) => <option key={label}>{label}</option>)}</select></label>}
        {editor.kind !== 'goal' && <label>Note<textarea name="note" rows={3} maxLength={editor.kind === 'moment' ? 2000 : 1000} defaultValue={editor.kind === 'moment' ? editor.moment?.note : undefined} /></label>}
        <button className="primary-button" disabled={pending}>Save</button>
      </form>
    </Dialog>}
  </>;
}
