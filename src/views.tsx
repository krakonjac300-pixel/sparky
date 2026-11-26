import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Activity, ArrowUpRight, BookOpen, BriefcaseBusiness, Check, ChevronRight, CloudOff,
  X, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Compass, Download, Heart, Leaf, Moon, Pencil, Plus, RotateCcw, Sun, Upload, UsersRound, Zap,
} from 'lucide-react';
import {
  scoringPaused, setScoringPaused, achievement, availableHabits, calendarDate, timerBaseSeconds, dailyProgress, dueHabits, sessionKeys,
  historicalHabit, writeLog, type AppData, type Category, type CheckIn, type Habit, type HabitLog, type Theme,
} from './model.ts';
import { Dialog, LogForm } from './forms.tsx';
import { LegalDocuments } from './legal.tsx';
import { exerciseFor } from './program-exercise.ts';
import { onAndroid } from './android.ts';
import { Reports, type Commit } from './expansion.tsx';
import { PeriodNavigation } from './period-navigation.tsx';
import { minutesLabel, periodDates, type Period } from './reports.ts';
import { TodayPlanning } from './planning-views.tsx';
import { prioritiesFor, recoveryFor, weekDates, weeklyProgress, type Recovery } from './planning.ts';
import { HabitTimer } from './habit-timer.tsx';
import { PhoneActivity } from './phone-activity.tsx';
import { type PhoneSync } from './phone-sync.ts';
import { BudgetCoach } from './budget-coach-view.tsx';
import { turtleHabitProgress } from './budget-coach.ts';
import { ChatModelSetting } from './ai-views.tsx';
import { FeedbackSettings } from './feedback-views.tsx';
import { SmallWins } from './small-wins-view.tsx';
import { smallWinsAsHabit } from './small-wins.ts';
import { SparkyEmpty } from './sparky-empty.tsx';
import { Segments } from './swipe.tsx';

const areaIcons = { activity: Activity, book: BookOpen, heart: Heart, leaf: Leaf, users: UsersRound, briefcase: BriefcaseBusiness, compass: Compass };
const dateFormat = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('en', { weekday: 'short' });
const moodOptions = ['Very low', 'Low', 'Okay', 'Good', 'Great'];
const moodFaces = ['😞', '😕', '😐', '🙂', '😄'];
const energyIcons = [BatteryWarning, BatteryLow, BatteryMedium, BatteryFull, Zap];
const energyOptions = ['Drained', 'Low', 'Steady', 'High', 'Energized'];
const slipText = { little: 'Slipped a little · counts as minimum', normal: 'Slipped', lot: 'Slipped a lot' };
const statusText = { logged: 'Progress logged', minimum: 'Minimum reached', target: 'Target reached', stretch: 'Stretch reached' };

function AreaIcon({ category }: { category: Category }) {
  const Icon = areaIcons[category.icon];
  return <span className="area-icon" style={{ '--area': category.color } as CSSProperties}><Icon size={19} aria-hidden="true" /></span>;
}

function HabitRow({ habit, log, recovery, busy, onLog, onToggle, weekly, area, cue }: {
  habit: Habit; log?: HabitLog; recovery?: Recovery; busy: boolean; onLog: () => void; onToggle: () => void;
  weekly?: ReactNode; area?: Category; cue?: string;
}) {
  const titleId = useId();
  const detailId = useId();
  const value = log?.status === 'done' ? log.value : 0;
  const level = log?.unit === habit.unit && (!log.trackingType || log.trackingType === habit.trackingType) ? achievement(habit, value) : undefined;
  const avoid = habit.trackingType === 'avoid';
  const status = log?.status === 'rest' ? 'Planned rest' : log?.status === 'skipped' ? 'Skipped' :
    log?.status === 'slipped' ? `${slipText[log.slip ?? 'normal']}${log.value && habit.slipCount ? ` · ${log.value} ${habit.slipCount.unit}` : ''}` : log?.status === 'restart' || log?.restart ? 'Restart logged' :
      level && (avoid ? 'Avoided' : statusText[level]);
  const complete = level === 'target' || level === 'stretch';
  const numeric = !!habit.thresholds;
  const offerRestart = !numeric && recovery && !recovery.nextSession;
  const closed = avoid && log?.status === 'slipped' && log.slip !== 'little';
  const directCompletion = !numeric && !offerRestart && !closed;
  const share = numeric && log?.status === 'done' && habit.thresholds ? Math.min(1, value / habit.thresholds.target) : complete ? 1 : 0;
  return <li className={`habit-row${complete ? ' habit-complete' : ''}${closed ? ' habit-closed' : ''}${weekly ? ' weekly-row' : ''}`}>
    {directCompletion && <button className="habit-toggle" type="button" disabled={busy}
      aria-label={avoid ? `${complete ? 'Undo avoided' : 'Avoided'} ${habit.title}` : `${complete ? 'Undo' : 'Complete'} ${habit.title}`} onClick={onToggle}>
      <span className="habit-circle" aria-hidden="true">{complete ? <Check size={13} /> : log?.status === 'rest' && <Moon size={13} />}</span>
    </button>}
    <button className="habit-entry" type="button" onClick={onLog} disabled={busy} aria-labelledby={titleId} aria-describedby={detailId}>
      {!directCompletion && <span className={`habit-symbol${complete ? ' complete' : ''}`} aria-hidden="true">
        <svg className="habit-ring" viewBox="0 0 32 32"><circle className="habit-ring-track" cx="16" cy="16" r="13" />
          {share > 0 && <circle className="habit-ring-fill" cx="16" cy="16" r="13" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - share} transform="rotate(-90 16 16)" />}</svg>
        <span className="habit-ring-icon">{closed ? <X size={15} strokeWidth={3} /> : complete ? <Check size={15} strokeWidth={3} /> : log?.status === 'rest' ? <Moon size={14} /> :
          avoid ? <Leaf size={15} /> : offerRestart ? <RotateCcw size={14} /> : <Plus size={16} />}</span>
      </span>}
      <span className="habit-details">
        <span id={titleId} className="habit-name">{area && <span className="area-dot" style={{ background: area.color }} title={area.name} aria-hidden="true" />}{habit.title}</span>
        <span id={detailId} className="habit-meta">
          {avoid && <span>Break List</span>}
          {habit.replacement && <span>{habit.replacement.action}</span>}
          {cue && !complete && <span>After {cue}</span>}
          {habit.thresholds && <span>{value} / {habit.thresholds.target} {habit.unit}</span>}
          {status ? <span className={level && level !== 'logged' ? 'achievement' : ''}>{status}</span> : avoid && <span>Awaiting check-in</span>}
          {recovery && <span className="habit-recovery">{recovery.nextSession ? 'Next session' : 'Easier step'} · {recovery.label}</span>}
        </span>
      </span>
      <ChevronRight className="habit-chevron" size={16} aria-hidden="true" />
    </button>
    {weekly && <div className="weekly-detail">{weekly}</div>}
  </li>;
}

function CheckInPanel({ date, entry, busy, save }: { date: string; entry?: CheckIn; busy: boolean; save: (entry: CheckIn) => void }) {
  const [mood, setMood] = useState(entry?.mood);
  const [energy, setEnergy] = useState(entry?.energy);
  const [note, setNote] = useState(entry?.note ?? '');
  const changed = mood !== entry?.mood || energy !== entry?.energy || note.trim() !== (entry?.note ?? '');
  /** Picking the second rating saves right away; the note can follow with its own button. */
  const quickSave = (nextMood?: number, nextEnergy?: number) => {
    if (!busy && nextMood && nextEnergy && (nextMood !== entry?.mood || nextEnergy !== entry?.energy)) {
      save({ date, mood: nextMood, energy: nextEnergy, note: note.trim() || entry?.note, timestamp: new Date().toISOString() });
    }
  };
  return <section className="panel checkin-panel" id="checkin" tabIndex={-1} aria-labelledby="checkin-title">
    <div className="small-panel-heading"><span className="small-icon"><Heart size={19} /></span>
      <h2 id="checkin-title">Daily check-in</h2>
    </div>
    <form className="form-stack" onSubmit={(event) => {
      event.preventDefault();
      if (mood && energy) save({ date, mood, energy, note: note.trim() || undefined, timestamp: new Date().toISOString() });
    }}>
      {([{ label: 'Mood', value: mood, select: (value: number) => { setMood(value); quickSave(value, energy); }, options: moodOptions },
        { label: 'Energy', value: energy, select: (value: number) => { setEnergy(value); quickSave(mood, value); }, options: energyOptions }]).map((rating) =>
        <fieldset key={rating.label} className="rating">
          <legend>{rating.label}</legend>
          <div className="rating-options">{rating.options.map((option, index) => <button type="button" key={option}
            aria-label={`${rating.label}: ${option} (${index + 1} of 5)`} title={option} aria-pressed={rating.value === index + 1}
            onClick={() => rating.select(index + 1)}>{rating.label === 'Mood' ? <span className="rating-face">{moodFaces[index]}</span>
              : (() => { const Icon = energyIcons[index]; return <Icon size={22} />; })()}</button>)}</div>
          <div className="rating-caption"><span>{rating.options[0]}</span><span>{rating.value ? rating.options[rating.value - 1] : rating.options[4]}</span></div>
        </fieldset>)}
      <label>Reflection <span className="muted">(optional)</span><textarea placeholder="Anything worth remembering?" rows={3} maxLength={1000}
        value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {/* Picking mood and energy already checks in; the reflection is optional and gets its own save button. */}
      {entry && !changed && <p className="checkin-status" role="status"><Check size={17} /> Checked in. A reflection is optional.</p>}
      {!entry && (!mood || !energy) && <p className="muted">Pick your mood and energy to check in.</p>}
      {changed && (mood && energy) && <button className="secondary-button" disabled={busy}>
        {entry && mood === entry.mood && energy === entry.energy ? 'Save reflection' : 'Save check-in'}
      </button>}
    </form>
  </section>;
}

const todayViews = ['Habits', 'Small wins', 'Check-in'] as const;
export type TodayView = typeof todayViews[number];

export function Today({ data, date, busy, add, addBreak, log, toggle, timeHabit, checkIn, openSettings, priorities, sessions, consequence, configure,
  commit, openGoals, reviewing, sync, openActivity, openProgram, openFocus, view, setView }: {
  view: TodayView; setView: (view: TodayView) => void;
  data: AppData; date: string; busy: boolean; add: () => void; addBreak: () => void;
  log: (habit: Habit) => void;
  timeHabit: (habit: Habit, started?: string) => void;
  priorities: () => void; sessions: (habit: Habit) => void; consequence: (habit: Habit, date: string) => void; configure: (habit: Habit) => void;
  toggle: (habit: Habit, entry?: HabitLog) => void; checkIn: (entry: CheckIn) => void; openSettings: () => void;
  commit: Commit; openGoals: () => void; reviewing: boolean; sync: PhoneSync; openActivity: () => void;
  openProgram: (id: string) => void; openFocus: () => void;
}) {
  const habits = availableHabits(data, date).sort((a, b) => a.sortOrder - b.sortOrder);
  const logs = new Map(data.logs.filter((entry) => entry.date === date).map((entry) => [entry.habitId, entry]));
  const bookings = sessionKeys(data);
  const due = dueHabits(habits, date, bookings);
  const flexible = habits.filter((habit) => habit.weeklyTarget && !due.includes(habit));
  const { target, minimum, rest, scheduled } = dailyProgress(due, logs);
  const focus = prioritiesFor(data, date).map((item) => habits.find((habit) => habit.id === item.habitId)).find(Boolean);
  const pinned = data.programs?.find((item) => item.id === data.pinnedProgramId && item.status === 'active' && item.days.length < item.duration);
  return <>
    <div className="page-heading today-heading">
      <div className="today-title-row">
        <div>
          <h1>Today</h1>
          <p className="page-date"><time dateTime={date}>{dateFormat.format(calendarDate(date))}</time></p>
        </div>
      </div>
      <Segments label="Today view" options={todayViews} value={view} onChange={setView} />
    </div>
    {view === 'Small wins' && <div className="view-enter"><SmallWins data={data} today={date} commit={commit} /></div>}
    {view === 'Check-in' && <div className="view-enter"><CheckInPanel key={date} date={date}
      entry={data.checkIns.find((entry) => entry.date === date)} busy={busy} save={checkIn} /></div>}
    {view === 'Habits' && <div className="view-enter">
    {/* Habits sit right under the Sparky card; score, screen time and planning follow them (Nov 2026). */}
    <BudgetCoach data={data} today={date} focus={focus?.title} commit={commit} openGoals={openGoals} reviewing={reviewing} sync={sync} openActivity={openActivity}
      afterCard={<>
    <div className="today-grid">
      <section className="habits-section" aria-labelledby="habits-title">
        <div className="section-heading"><h2 id="habits-title">Today’s habits</h2>
          <div className="habit-heading-actions">
            <button type="button" className="text-button" onClick={addBreak}>Break List</button>
            <button type="button" className="text-button add-habit" onClick={add}><Plus size={18} /> Add habit</button>
          </div>
        </div>
        {habits.length === 0 && <SparkyEmpty line="Nothing is scheduled today. Add one small habit and I'll cheer you on.">
          <button className="text-button" onClick={add}><Plus size={15} /> Add a habit</button>
          <button className="text-button" onClick={openSettings}>Manage your plan <ArrowUpRight size={15} /></button></SparkyEmpty>}
        {([['Due today', due], ['Flexible this week', flexible]] as const).map(([label, items]) =>
          items.length > 0 && <section key={label} className="habit-group">
            <h3>{label}</h3>
            <ul>{items.map((habit) => <HabitRow key={habit.id} habit={habit} log={logs.get(habit.id)}
              area={data.categories.find((category) => category.id === habit.categoryId)}
              cue={data.habits.find((item) => item.id === habit.afterHabitId && !item.archivedAt)?.title}
              recovery={recoveryFor(data, habit, date)} busy={busy}
              weekly={habit.weeklyTarget ? <><span>{weeklyProgress(data, habit, date)} / {habit.weeklyTarget} {habit.trackingType === 'avoid' ? 'days avoided' : 'sessions at target'}</span>
                {(() => { const day = weekDates(date).find((item) => item > date && bookings.has(`${habit.id}:${item}`));
                  return day && <span>Next session {calendarDate(day).toLocaleDateString(undefined, { weekday: 'long' })}</span>; })()}
                <button className="text-button" onClick={() => sessions(habit)}>Plan sessions</button></> : undefined}
              onLog={() => log(habit)} onToggle={() => toggle(habit, logs.get(habit.id))} />)}</ul>
          </section>)}
      </section>
      <div className="today-sidebar">
        <TodayPlanning data={data} today={date} busy={busy} edit={priorities} log={log} consequence={consequence} configure={configure} />
      </div>
    </div>
      </>}>
    </BudgetCoach>
    {data.activeFocus && <button className="secondary-button" onClick={openFocus}>Open saved Focus session</button>}
    <section className={`progress-panel${(data.habitTimers?.length ?? 0) > 0 ? '' : ' progress-quiet'}`} aria-labelledby="progress-title">
      <div className="progress-copy">
        <h2 id="progress-title">{scheduled ? 'Habits at target' : 'No habits due today'}</h2>
        <p className="progress-total"><strong>{target}</strong><span> / {scheduled}</span></p>
      </div>
      {scheduled > 0 && <progress aria-labelledby="progress-title" max={scheduled} value={target} />}
      {(() => {
        const wins = smallWinsAsHabit(data, date);
        return wins.counted && <p className="progress-detail">+ Small wins for Sparky · {wins.reached ? 'done' : `${wins.done} of ${wins.needed}`}</p>;
      })()}
      {(minimum > target || rest > 0) && <p className="progress-detail">{[
        minimum > target ? `${minimum - target} at minimum` : '', rest ? `${rest} planned rest` : '',
      ].filter(Boolean).join(' · ')}</p>}
      {data.habitTimers?.map((timer) => <HabitTimer key={timer.habit.id} title={timer.habit.title} started={timer.started}
        goal={timer.habit.thresholds} alreadySeconds={timerBaseSeconds(data, timer.habit.id, timer.date)}
        busy={busy} onPress={() => timeHabit(timer.habit, timer.started)} />)}
      {(data.habitTimers?.length ?? 0) > 0 && <button type="button" className="text-button open-focus"
        onClick={() => window.dispatchEvent(new Event('one-life-focus'))}>Open focus with Sparky</button>}
    </section>
    {pinned && <section className="panel settings-panel" aria-label="Pinned program exercise">
      <h2>{pinned.title}</h2>
      <p>{exerciseFor(pinned, date)?.action ?? pinned.action}</p>
      {pinned.days.includes(date) && <p className="muted">Practice counted today.</p>}
      <button className="secondary-button" onClick={() => openProgram(pinned.id)}>Open program exercise</button>
    </section>}
    </div>}
  </>;
}

const historyViews = ['Daily', 'Reports', 'Phone activity'] as const;
export type HistoryView = typeof historyViews[number];

export function History({ data, today, sync, commit, openConnections, view, setView }: {
  data: AppData; today: string; sync: PhoneSync; commit: Commit; openConnections: () => void;
  view: HistoryView; setView: (view: HistoryView) => void;
}) {
  const [anchor, setSelected] = useState<string>();
  const selectedDate = anchor ?? today;
  const [reportPeriod, setReportPeriod] = useState<Period>('Week');
  const [editEntry, setEditEntry] = useState<HabitLog>();
  const [entryBusy, setEntryBusy] = useState(false);
  const editPlan = editEntry && historicalHabit(data, editEntry.habitId, editEntry.date);
  const dates = periodDates(selectedDate, 'Week');
  const logs = data.logs.filter((log) => log.date === selectedDate);
  const checkIn = data.checkIns.find((entry) => entry.date === selectedDate);
  const sleep = data.sleep.find((entry) => entry.date === selectedDate);
  const routine = data.routines.find((entry) => entry.date === selectedDate && (entry.plan || entry.reflection));
  const recorded = new Set([...data.logs, ...data.checkIns, ...data.sleep, ...data.routines.filter((entry) => entry.plan || entry.reflection)].map(({ date }) => date));
  return <>
    <div className="page-heading"><h1>History</h1></div>
    <Segments label="History view" options={historyViews} value={view} onChange={setView} />
    {view === 'Reports' ? <Reports date={selectedDate} select={setSelected} period={reportPeriod} setPeriod={setReportPeriod}
        openDay={(date) => { setSelected(date); setView('Daily'); }} data={data} today={today} commit={commit} />
      : view === 'Phone activity' ? <PhoneActivity date={selectedDate} select={setSelected} data={data} today={today} sync={sync} commit={commit} openConnections={openConnections} /> : <>
    <PeriodNavigation date={selectedDate} today={today} period="Week" show="day" select={setSelected} />
    <div className="history-days" aria-label="Choose a day">{dates.map((date) => <button key={date} type="button"
      disabled={date > today} aria-pressed={date === selectedDate} aria-label={`${dateFormat.format(calendarDate(date))}${recorded.has(date) ? ', has entries' : ''}`}
      onClick={() => setSelected(date)}>
      <span>{dayFormat.format(calendarDate(date))}</span>
      {(() => {
        const day = turtleHabitProgress(data, date);
        const share = day.total ? Math.min(1, day.done / day.total) : 0;
        return <span className="day-ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle className="day-ring-track" cx="18" cy="18" r="15" />
          {share > 0 && <circle className="day-ring-fill" cx="18" cy="18" r="15" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - share} transform="rotate(-90 18 18)" />}</svg>
          <strong>{calendarDate(date).getDate()}</strong></span>;
      })()}
      <span aria-hidden="true" className={recorded.has(date) ? 'entry-dot active' : 'entry-dot'} />
    </button>)}</div>
    <section className="panel history-panel">
      <h2>{selectedDate === today ? 'Today' : dateFormat.format(calendarDate(selectedDate))}</h2>
      {logs.length === 0 && !checkIn && !sleep && !routine && <SparkyEmpty line={selectedDate === today
        ? 'Nothing logged yet today. Finish one habit and it shows up here.' : 'Nothing was logged this day. Tomorrow is a fresh start.'} />}
      {logs.length > 0 && <ul>{logs.map((log) => <li className="history-row" key={log.id}>
        <div className="history-row-main"><strong>{log.title}</strong>{log.note && <p className="entry-note">{log.note}</p>}
          {log.imported && <p className="entry-note">Health Connect</p>}
          {log.replacementUsed !== undefined && <p className="entry-note">{log.replacementUsed ? 'Used the replacement' : 'Replacement unused'}</p>}</div>
        <div className="history-row-side"><span className="history-status">{log.status === 'rest' ? 'Planned rest' : log.status === 'skipped' ? 'Skipped' : log.status === 'slipped' ? slipText[log.slip ?? 'normal']
          : log.status === 'restart' || log.restart ? 'Restart logged' : log.trackingType === 'avoid' ? 'Avoided'
          : log.unit ? `${log.value} ${log.unit} · ${statusText[log.achievement ?? 'logged']}` : 'Completed'}</span>
        <button className="text-button" aria-label={`Edit ${log.title} entry`} onClick={() => setEditEntry(log)}>Edit</button></div>
      </li>)}</ul>}
      {checkIn && <div className="history-checkin"><h3>Daily check-in</h3>
        <p>Mood {checkIn.mood}/5 · Energy {checkIn.energy}/5</p>
        {checkIn.note && <p className="muted entry-note">{checkIn.note}</p>}</div>}
      {sleep && <div className="history-checkin"><h3>Sleep</h3><p>{minutesLabel(sleep.minutes)} · Health Connect</p></div>}
      {routine && <div className="history-checkin">
        {routine.plan && <><h3>Morning plan</h3><p className="entry-note">{routine.plan}</p></>}
        {routine.reflection && <><h3>Evening reflection</h3><p className="entry-note">{routine.reflection}</p></>}
      </div>}
    </section>
    {editEntry && editPlan && <Dialog title={`Edit ${editEntry.title} entry`} close={() => { if (!entryBusy) setEditEntry(undefined); }}>
      <LogForm habit={editPlan} log={editEntry} busy={entryBusy} save={(entry) => {
        setEntryBusy(true);
        void commit((current) => writeLog(current, editEntry.habitId, editEntry.date, entry), 'History updated.')
          .then((saved) => { if (saved) setEditEntry(undefined); }).finally(() => setEntryBusy(false));
      }} />
    </Dialog>}
    </>}
  </>;
}

export function Settings({ backupSettings, data, today, commit, busy, theme, editCategory, addCategory, editHabit, restoreHabit, add, exportData, importData, reset, switcher }: {
  data: AppData; today: string; commit: Commit; busy: boolean; theme: (theme: Theme) => void; editCategory: (category: Category) => void; editHabit: (habit: Habit) => void;
  addCategory: () => void; restoreHabit: (habit: Habit) => void; add: () => void; exportData: () => void; importData: (file?: File) => void; reset: () => void; switcher?: ReactNode; backupSettings: ReactNode;
}) {
  return <>
    <div className="page-heading"><h1>Settings</h1>{switcher}</div>
    <div className="settings-grid">
      <section className="panel settings-panel">
        <h2>Appearance</h2>
        <div className="themes">{(['dark', 'light'] as const).map((value) => <button key={value} className="secondary-button" type="button"
          aria-pressed={data.settings.theme === value} disabled={busy} onClick={() => theme(value)}>
          {value === 'dark' ? <Moon size={17} /> : <Sun size={17} />} {value === 'dark' ? 'Dark' : 'Light'}
        </button>)}</div>
      </section>
      <section className="panel settings-panel">
        <h2>Streak</h2>
        <p className="muted">Paused days preserve your streak and freezes. You can still log habits. Resuming counts today again.</p>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => {
          const pause = !scoringPaused(data, today);
          void commit((current) => setScoringPaused(current, today, pause), pause ? 'Streak paused.' : 'Streak resumed.');
        }}>{scoringPaused(data, today) ? 'Resume streak' : 'Pause streak'}</button>
      </section>
      <FeedbackSettings />
      <section className="panel settings-panel"><h2>Legal and privacy</h2><LegalDocuments /></section>
      {import.meta.env.PROD && <a className="text-button" href="/third-party-notices.txt">Third-party licenses</a>}
      {onAndroid() && <ChatModelSetting />}
      <section className="panel settings-panel">
        <h2>Backups</h2>
        {backupSettings}
        <div className="backup-actions">
          <button className="secondary-button" type="button" onClick={exportData} disabled={busy}><Download size={17} /> Export JSON</button>
          {onAndroid() ? <button className="secondary-button" disabled={busy} onClick={() => importData()}><Upload size={17} /> Import JSON</button>
          : <label className="secondary-button file-button"><Upload size={17} /> Import JSON
            <input type="file" accept=".json,application/json" aria-label="Import JSON" disabled={busy} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) importData(file);
            }} />
          </label>}
        </div>
        <button className="text-button danger-text" type="button" onClick={reset} disabled={busy}>Reset all data</button>
      </section>
      <section className="panel settings-panel">
        <div className="section-heading"><h2>Life areas</h2><button type="button" className="text-button" onClick={addCategory}><Plus size={17} /> Add area</button></div>
        <ul className="settings-list">{[...data.categories].sort((a, b) => a.sortOrder - b.sortOrder).map((category) =>
          <li key={category.id}><button type="button" onClick={() => editCategory(category)}>
            <AreaIcon category={category} /><span>{category.parentId ? `${data.categories.find((item) => item.id === category.parentId)?.name} / ` : ''}{category.name}</span><ChevronRight size={17} />
          </button></li>)}</ul>
      </section>
      <section className="panel settings-panel">
        <div className="section-heading"><h2>Manage habits</h2><button className="text-button" type="button" onClick={add}><Plus size={17} /> Add habit</button></div>
        <ul className="settings-list">{data.habits.filter((habit) => !habit.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder).map((habit) =>
          <li key={habit.id}><button type="button" onClick={() => editHabit(habit)}>
            <span>{habit.title}<small>{habit.onceOn ?? (habit.weeklyTarget ? `${habit.weeklyTarget} flexible sessions per week` : habit.days.length === 7 ? 'Every day' : `${habit.days.length} ${habit.days.length === 1 ? 'day' : 'days'} per week`)}</small></span>
            <Pencil size={16} />
          </button></li>)}</ul>
        {!data.habits.some((habit) => !habit.archivedAt) && <p className="muted">Your plan is empty.</p>}
        {data.habits.some((habit) => habit.archivedAt) && <details className="audit"><summary>Archived habits</summary>
          <ul className="settings-list">{data.habits.filter((habit) => habit.archivedAt).map((habit) =>
            <li key={habit.id}><button type="button" disabled={busy} onClick={() => restoreHabit(habit)}><span>{habit.title}</span>Restore</button></li>)}</ul>
        </details>}
      </section>
    </div>
  </>;
}

export function OfflineNotice() {
  return <div className="offline-notice"><CloudOff size={16} /> Offline · changes save on this device</div>;
}
