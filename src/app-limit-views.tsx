import { useEffect, useState, type FormEvent } from 'react';
import { Clock3, Plus } from 'lucide-react';
import { androidRequest, onAndroid } from './android.ts';
import { appLimitForDay, checkAppLimit, countAppLimitDays, latestAppLimitChange, saveAppLimit, type LimitApp } from './app-limits.ts';
import { type Commit } from './expansion.tsx';
import { Dialog } from './forms.tsx';
import { localDate, maxAppLimitMinutes, minSharedLimitApps, newId, usageAppsSchema, type AppData, type AppLimit } from './model.ts';

const syncDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
const statusLabels = { under: 'Under limit', at: 'At limit', over: 'Over limit' };

function limitTime(seconds: number) {
  if (seconds > 0 && seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes} min`;
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

type Editor = { kind: 'app' | 'shared'; limit?: AppLimit };
const isShared = (limit: AppLimit) => limit.changes[0].apps !== undefined;

function LimitEditor({ editor, today, knownApps, individualLimits, commit, close }: {
  editor: Editor; today: string; knownApps: Map<string, LimitApp>; individualLimits: Set<string>; commit: Commit; close: () => void;
}) {
  const { limit } = editor;
  const shared = editor.kind === 'shared';
  const latest = limit && latestAppLimitChange(limit, today);
  const defaultMinutes = latest?.minutes ?? latest?.resumeMinutes ?? limit?.changes.filter(({ date, minutes }) => date <= today && minutes !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.minutes ?? undefined;
  const loadInstalled = onAndroid() && (shared || !limit);
  const [installed, setInstalled] = useState<LimitApp[]>([]);
  const [loading, setLoading] = useState(loadInstalled);
  const [members, setMembers] = useState(() => new Set(latest?.apps?.map(({ id }) => id)));
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loadInstalled) return;
    let active = true;
    void androidRequest('installedUsageApps').then((value) => {
      const result = usageAppsSchema.safeParse(value);
      if (active && result.success) setInstalled(result.data);
    }).catch(() => {
      // Apps saved in screen time history are still available.
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadInstalled]);

  const choices = new Map(knownApps);
  for (const app of installed) choices.set(app.id, app);
  const available = [...choices.values()].filter(({ id }) => shared || !individualLimits.has(id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nameCounts = new Map<string, number>();
  for (const { name } of available) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  const label = ({ name, id }: LimitApp) => (nameCounts.get(name) ?? 0) > 1 ? `${name} (${id})` : name;
  const visible = available.filter((app) => label(app).toLowerCase().includes(query.trim().toLowerCase()));

  async function apply(app: LimitApp, minutes: number | null, apps?: LimitApp[]) {
    if (pending) return;
    setPending(true);
    setError('');
    const title = shared ? 'Shared limit' : 'App limit';
    try {
      if (await commit((current) => saveAppLimit(current, app, localDate(), minutes, apps),
        `${title} ${minutes === null ? 'paused' : 'saved'}.`)) close();
      else setError('Could not save the limit. Try again.');
    } finally { setPending(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const input = String(fields.get('minutes') ?? '').trim();
    const minutes = Number(input);
    if (!input || !Number.isInteger(minutes) || minutes < 0 || minutes > maxAppLimitMinutes) return;
    if (shared) {
      const name = String(fields.get('name') ?? '').trim();
      const apps = available.filter(({ id }) => members.has(id));
      if (!name || apps.length < minSharedLimitApps) {
        setError('Enter a name and choose at least two apps.');
        return;
      }
      void apply({ id: limit?.id ?? newId(), name }, minutes, apps);
    } else {
      const app = limit ?? available.find(({ id }) => id === fields.get('app'));
      if (app) void apply({ id: app.id, name: app.name }, minutes);
    }
  }

  function toggleApp(id: string, checked: boolean) {
    setMembers((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return <Dialog title={`${limit ? 'Edit' : 'Set'} ${shared ? 'shared' : 'app'} limit`} close={() => { if (!pending) close(); }}>
    <form className="form-stack" onSubmit={save}>
      {shared ? <>
        <label>Shared limit name<input name="name" required maxLength={80} defaultValue={limit?.name} placeholder="Social media" /></label>
        <fieldset className="app-limit-picker">
          <legend>Apps in this limit</legend>
          <label>Find an app<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <p className="muted" aria-live="polite">{members.size} selected · Choose at least two</p>
          {visible.length ? <div className="app-limit-choices">{visible.map((app) => <label key={app.id} className="check-label">
            <input type="checkbox" checked={members.has(app.id)} onChange={(event) => toggleApp(app.id, event.target.checked)} />
            <span>{label(app)}</span>
          </label>)}</div> : <p className="muted">{loading ? 'Loading apps…' : query ? 'No apps match your search.' : 'No apps available yet.'}</p>}
        </fieldset>
      </> : limit ? <p><strong>{limit.name}</strong></p> : <label>App<select name="app" required defaultValue="">
        <option value="" disabled>{loading && !available.length ? 'Loading apps…' : 'Choose an app'}</option>
        {available.map((app) => <option key={app.id} value={app.id}>{label(app)}</option>)}
      </select></label>}
      <label>Daily limit in minutes<input name="minutes" type="number" inputMode="numeric" required min={0} max={maxAppLimitMinutes}
        defaultValue={defaultMinutes} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions">
        {limit && latest && latest.minutes !== null && <button className="text-button" type="button" disabled={pending}
          onClick={() => void apply({ id: limit.id, name: limit.name }, null, latest.apps)}>Pause limit</button>}
        <button type="submit" className="primary-button" disabled={pending || (!shared && !limit && !available.length)}>Save limit</button>
      </div>
    </form>
  </Dialog>;
}

export function AppLimits({ data, today, date = today, commit, lastSync }: {
  data: AppData; today: string; date?: string; commit: Commit; lastSync?: number;
}) {
  const [editor, setEditor] = useState<Editor>();
  const editable = date === today;
  const limits = data.appLimits ?? [];
  const usage = data.screenTime ?? [];
  const usageDay = usage.find((day) => day.date === date);
  const active = limits.flatMap((limit) => {
    const change = appLimitForDay(limit, date);
    return change ? [{ limit, change }] : [];
  }).sort((a, b) => a.limit.name.localeCompare(b.limit.name));

  if (!editable && !active.length) return null;

  const knownApps = new Map<string, LimitApp>();
  if (editable) {
    for (const limit of limits) {
      if (isShared(limit)) {
        for (const { apps } of limit.changes) for (const app of apps ?? []) knownApps.set(app.id, app);
      } else knownApps.set(limit.id, { id: limit.id, name: limit.name });
    }
    for (const day of [...usage].sort((a, b) => a.date.localeCompare(b.date))) {
      for (const { id, name } of day.apps) knownApps.set(id, { id, name });
    }
  }
  const individualLimits = new Set(active.filter(({ change }) => !change.apps).map(({ limit }) => limit.id));
  const canAddApp = onAndroid() || [...knownApps.keys()].some((id) => !individualLimits.has(id));
  const canAddShared = onAndroid() || knownApps.size >= minSharedLimitApps;
  const pausedShared = editable ? limits.filter((limit) => latestAppLimitChange(limit, today)?.minutes === null && isShared(limit)) : [];
  const usageByApp = new Map(usageDay?.apps.map(({ id, seconds }) => [id, seconds]));

  return <section className="panel settings-panel app-limits-card" aria-label="App limits">
    <div className="section-heading">
      <h2><Clock3 size={18} /> App limits</h2>
      {editable && <div className="app-limit-actions">
        {canAddApp && <button type="button" className="secondary-button" onClick={() => setEditor({ kind: 'app' })}>Set app limit</button>}
        {canAddShared && <button type="button" className="primary-button" onClick={() => setEditor({ kind: 'shared' })}>
          <Plus size={16} /> Set shared limit
        </button>}
      </div>}
    </div>
    {active.length ? <>
      {editable && <p className="muted app-limit-time">{lastSync ? `Screen time synced ${syncDate.format(lastSync)}` : 'Checked against recorded screen time'}</p>}
      <ul className="app-limit-list">{active.map(({ limit, change: { minutes, apps } }) => {
        const result = checkAppLimit(limit.id, minutes, usageDay, apps);
        return <li key={limit.id} className={`app-limit-row ${result?.state ?? ''}`}>
          <div className="app-limit-top">
            <div><strong>{limit.name}</strong><p className="muted">{apps ? 'Shared daily limit' : 'Daily limit'} {limitTime(minutes * 60)}</p></div>
            {editable && <button type="button" className="text-button" aria-label={`Edit ${limit.name} limit`}
              onClick={() => setEditor({ kind: apps ? 'shared' : 'app', limit })}>Edit</button>}
          </div>
          {result ? <>
            {minutes > 0 && <progress aria-label={`${limit.name} daily limit`} value={Math.min(result.used, minutes * 60)} max={minutes * 60} />}
            <div className="app-limit-result"><span>{limitTime(result.used)} used</span>
              <strong>{statusLabels[result.state]}{result.remaining !== 0 && ` · ${limitTime(Math.abs(result.remaining))} ${result.remaining < 0 ? 'over' : 'left'}`}</strong></div>
          </> : <p className="muted">{editable ? 'Waiting for today’s screen time.' : 'No screen time was recorded for this day.'}</p>}
          {apps && <details className="app-limit-members">
            <summary>{apps.length} apps share this limit</summary>
            <ul>{apps.map(({ id, name }) => <li key={id}>
              <span>{name}</span>{usageDay && <span className="muted">{limitTime(usageByApp.get(id) ?? 0)}</span>}
            </li>)}</ul>
          </details>}
        </li>;
      })}</ul>
    </> : <p className="muted">{canAddApp ? 'Set a daily limit for one app or share a budget across several.' : 'Apps become available to limit after Sparky records their usage.'}</p>}
    {pausedShared.length > 0 && <details className="app-limit-members app-limit-paused">
      <summary>Paused shared limits</summary>
      <ul>{pausedShared.map((limit) => <li key={limit.id}><span>{limit.name}</span><button className="text-button" type="button"
        aria-label={`Resume ${limit.name} limit`} onClick={() => setEditor({ kind: 'shared', limit })}>Resume</button></li>)}</ul>
    </details>}
    {editable && editor && <LimitEditor editor={editor} knownApps={knownApps} individualLimits={individualLimits} today={today}
      commit={commit} close={() => setEditor(undefined)} />}
  </section>;
}

export function AppLimitHistory({ data, dates, today }: { data: AppData; dates: string[]; today: string }) {
  const usage = new Map((data.screenTime ?? []).map((day) => [day.date, day]));
  const summaries = (data.appLimits ?? []).map((limit) => ({ limit, ...countAppLimitDays(limit, dates, today, usage) }))
    .filter(({ active }) => active).sort((a, b) => a.limit.name.localeCompare(b.limit.name));
  if (!summaries.length) return null;
  return <section className="panel settings-panel app-limits-card" aria-label="App limits">
    <h2><Clock3 size={18} /> App limits</h2>
    <ul className="app-limit-list">{summaries.map(({ limit, within, over }) => <li key={limit.id} className="app-limit-row">
      <strong>{limit.name}</strong>
      {within + over ? <>
        <progress aria-label={`${limit.name} days at or under the limit`} value={within} max={within + over} />
        <div className="app-limit-result"><span>{within} of {within + over} completed days at or under</span><span>{over} over</span></div>
      </> : <p className="muted">No completed days checked yet.</p>}
    </li>)}</ul>
  </section>;
}
