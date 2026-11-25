import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, HeartPulse, ListTodo, Share2, Smartphone } from 'lucide-react';
import { androidRequest, onAndroid, shareText } from './android.ts';
import { displayDate, type Commit } from './expansion.tsx';
import { localDate, type AppData } from './model.ts';
import { type PhoneSync } from './phone-sync.ts';
import { unfinishedToday } from './reminders.ts';

type CalendarEvent = { title: string; start: number; allDay: boolean };
type GoogleList = { id: string; title: string };
type GoogleTask = { id: string; title: string; due: string };

export function Connections({ data, commit, sync, switcher }: { data: AppData; commit: Commit; sync: PhoneSync; switcher?: ReactNode;
}) {
  const native = onAndroid();
  const [events, setEvents] = useState<CalendarEvent[]>();
  const [taskLists, setTaskLists] = useState<GoogleList[]>();
  const [tasksConnected, setTasksConnected] = useState(false);
  const [selectedList, setSelectedList] = useState('');
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [reminder, setReminder] = useState(data.reminder ?? '');
  const [exactReminders, setExactReminders] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [shared, setShared] = useState('');
  const [remove, setRemove] = useState<'health' | 'usage'>();
  const health = sync.status?.health;
  const usage = sync.status?.usage;
  const healthConnected = health?.state === 'connected' || (health?.state === 'error' && (health.sleep || health.steps || health.exercise || health.distance));
  const healthSyncTime = Math.max(sync.status?.sleep?.updated ?? 0, sync.status?.steps?.updated ?? 0,
    sync.status?.exercise?.updated ?? 0, sync.status?.distance?.updated ?? 0);
  const usageSyncTime = sync.status?.screen?.updated;
  useEffect(() => {
    if (!native) return;
    let active = true;
    void androidRequest<string>('reminderStatus').then((value) => { if (active) setReminder(value); }).catch(() => {});
    void androidRequest<boolean>('googleTaskStatus').then((connected) => { if (active) setTasksConnected(connected); }).catch(() => {});
    const checkExact = () => {
      void androidRequest<boolean>('exactReminderStatus').then((value) => { if (active) setExactReminders(value); }).catch(() => {});
    };
    checkExact();
    window.addEventListener('focus', checkExact);
    return () => { active = false; window.removeEventListener('focus', checkExact); };
  }, [native]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try { await action(); }
    catch (cause) { if (!(cause instanceof Error && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'The connection could not be opened.'); }
    finally { setBusy(false); }
  }

  function hideTasks() {
    setTaskLists(undefined);
    setSelectedList('');
    setTasks([]);
  }

  function pause(source: 'health' | 'usage') {
    return sync.command('pausePhoneActivity', source);
  }

  function clearControls(source: 'health' | 'usage', label: string) {
    return remove === source ? <div className="connection-actions">
      <button className="danger-button" disabled={busy} onClick={() => void run(async () => {
        if (native) await pause(source);
        if (await commit((current) => source === 'health' ? { ...current, sleep: [], steps: [], exercise: [], distance: [],
          logs: current.logs.filter((log) => !log.imported) }
          : { ...current, screenTime: [] }, `${label} history cleared.`)) setRemove(undefined);
      })}>Confirm removal</button>
      <button className="secondary-button" disabled={busy} onClick={() => setRemove(undefined)}>Cancel</button>
    </div> : <button className="text-button danger-text" disabled={busy} onClick={() => setRemove(source)}>Clear {label.toLowerCase()} history</button>;
  }

  return <>
    <div className="page-heading"><h1>Phone connections</h1>{switcher}</div>
    <section id="phone-connections" className="panel settings-panel connections">
    {!native && <p className="muted"><Smartphone size={17} /> Install Sparky for Android to sync health and screen time, view device calendars, and schedule reminders.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {sync.error && <p className="muted" role="status">{sync.error}</p>}
    <div className="connection-row">
      <h3><HeartPulse size={17} /> Health Connect</h3>
      <p className="muted">Choose which activity records Sparky can read from Health Connect.</p>
      {health?.state === 'unavailable' && <p>Install or update Health Connect on this phone.</p>}
      {health?.state === 'permission' && <p>Allow a health metric to resume syncing.</p>}
      {health?.state === 'error' && <p>Some health data could not sync. Sparky will retry automatically.</p>}
      {healthConnected && <p>{[health.sleep && 'Sleep', health.steps && 'Steps', health.exercise && 'Exercise', health.distance && 'Distance'].filter(Boolean).join(', ')} sync about once an hour {health.background ? 'including in the background' : 'while Sparky is open'}.
        {healthSyncTime > 0 && <span className="muted"> Last checked {new Date(healthSyncTime).toLocaleString()}.</span>}</p>}
      {native && <div className="connection-actions">
        {(['sleep', 'steps', 'exercise', 'distance'] as const).map((metric) => (!healthConnected || !health?.[metric]) &&
          <button key={metric} className="secondary-button" disabled={busy} onClick={() => void run(async () => {
            await sync.command('connectHealth', metric);
          })}>Allow {metric}</button>)}
        {healthConnected && health.backgroundAvailable && !health.background && <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          if (!(await sync.command('connectBackgroundHealth'))) setMessage('Health sync will continue when Sparky is open.');
        })}>Allow background health sync</button>}
        {health && health.state !== 'off' && health.state !== 'unavailable' && <button className="text-button" disabled={busy} onClick={() => void run(async () => { await pause('health'); })}>Pause health sync</button>}
      </div>}
      {(data.sleep.length > 0 || Boolean(data.steps?.length || data.exercise?.length || data.distance?.length)) && clearControls('health', 'Health')}
    </div>
    <div className="connection-row">
      <h3><Smartphone size={17} /> Screen time</h3>
      <p className="muted">Sync daily app time and the apps used on this phone. Data stays on this phone unless you export a backup.</p>
      {usage?.state === 'permission' && <p>In Android’s Usage access settings, choose Sparky and turn on access.</p>}
      {usage?.state === 'error' && <p>Screen time could not sync. Sparky will retry automatically.</p>}
      {usage?.state === 'connected' && <p>Screen time syncs every 10 minutes while Sparky is open and about every 15 minutes in the background.
        {usageSyncTime && <span className="muted"> Last checked {new Date(usageSyncTime).toLocaleString()}.</span>}</p>}
      {native && <div className="connection-actions">
        {usage?.state !== 'connected' && <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          await sync.command('connectUsage');
        })}>Allow usage access</button>}
        {usage && usage.state !== 'off' && <button className="text-button" disabled={busy} onClick={() => void run(async () => { await pause('usage'); })}>Pause screen time sync</button>}
      </div>}
      {(data.screenTime?.length ?? 0) > 0 && clearControls('usage', 'Screen time')}
    </div>
    <div className="connection-row">
      <h3><CalendarDays size={17} /> Calendar</h3>
      <p className="muted">See the next seven days from calendars synced to Android. New events open in your calendar for review.</p>
      <div className="connection-actions">{native ? <>
        <button className="secondary-button" disabled={busy} onClick={() => void run(async () => setEvents(await androidRequest<CalendarEvent[]>('calendar')))}>Show upcoming events</button>
        <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await androidRequest('calendarEvent', ''); })}>New calendar event</button>
      </> : <a className="text-button" href="https://calendar.google.com/">Open Google Calendar</a>}</div>
      {events && (events.length ? <ul className="calendar-events">{events.map((event, index) =>
        <li key={`${event.start}:${index}`}><strong>{event.title}</strong><span className="muted">
          {new Intl.DateTimeFormat('en', event.allDay ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(event.start)}
        </span></li>)}</ul> : <p className="muted">No upcoming events were returned.</p>)}
    </div>
    <div className="connection-row">
      <h3><ListTodo size={17} /> Tasks and other apps</h3>
      <p className="muted">Read Google Tasks here after authorizing access, or share today’s list with any compatible app.</p>
      <div className="connection-actions">
        {native ? <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await androidRequest('tasks'); })}>Open Google Tasks</button>
          : <a className="text-button" href="https://tasks.google.com/">Open Google Tasks</a>}
        {native && <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          const lists = await androidRequest<GoogleList[]>('googleTaskConnect');
          setTasksConnected(true);
          setTaskLists(lists);
          setSelectedList(lists[0]?.id ?? '');
          setTasks([]);
          if (lists[0]) setTasks(await androidRequest<GoogleTask[]>('googleTaskItems', lists[0].id));
        })}>{taskLists ? 'Refresh Google Tasks' : tasksConnected ? 'Show Google Tasks' : 'Connect Google Tasks'}</button>}
        {(native || typeof navigator.share === 'function') && <button className="secondary-button" disabled={busy}
          onClick={() => void run(async () => {
            const habits = unfinishedToday(data, localDate());
            if (!habits.length) { setMessage('There are no unfinished habits to share today.'); return; }
            await shareText(['Sparky · Today', ...habits.map((habit) =>
              `• ${habit.trackingType === 'avoid' ? 'Log outcome for ' : ''}${habit.title}${habit.reminderTime ? ` (by ${habit.reminderTime})` : ''}`,
            )].join('\n'));
          })}><Share2 size={16} /> Share unfinished habits</button>}
        {native && <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          const value = await androidRequest<string>('sharedText');
          if (value) setShared(value);
          else setMessage('There is no shared text waiting.');
        })}>Review incoming share</button>}
      </div>
      {taskLists && (taskLists.length ? <>
        <label>Google Tasks list<select disabled={busy} value={selectedList} onChange={(event) => {
          const list = event.target.value;
          void run(async () => {
            setTasks(await androidRequest<GoogleTask[]>('googleTaskItems', list));
            setSelectedList(list);
          });
        }}>{taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
        {tasks.length ? <ul className="calendar-events">{tasks.map((task) => <li key={task.id}>
          <strong>{task.title}</strong>{task.due && <span className="muted">Due {displayDate(task.due)}</span>}
        </li>)}</ul> : <p className="muted">No unfinished tasks shown.</p>}
      </> : <p className="muted">Google returned no task lists.</p>)}
      {native && <>
        {taskLists && <button className="text-button" disabled={busy} onClick={hideTasks}>Hide Google Tasks</button>}
        {tasksConnected && <button className="text-button" disabled={busy} onClick={() => void run(async () => {
          await androidRequest('googleTaskClear');
          hideTasks();
          setTasksConnected(false);
          setMessage('Disconnected on this device.');
        })}>Disconnect Google Tasks</button>}
        <p className="muted">Hiding closes the list. Disconnecting also clears the access token on this device. To revoke authorization, remove Sparky in your Google Account.</p>
        <a className="text-button" href="https://myaccount.google.com/connections">Manage Google Account connections</a>
      </>}
      {shared && <div className="form-stack">
        <label>Shared text<textarea maxLength={2000} value={shared} rows={3} onChange={(event) => setShared(event.target.value)} /></label>
        <div className="connection-actions">
          <button className="primary-button" disabled={busy} onClick={() => void run(async () => {
            const day = localDate();
            const memo = shared.trim();
            if (!memo) return;
            if (await commit((current) => {
              const routine = current.routines.find((entry) => entry.date === day);
              const reflection = [routine?.reflection, memo].filter(Boolean).join('\n\n');
              if (reflection.length > 2000) throw new Error('This would exceed the length of today’s reflection.');
              return { ...current, routines: [...current.routines.filter((entry) => entry.date !== day),
                { date: day, plan: routine?.plan ?? '', reflection }] };
            }, 'Shared text saved to today’s reflection.')) setShared('');
          })}>Save to today’s reflection</button>
          <button className="secondary-button" disabled={busy} onClick={() => void run(async () => shareText(shared))}><Share2 size={16} /> Share text</button>
        </div>
      </div>}
    </div>
    {native && <div className="connection-row">
      <h3>Unfinished habit reminders</h3>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void run(async () => {
          const quietFrom = String(fields.get('quietFrom') ?? '') || undefined;
          const quietThrough = String(fields.get('quietThrough') ?? '') || undefined;
          if (Boolean(quietFrom) !== Boolean(quietThrough)) throw new Error('Enter both quiet-hour times or clear both.');
          await commit((current) => ({ ...current, reminderControls: { disabled: fields.has('disabled'), quietFrom, quietThrough } }), 'Reminder controls saved.');
        });
      }}>
        <label className="check-label"><input type="checkbox" name="disabled" defaultChecked={data.reminderControls?.disabled} /> Disable all habit reminders</label>
        <div className="form-grid">
          <label>Quiet hours start<input name="quietFrom" type="time" defaultValue={data.reminderControls?.quietFrom} /></label>
          <label>Quiet hours end<input name="quietThrough" type="time" defaultValue={data.reminderControls?.quietThrough} /></label>
        </div>
        <button className="secondary-button" disabled={busy}>Save reminder controls</button>
      </form>
      <p className="muted">Set a default time for scheduled habits that are still open. A time set on an individual habit takes priority. Android may delay delivery.</p>
      <form className="reminder-form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await androidRequest('reminder', reminder);
          await commit((current) => ({ ...current, reminder }), 'Default reminder saved.');
        });
      }}>
        <label>Default reminder time<input type="time" required value={reminder} onChange={(event) => setReminder(event.target.value)} /></label>
        <button className="primary-button" disabled={busy}>Save reminder</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          await androidRequest('reminder');
          setReminder('');
          await commit((current) => ({ ...current, reminder: undefined }), 'Default reminder disabled.');
        })}>Disable default</button>
      </form>
      <button className="text-button" disabled={busy} onClick={() => void run(async () => { await androidRequest('openNotificationSettings'); })}>
        Android notification settings
      </button>
      {!exactReminders && <button className="text-button" disabled={busy}
        onClick={() => void run(async () => { await androidRequest('openExactReminderSettings'); })}>Allow exact reminder times</button>}
    </div>}
    {native && <div className="connection-row">
      <h3>Home screen</h3>
      <div className="home-widget-options">
        {([
          ['sparky', 'Sparky', '1 × 1 and up', 'His mood and today’s score'],
          ['count', 'Habits today', '1 × 1 and up', 'Done out of due, with a bar'],
          ['streak', 'Streak', '1 × 1 and up', 'Your flame, and Sparky when it needs saving'],
          ['list', 'Today checklist', '2 × 2 and up', 'Tap to finish habits without opening the app'],
          ['next', 'Next habit', '1 × 1 and up', 'Tap to log the next habit'],
          ['budget', 'App budget', '1 × 1 and up', 'Time left in your app budget'],
          ['overview', 'Today overview', '2 × 1 and up', 'Open habits and what’s next'],
        ] as const).map(([kind, name, size, caption]) => <div className="home-widget-option" key={kind}>
          <div><strong>{name}</strong><span className="muted">{size} · {caption}</span></div>
          <button className="secondary-button" type="button" aria-label={`Add ${name} widget`} disabled={busy} onClick={() => void run(async () => {
            const requested = await androidRequest<boolean>('addHomeWidget', kind);
            setMessage(requested ? 'Confirm the widget on your home screen.' : 'Choose Sparky from your home screen’s widget picker.');
          })}>Add</button>
        </div>)}
      </div>
    </div>}
    </section>
  </>;
}
