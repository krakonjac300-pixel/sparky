import { checkAppLimit } from './app-limits.ts';
import { useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { Bell, ChevronRight, Footprints, Settings2 } from 'lucide-react';
import { androidRequest, isAndroidAppPage, onAndroid } from './android.ts';
import { activeBudgets, budgetCoachStatus, dailyTurtleReaction, sparkyBar, sparkyHistory, sparkyResetHour, sparkyTarget, turtleHabitProgress } from './budget-coach.ts';
import { type Commit } from './expansion.tsx';
import { Dialog } from './forms.tsx';
import { localDate, scoringPaused, shiftDate, type AppData } from './model.ts';
import type { PhoneSync } from './phone-sync.ts';
import { TurtleAvatar } from './turtle-avatar.tsx';
import { defaultTurtleReviewHour } from './turtle-review.ts';

import { carryHabit } from './evening-plan.ts';
import { EveningSuggestion } from './evening-suggestion.tsx';

const defaultReset = 'Put the phone down for 10 minutes.';

/** Today's progress as a ring drawn behind Sparky: it fills as habits get done and turns gold once all are. */
function SparkyRing({ done, total }: { done: number; total: number }) {
  const share = total ? Math.min(1, done / total) : 0;
  return <svg className={`sparky-ring${total > 0 && done >= total ? ' complete' : ''}`} viewBox="0 0 120 120" aria-hidden="true">
    <circle className="sparky-ring-track" cx="60" cy="60" r="54" />
    {share > 0 && <circle className="sparky-ring-fill" cx="60" cy="60" r="54" pathLength="1" strokeDasharray="1"
      strokeDashoffset={1 - share} transform="rotate(-90 60 60)" />}
  </svg>;
}

function timeLabel(seconds: number) {
  const whole = Math.floor(seconds / 60);
  if (!whole) return seconds > 0 ? '<1 min' : '0 min';
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  return [hours ? `${hours} h` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' ');
}

/** True before `hour` today; flips by itself at that hour and when the app comes back to the front. */
function useBeforeHour(hour: number, today: string) {
  const check = () => new Date().getHours() < hour;
  const [before, setBefore] = useState(check);
  useEffect(() => {
    let timer = 0;
    const update = () => {
      setBefore(check());
      window.clearTimeout(timer);
      const next = new Date();
      if (next.getHours() < hour) {
        next.setHours(hour, 0, 1, 0);
        timer = window.setTimeout(update, next.getTime() - Date.now());
      }
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [hour, today]);
  return before;
}

export function BudgetCoach({ data, today, focus, afterCard, commit, openGoals, reviewing, sync, openActivity }: {
  focus?: string; afterCard?: ReactNode;
  data: AppData; today: string; commit: Commit; openGoals: () => void; reviewing: boolean;
  sync: PhoneSync; openActivity: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionNote, setConnectionNote] = useState('');
  const native = onAndroid();
  const usageState = sync.status?.usage.state;
  const usageToday = data.screenTime?.find((day) => day.date === today);
  const stepsToday = data.steps?.find((day) => day.date === today)?.steps;
  const canSync = usageState === 'connected' || usageState === 'error';
  const status = budgetCoachStatus(data, today);
  const progress = status?.progress;
  const seconds = status?.plan.seconds ?? 0;
  const over = progress?.state === 'over';
  const near = !!progress && seconds > 0 && progress.used * 4 >= seconds * 3;
  const exceeded = status?.exceeded;
  const morning = useBeforeHour(sparkyResetHour, today);
  const reaction = dailyTurtleReaction(data, today, status?.resetDone, reviewing, morning);
  const { pose, yesterdayMissed } = reaction;
  const planned = data.eveningPlans?.some((plan) => plan.date === shiftDate(today, 1)) ?? false;
  const todayBlock = data.eveningPlans?.find((plan) => plan.date === today);
  const plannedHabit = todayBlock && data.habits.find((item) => item.id === todayBlock.habitId && !item.archivedAt);
  const resetAction = data.budgetCoach?.resetAction ?? defaultReset;
  const selected = status && activeBudgets(data, today).find(({ limit }) => limit.id === status.plan.id);
  const members = selected ? selected.change.apps ?? [selected.limit] : usageToday?.apps ?? [];
  const ring = turtleHabitProgress(data, today);
  const paused = scoringPaused(data, today);
  const bar = reviewing || paused ? undefined : sparkyBar(ring.done, ring.total, data.budgetCoach?.reviewHour ?? defaultTurtleReviewHour);
  const headline = paused ? 'Scoring is paused' : pose === 'proud' ? 'Proud of you!' : reaction.weeklyShort && reaction.done === reaction.total && reaction.total > 0 && pose === 'so-so' ? (reaction.date === today ? 'Every daily goal done today!' : 'Every daily goal done yesterday!') : pose === 'so-so' ? 'Making progress' : pose === 'disappointed' ? 'Let\'s turn today around'
    : ring.total && ring.done >= ring.total ? 'All done. Amazing!' : ring.done ? 'Nice start, keep going' : 'Let\'s make today count';

  async function connectOrSync() {
    if (connecting) return;
    setConnecting(true);
    setConnectionNote('');
    try {
      if (canSync) await sync.refresh(true);
      else if (!(await sync.command('connectUsage'))) {
        setConnectionNote('Turn on Permit usage access for Sparky in Android Settings, then return here.');
      }
    } catch {
      setConnectionNote('Android could not open Usage access. Open Usage access in Android Settings and select Sparky.');
    } finally {
      setConnecting(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const headsUp = form.has('headsUp');
    setPending(true);
    setError('');
    try {
      if (headsUp && !(await androidRequest<boolean>('requestNotifications'))) {
        setError('Allow Sparky notifications in Android settings to get a heads-up.');
        return;
      }
      const limitId = String(form.get('goal') ?? '') || undefined;
      const resetAction = String(form.get('reset') ?? '').trim() || undefined;
      const reviewHour = form.get('reviewHour') === '22' ? 22 : defaultTurtleReviewHour;
      if (await commit((current) => ({ ...current, budgetCoach: { ...current.budgetCoach,
        reviewHour, ...(status ? { limitId, resetAction, ...(onAndroid() ? { headsUp } : {}) } : {}) } }), 'Budget coach settings saved.')) setEditing(false);
      else setError('Could not save these settings. Try again.');
    } catch {
      setError('Could not update the notification permission. Try again.');
    } finally { setPending(false); }
  }

  return <section id="budget-coach" tabIndex={-1} className="panel budget-coach" data-pose={pose} data-over={over || undefined} aria-labelledby="budget-coach-title">
    <div className="daybook-feature" data-over={over || undefined}>
      <div className="daybook-feature-copy">
        {status ? <>
          <span className="screen-label">{status.plan.name} today</span>
          <span className="screen-number">{progress ? progress.remaining === 0 ? 'At your limit' : `${timeLabel(Math.abs(progress.remaining))} ${over ? 'over' : 'left'}` : 'Not counted yet'}</span>
          <span className="screen-detail">{progress ? `${timeLabel(progress.used)} of ${timeLabel(seconds)} used` : canSync ? 'Waiting for today’s usage' : 'Connect screen time to count it'}</span>
        </> : usageToday ? <>
          <span className="screen-label">Screen time today</span>
          <span className="screen-number">{timeLabel(usageToday.seconds)}</span>
          <button type="button" className="screen-link" onClick={openGoals}>Set a social media limit</button>
        </> : <>
          <span className="screen-label">Social media today</span>
          <span className="screen-detail">{native ? 'Connect screen time and set a limit. Sparky counts it as one habit.' : 'Screen time is counted in the Android app.'}</span>
        </>}
        {usageToday && <button type="button" className="screen-link" aria-expanded={details} aria-controls="today-budget-details"
          onClick={() => setDetails(!details)}>{details ? 'Hide apps' : 'See apps'}</button>}
        {stepsToday !== undefined && <span className="card-steps"><Footprints size={15} aria-hidden="true" />{stepsToday.toLocaleString()} steps today</span>}
        {bar && <span className="sparky-bar">{bar}</span>}
      </div>
      <div className="inline-sparky">
        <div className="sparky-stage"><SparkyRing done={ring.done} total={ring.total} />
          <TurtleAvatar pose={pose} reactionKey={reaction.key} today={today} completed={reaction.todayDone} comeback={reaction.comeback} planned={planned} reset={!!status?.resetDone} /></div>
        <span className="sparky-name day-count">{ring.total ? `${ring.done} of ${ring.total} done today` : 'Nothing due today'}</span>
      </div>
    </div>
    {afterCard}
    <div className="budget-coach-main"><div className="budget-coach-copy">
        <p className="sparky-headline">{headline}</p>
        {focus && <p className="sparky-focus">Today's priority · <strong>{focus}</strong></p>}
        <div className="budget-coach-heading"><h2 id="budget-coach-title">{status?.plan.name ?? 'Screen time budget'}</h2>
          <button type="button" className="icon-button" aria-label="Budget coach settings" onClick={() => {
            setError(''); setEditing(true);
          }}><Settings2 size={18} /></button></div>
      </div>
    </div>
    {activeBudgets(data, today).filter(({limit}) => limit.id !== status?.plan.id).map(({limit, change}) => {
      const budget = checkAppLimit(limit.id, change.minutes, usageToday, change.apps);
      return <button type="button" className="daybook-budget-row" key={limit.id} onClick={openGoals}><span>{limit.name}</span>
        <strong>{budget ? budget.remaining === 0 ? 'At your limit' : `${timeLabel(Math.abs(budget.remaining))} ${budget.remaining < 0 ? 'over' : 'left'}` : 'Waiting for usage'}</strong></button>;
    })}
    {usageToday && details && <div id="today-budget-details" className="budget-breakdown">
      <ul>{members.map((member) => ({ ...member, seconds: usageToday.apps.find((app) => app.id === member.id)?.seconds ?? 0 }))
        .sort((a, b) => b.seconds - a.seconds).map((app) => <li key={app.id}><span>{app.name}</span><strong>{timeLabel(app.seconds)}</strong></li>)}</ul>
      {!members.length && <p>No app usage recorded today.</p>}
      <small>{sync.status?.screen?.updated ? `Last synced ${new Date(sync.status.screen.updated).toLocaleString()}` : 'Last sync time unavailable'}</small>
    </div>}
    {!paused && reaction.comeback && <p className="sparky-welcome">Welcome back. You took a step today after missing one yesterday.</p>}
    {todayBlock && plannedHabit && <p className="budget-coach-message">You planned {plannedHabit.title} for {new Date(todayBlock.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} today.</p>}
    {!paused && reviewing && <p className="budget-coach-message" role="status">Evening check · {reaction.total
      ? `${reaction.done} of ${reaction.total} habits done`
      : 'No habits due today'}{exceeded ? ' · An app limit was exceeded' : progress ? ' · Within this screen time budget' : ''}</p>}
    {!reviewing && reaction.date !== today && yesterdayMissed > 0 && <p className={`budget-coach-message${pose === 'disappointed' ? ' budget-coach-warning' : ''}`}>
      {yesterdayMissed} {yesterdayMissed === 1 ? 'habit' : 'habits'} missed yesterday.</p>}
    {!reviewing && reaction.date === today && reaction.overLimit && <p className="budget-coach-message">Over your {reaction.overLimit} limit today. That counts as one missed habit.</p>}
    {!reviewing && !reaction.weeklyShort && pose === 'so-so' && reaction.total > 0 && <p className="budget-coach-message">
      {reaction.done} of {reaction.total} habits done {reaction.date === today ? 'today' : 'yesterday'}.</p>}
    {!reviewing && pose === 'proud' && !status?.resetDone && reaction.total > 0 && <p className="budget-coach-message">
      All {reaction.total} {reaction.total === 1 ? 'habit' : 'habits'} done {reaction.date === today ? 'today' : 'yesterday'}.</p>}
    {!paused && reaction.weeklyShort && <div className="budget-coach-message">
      <strong>{reaction.date === today ? 'This' : 'Last'} week’s unfinished goals affected Sparky’s mood.</strong>
      <ul>{reaction.weekly.filter(({ count, target }) => count < target).map(({ id, title, count, target, avoid }) =>
        <li key={id}>{title} · {count} of {target} {avoid ? 'days avoided' : 'sessions completed'}</li>)}</ul>
    </div>}
    <SparkyDays data={data} today={today} />
    {!paused && <details className="sparky-score">
      <summary>How Sparky scored {reaction.date === today ? 'today' : 'yesterday'}</summary>
      {!reviewing && sparkyTarget(data, today) && <p className="sparky-target">{sparkyTarget(data, today)}</p>}
      <p>{reaction.total ? `${reaction.done} of ${reaction.total} commitments completed (${Math.floor(100 * reaction.done / reaction.total)}%).` : 'No habits due.'}
        {reaction.bonus > 0 && ` Plus ${reaction.bonus} extra weekly session${reaction.bonus === 1 ? '' : 's'}.`}</p>
      {reaction.missed.length > 0 && <p>Still open · {reaction.missed.map((habit) => habit.title).join(', ')}</p>}
      {reaction.slipped.length > 0 && <p>Slipped (settled) · {reaction.slipped.map((habit) => habit.title).join(', ')}</p>}
      {reaction.limitsOver.length > 0 && <p>Over the limit · {reaction.limitsOver.join(', ')}</p>}
      {reaction.todayWeekly.length > 0 && <>
        <h3>Flexible this week</h3>
        <ul>{reaction.todayWeekly.map(({ id, title, count, target, avoid }) => <li key={id}>
          {title} · {count} of {target} {avoid ? 'days avoided' : 'sessions'}{count >= target && ' · Goal met'}
        </li>)}</ul>
        <p>Unfinished weekly goals affect Sparky’s mood at the Sunday evening check.</p>
      </>}
      <p>All due habits done earns a thumbs-up. At least 70% earns so-so. If you did at least half and only missed one or two part-week habits, that also earns so-so. Less earns a head shake. Each app limit counts as one habit: done while you stay under it, missed once you go over. Small wins count as one habit once 70% of them are done.</p>
      <p>A minimum or restart counts. Planned rest and unscheduled weekly sessions stay outside the daily total.</p>
    </details>}
    {!paused && reviewing && <EveningSuggestion key={today} data={data} today={today} habit={carryHabit(data, today)} commit={commit} />}
    {status ? <>
      {progress && status.plan.seconds > 0 && <progress aria-label="Today’s screen time budget" max={status.plan.seconds}
        value={Math.min(status.plan.seconds, progress.used)} />}
      {exceeded && exceeded.id !== status.plan.id && <p className="budget-coach-message budget-coach-warning">{timeLabel(exceeded.seconds)} over your {exceeded.name} limit.</p>}
      {status.resetDone ? <p className="budget-coach-message">You followed through on your reset.</p> : exceeded ? <div className="budget-coach-reset">
        <p>{resetAction}</p><button type="button" className="secondary-button" onClick={() => void commit((current) => ({ ...current,
          budgetCoach: { ...current.budgetCoach, lastReset: { date: localDate(), limitId: exceeded.id } } }), 'Reset checked off.')}>
          I did my reset</button>
      </div> : progress && near ? <p className="budget-coach-message">{progress.remaining === 0
        ? 'You’ve used today’s budget.' : 'What do you want to save the rest of your budget for?'}</p>
        : status.yesterdayWithin && <p className="budget-coach-message">You stayed within budget yesterday.</p>}
      {status.week.within + status.week.over > 0 && <p className="muted budget-coach-week">This week · {status.week.within} of {status.week.within + status.week.over} checked days within budget</p>}
    </> : null}
    {!native && isAndroidAppPage() && <p className="muted">Update Android System WebView to enable phone connections.</p>}
    {usageState === 'permission' && <p className="budget-coach-message">Allow Usage access for Sparky in Android Settings.</p>}
    {(sync.error || usageState === 'error') && native && <p className="budget-coach-message" role="status">Screen time did not update just now. Tap Sync now to try again.</p>}
    {connectionNote && <p className="budget-coach-message" role="status">{connectionNote}</p>}
    <div className="budget-coach-actions">
      {native && <button type="button" className="text-button" disabled={connecting} onClick={() => void connectOrSync()}>
        {connecting ? 'Checking screen time…' : canSync ? 'Sync now' : 'Connect screen time'}</button>}
      {!native && !isAndroidAppPage() && !import.meta.env.VITE_STUDIO_PREVIEW && <a href="/one-life-daybook.apk" className="text-button">Download Android app</a>}
      {(canSync || usageToday) && <button type="button" className="text-button" onClick={openActivity}>View apps and charts</button>}
      {!status && (native || canSync) && <button type="button" className="text-button" onClick={openGoals}>Go to app limits <ChevronRight size={16} /></button>}
    </div>
    {editing && <Dialog title="Budget coach settings" close={() => { if (!pending) setEditing(false); }}>
      <form className="form-stack" onSubmit={(event) => void save(event)}>
        {status && <><label>Budget to watch<select name="goal" defaultValue={status.plan.id}>{activeBudgets(data, today).map(({ limit }) =>
          <option key={limit.id} value={limit.id}>{limit.name}</option>)}</select></label>
        <label>My reset after going over<input name="reset" defaultValue={resetAction} maxLength={140} /></label></>}
        <label>Evening check<select name="reviewHour" defaultValue={data.budgetCoach?.reviewHour ?? defaultTurtleReviewHour}>
          <option value="21">9:00 PM</option><option value="22">10:00 PM</option>
        </select></label>
        {status && onAndroid() && <label className="check-label"><input name="headsUp" type="checkbox" defaultChecked={data.budgetCoach?.headsUp} />
          <span><Bell size={15} /> One heads-up per day at 75%</span></label>}
        {error && <p className="error" role="alert">{error}</p>}
        {error && onAndroid() && <button type="button" className="text-button" onClick={() => {
          void androidRequest('openNotificationSettings').catch(() => setError('Open Android Settings to manage Sparky notifications.'));
        }}>Android notification settings</button>}
        <button type="submit" className="primary-button" disabled={pending}>Save settings</button>
      </form>
    </Dialog>}
  </section>;
}

const poseLabel = { proud: 'proud', 'so-so': 'so-so', disappointed: 'disappointed', ready: 'no verdict' } as const;

function SparkyDays({ data, today }: { data: AppData; today: string }) {
  const days = sparkyHistory(data, today);
  if (!days.some(({ date, pose }) => pose || scoringPaused(data, date))) return null;
  return <div className="sparky-days" aria-label="Sparky over the last 14 days">
    <span className="sparky-days-title">Last 14 days</span>
    <ol>{days.map(({ date, pose, done, total }) => {
      const weekday = new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'narrow' });
      const label = `${new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}: ${
        scoringPaused(data, date) ? 'paused' : pose ? poseLabel[pose] : 'not scored'}${total ? `, ${done} of ${total} habits` : ''}`;
      return <li key={date} title={label} aria-label={label} data-today={date === today || undefined}>
        <span className={`sparky-day-face${pose ? ` ${pose}` : ' empty'}`} aria-hidden="true" />
        <span className="sparky-day-letter" aria-hidden="true">{weekday}</span>
      </li>;
    })}</ol>
  </div>;
}
