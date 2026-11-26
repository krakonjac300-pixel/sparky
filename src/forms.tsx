import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { browserNavigation, trackDialog } from './dialog-history.ts';
import { Check, X } from 'lucide-react';
import { habitSchema, icons, localDate, newId, weekdays, type AppData, type Category, type Habit, type HabitLog, type LogEntry, slipSize } from './model.ts';
import { learnedReminderText } from './reminders.ts';
import type { Recovery } from './planning.ts';

export function Dialog({ title, close, children, confirmation, restore }: { title: string; close: () => void; children: ReactNode; confirmation?: boolean; restore?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const handlers = useRef({ close, restore });
  const navigation = useRef<ReturnType<typeof trackDialog>>(undefined);
  handlers.current = { close, restore };
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    navigation.current = browserNavigation() ? trackDialog(() => handlers.current.close(), handlers.current.restore) : undefined;
    dialog.showModal();
    // Close while the dialog is still connected so the browser can restore its opener.
    return () => {
      dialog.close();
      navigation.current?.unmount();
      if (opener instanceof HTMLElement) queueMicrotask(() => {
        if (opener.isConnected && document.activeElement === document.body) opener.focus();
      });
    };
  }, []);
  const dismiss = () => { if (navigation.current) navigation.current.dismiss(); else close(); };
  return <dialog ref={ref} className={confirmation ? undefined : 'task-sheet'} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <header className="dialog-title">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="icon-button" aria-label="Close" onClick={dismiss}><X size={20} /></button>
    </header>
    {children}
  </dialog>;
}

export function HabitForm({ initial, breakTitle, categories, habits, suggestedTime, reminderControls, save, archive, busy }: {
  initial?: Habit; breakTitle?: string; categories: Category[]; habits: Habit[]; suggestedTime?: string; reminderControls?: AppData['reminderControls'];
  save: (habit: Habit) => void; archive: (habit: Habit) => void; busy: boolean;
}) {
  const [type, setType] = useState<Habit['trackingType']>(initial?.trackingType ?? (breakTitle === undefined ? 'checkbox' : 'avoid'));
  const [days, setDays] = useState<number[]>(initial?.days ?? weekdays.map(([day]) => day));
  const [schedule, setSchedule] = useState(initial?.onceOn ? 'once' : initial?.weeklyTarget ? 'weekly' : 'days');
  const [restart, setRestart] = useState(!initial?.restartDisabled);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [reminder, setReminder] = useState(initial?.reminderTime ?? '');
  // Sparky learns the usual time by default; a habit keeps a fixed time only when one was chosen.
  const [lead, setLead] = useState<Habit['learnedLead']>(initial?.learnedLead ?? (initial?.reminderTime ? undefined : 30));
  const canLearn = type !== 'avoid' && schedule !== 'once';
  const quantitative = type !== 'checkbox' && type !== 'avoid';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const now = new Date();
    const field = (name: string) => String(fields.get(name) ?? '').trim();
    const flex = schedule === 'weekly';
    const cue = field('replacementCue'), action = field('replacementAction'), time = field('replacementTime');
    const slipUnit = field('slipUnit');
    const slipCount = type === 'avoid' && slipUnit ? { unit: slipUnit, little: Number(fields.get('slipLittle')), lot: Number(fields.get('slipLot')) } : undefined;
    if (slipCount && !(slipCount.little >= 1 && slipCount.lot > slipCount.little)) {
      setError('"A lot" has to be more than "a little".');
      return;
    }
    if (type === 'avoid' && (cue || action || time) && (!cue || !action)) {
      setError('Enter both a cue and a replacement action.');
      return;
    }
    const result = habitSchema.safeParse({
      ...initial, id: initial?.id ?? newId(),
      createdAt: initial?.createdAt ?? now.toISOString(), createdDate: initial?.createdDate ?? localDate(now),
      sortOrder: initial?.sortOrder ?? 0, categoryId: fields.get('category'),
      title: fields.get('title'), description: fields.get('description'), trackingType: type,
      days: schedule === 'days' ? days : weekdays.map(([day]) => day),
      weeklyTarget: flex ? Number(fields.get('weeklyTarget')) : undefined,
      onceOn: schedule === 'once' ? field('onceOn') : undefined,
      pauseThrough: field('pauseThrough') || undefined,
      afterHabitId: field('afterHabitId') || undefined,
      healthSource: field('healthSource') || undefined,
      restartFrom: type !== 'avoid' && restart
        ? initial?.restartFrom ?? (!initial || initial.restartDisabled || initial.trackingType === 'avoid' ? localDate(now) : undefined)
        : undefined,
      restartDisabled: type !== 'avoid' && !restart ? true : undefined,
      tinyRestart: type !== 'avoid' && restart ? field('tinyRestart') || undefined : undefined,
      consequence: type !== 'avoid' && restart ? field('consequence') || undefined : undefined,
      replacement: type === 'avoid' && cue && action ? { cue, action, time: time || undefined } : undefined,
      slipCount,
      learnedLead: canLearn ? lead : undefined,
      reminderTime: reminder || undefined,
      extraReminderTime: field('extraReminderTime') || undefined,
      unit: type === 'minutes' ? 'min' : type === 'rating' ? 'out of 5' : type === 'measurement' ? field('unit') : type === 'count' ? field('unit') || 'reps' : '',
      thresholds: !quantitative ? undefined : {
        minimum: Number(fields.get('minimum')), target: Number(fields.get('target')), stretch: Number(fields.get('stretch')),
      },
    });
    if (!result.success) {
      setError(days.length ? 'Enter a habit name and set minimum ≤ target ≤ stretch.' : 'Choose at least one scheduled day.');
      return;
    }
    setError('');
    save(result.data);
  }
  if (removing && initial) return <div className="form-stack">
    <p>Remove {initial.title} from your plan? Past entries stay in History.</p>
    <button className="danger-button" disabled={busy} onClick={() => archive(initial)}>Remove from plan</button>
    <button className="secondary-button" onClick={() => setRemoving(false)}>Keep habit</button>
  </div>;
  return <form onSubmit={submit} className="form-stack">
    <label>Habit name<input autoFocus name="title" defaultValue={initial?.title ?? breakTitle} required maxLength={80} placeholder={type === 'avoid' ? 'e.g. Eating sweets' : 'e.g. Take a walk'} /></label>
    <label>Description <span className="muted">(optional)</span><input name="description" defaultValue={initial?.description} maxLength={240} /></label>
    <div className="form-grid category-grid">
      <label>Life area<select name="category" defaultValue={initial?.categoryId}>{categories.map((category) =>
        <option key={category.id} value={category.id}>{category.parentId ? `${categories.find((item) => item.id === category.parentId)?.name} / ` : ''}{category.name}</option>)}</select></label>
      <label>Tracking<select value={type} onChange={(event) => setType(event.target.value as Habit['trackingType'])}>
        <option value="checkbox">Checkbox</option><option value="minutes">Minutes</option><option value="count">Count</option>
        <option value="measurement">Measurement</option><option value="rating">Rating</option><option value="avoid">Avoid a habit</option>
      </select></label>
    </div>
    <label>Schedule<select value={schedule} onChange={(event) => setSchedule(event.target.value)}>
      <option value="days">Fixed days</option><option value="weekly">Any days this week</option><option value="once">One date</option>
    </select></label>
    {schedule === 'once' ? <label>Scheduled date<input type="date" name="onceOn" required defaultValue={initial?.onceOn ?? localDate()} /></label> :
    schedule === 'weekly' ? <label>{type === 'avoid' ? 'Days to avoid it per week' : 'Sessions per week'}<input type="number" name="weeklyTarget" min={1} max={7} required
      defaultValue={initial?.weeklyTarget ?? 3} /></label> :
    <fieldset><legend>Scheduled days <span className="muted">· {days.length} per week</span></legend>
      <div className="day-choices">{weekdays.map(([day, name]) => <button type="button" key={day} aria-pressed={days.includes(day)}
        onClick={() => setDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])}>{name}</button>)}</div>
    </fieldset>}
    <label>Pause through (optional)<input type="date" name="pauseThrough" defaultValue={initial?.pauseThrough} /></label>
    <label>Do after another habit (optional)<select name="afterHabitId" defaultValue={initial?.afterHabitId ?? ''}>
      <option value="">No cue habit</option>
      {habits.filter((habit) => habit.id !== initial?.id && (!habit.archivedAt || habit.id === initial?.afterHabitId)).map((habit) =>
        <option key={habit.id} value={habit.id}>{habit.title}</option>)}
    </select></label>
    {quantitative && <>
      {(type === 'count' || type === 'measurement') && <label>{type === 'count' ? 'Count unit' : 'Measurement unit'}<input key={type} name="unit" maxLength={18} required={type === 'measurement'} defaultValue={initial?.trackingType === type ? initial.unit : ''} placeholder={type === 'count' ? 'e.g. pages' : 'e.g. km'} /></label>}
      <fieldset key={type}><legend>Achievement levels</legend><div className="form-grid thresholds">
        {(['minimum', 'target', 'stretch'] as const).map((level, index) => <label key={level}>{['Minimum', 'Target', 'Stretch'][index]}
          <input type="number" inputMode={type === 'measurement' ? 'decimal' : 'numeric'} name={level} min={type === 'measurement' ? 0.01 : 1} max={type === 'rating' ? 5 : 100000} step={type === 'measurement' ? 'any' : 1} required defaultValue={(initial?.trackingType === type ? initial.thresholds?.[level] : undefined) ?? (type === 'rating' ? [2, 4, 5] : [5, 10, 20])[index]} />
        </label>)}
      </div></fieldset>
    </>}
    {quantitative && type !== 'rating' && <label key={`${type}-health`}>Health Connect logging<select name="healthSource" defaultValue={initial?.trackingType === type ? initial.healthSource ?? '' : ''}>
      <option value="">Manual logging</option>
      {type === 'minutes' && <><option value="sleep">Sleep minutes</option><option value="exercise">Exercise minutes</option></>}
      {type === 'count' && <option value="steps">Daily steps (unit: steps)</option>}
      {type === 'measurement' && <option value="distance">Daily distance (unit: km)</option>}
    </select></label>}
    {type !== 'avoid' && <>
      <label className="check-label"><input type="checkbox" checked={restart} onChange={(event) => setRestart(event.target.checked)} /> Help me restart after a miss</label>
      {restart && <>
        <label>Tiny restart <span className="muted">(optional)</span><input name="tinyRestart" maxLength={140}
          defaultValue={initial?.tinyRestart} placeholder="e.g. Put my walking shoes by the door" /></label>
        <label>Consequence after three misses <span className="muted">(optional)</span><input name="consequence" maxLength={140}
          defaultValue={initial?.consequence} placeholder="e.g. Tidy for five minutes before scrolling" /></label>
      </>}
    </>}
    {type === 'avoid' && <fieldset><legend>Count when you slip <span className="muted">(optional)</span></legend>
      <div className="form-stack">
        <label>What to count<input name="slipUnit" maxLength={18} defaultValue={initial?.slipCount?.unit} placeholder="e.g. beers, cookies, coffees" /></label>
        <div className="form-grid thresholds">
          <label>A little: up to<input type="number" inputMode="numeric" name="slipLittle" min={1} max={1000} defaultValue={initial?.slipCount?.little ?? 1} /></label>
          <label>A lot: from<input type="number" inputMode="numeric" name="slipLot" min={2} max={1000} defaultValue={initial?.slipCount?.lot ?? 4} /></label>
        </div>
        <small className="field-hint">Leave empty to pick a little, normal or a lot without counting.</small>
      </div>
    </fieldset>}
    {type === 'avoid' && <fieldset><legend>Replacement plan <span className="muted">(optional)</span></legend>
      <div className="form-stack">
        <label>When I’m tempted<input name="replacementCue" maxLength={140} defaultValue={initial?.replacement?.cue} placeholder="e.g. After dinner" /></label>
        <label>What I’ll do instead<input name="replacementAction" maxLength={140} defaultValue={initial?.replacement?.action} placeholder="e.g. Make tea first" /></label>
        <label>Remind me before that<input name="replacementTime" type="time" defaultValue={initial?.replacement?.time} /></label>
      </div>
    </fieldset>}
    {canLearn && <label>Habit reminder<select value={lead ?? ''} onChange={(event) =>
      setLead(event.target.value ? Number(event.target.value) as Habit['learnedLead'] : undefined)}>
      <option value="">At a fixed time</option>
      {[15, 30, 60].map((value) => <option key={value} value={value}>Sparky: {value} min before my usual time</option>)}
    </select>{lead && <small className="field-hint">{learnedReminderText(suggestedTime, lead, reminderControls)}</small>}</label>}
    {(!canLearn || !lead) && <label>{type === 'avoid' ? 'Check-in time' : 'Remind if unfinished at'} <span className="muted">(optional)</span>
      <input type="time" name="reminderTime" value={reminder} onChange={(event) => setReminder(event.target.value)} />
      <small className="field-hint">Uses Android notifications. Leave blank to use your default reminder, if set.</small>
    </label>}
    {canLearn && !lead && suggestedTime && suggestedTime !== reminder && <button type="button" className="text-button" onClick={() => setReminder(suggestedTime)}>Use suggested time {suggestedTime}</button>}
    <label>Second reminder (optional)<input type="time" name="extraReminderTime" defaultValue={initial?.extraReminderTime} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">
      {initial && <button type="button" className="text-button danger-text" onClick={() => setRemoving(true)}>Remove habit</button>}
      <button className="primary-button" disabled={busy}><Check size={17} /> Save habit</button>
    </div>
  </form>;
}

const breakOptions = [
  'Eating sweets', 'Sugary drinks', 'Late-night scrolling', 'Phone in bed', 'Impulse shopping',
  'Hitting snooze', 'Caffeine after dinner', 'Mindless snacking', 'Biting my nails', 'Social media before breakfast',
  'Eating in front of a screen', 'Checking work messages after hours',
];

export function BreakList({ existing, choose }: { existing: Habit[]; choose: (title: string) => void }) {
  const titles = new Set(existing.filter((habit) => habit.trackingType === 'avoid' && !habit.archivedAt).map((habit) => habit.title.toLowerCase()));
  return <div className="form-stack">
    <p className="muted">Pick something you want to do less often. You can edit its name, schedule, and check-in time before saving.</p>
    <div className="break-options">{breakOptions.map((title) => <button key={title} type="button" className="secondary-button"
      disabled={titles.has(title.toLowerCase())} onClick={() => choose(title)}>{title}</button>)}</div>
    <button type="button" className="primary-button" onClick={() => choose('')}>Create my own</button>
  </div>;
}

export function LogForm({ habit, log, save, edit, busy, recovery, useMinimum, timer }: {
  habit: Habit; log?: HabitLog; busy: boolean; edit?: () => void;
  timer?: ReactNode;
  save: (entry?: LogEntry) => void; recovery?: Recovery; useMinimum?: boolean;
}) {
  const suggestedAmount = recovery ? recovery.value : useMinimum ? habit.thresholds?.minimum : habit.thresholds?.target;
  const [amount, setAmount] = useState(log?.status === 'done' ? String(log.value)
    : String(suggestedAmount ?? ''));
  const [note, setNote] = useState(log?.note ?? '');
  const [usedReplacement, setUsedReplacement] = useState(log?.replacementUsed ?? false);
  const [slipAmount, setSlipAmount] = useState(log?.status === 'slipped' && log.value ? String(log.value) : '');
  const slipValue = Number(slipAmount);
  const validSlip = Number.isInteger(slipValue) && slipValue >= 1 && slipValue <= 1000;
  const amountValue = Number(amount);
  const validAmount = Number.isFinite(amountValue) && amountValue > 0 &&
    amountValue <= (habit.trackingType === 'rating' ? 5 : 100000) &&
    (habit.trackingType === 'measurement' || Number.isInteger(amountValue));
  const submitLabel = habit.trackingType === 'avoid' ? 'I avoided it' : !habit.thresholds ? 'Mark complete'
    : validAmount ? `Log ${amountValue} ${habit.unit}`.trim() : 'Log progress';
  const entry = (status: HabitLog['status'], value: number, slip?: HabitLog['slip']): LogEntry => ({
    status, value, note: note.trim() || undefined, slip,
    replacementUsed: habit.replacement && (status === 'done' || status === 'slipped') ? usedReplacement : undefined,
    restart: status === 'done' && (habit.thresholds && recovery?.value !== undefined && value >= recovery.value && value < habit.thresholds.target ||
      log?.restart && value === log.value) ? true : undefined,
  });
  return <form className="form-stack" onSubmit={(event) => {
    event.preventDefault();
    if (habit.thresholds && !validAmount) return;
    save(entry('done', habit.thresholds ? amountValue : 1));
  }}>
    {habit.description && <p className="muted">{habit.description}</p>}
    {log?.imported && <p className="muted">Imported from Health Connect. Saving here overrides the imported value.</p>}
    {timer && <div className="timer-method">{timer}<span className="muted">Or enter your minutes below</span></div>}
    {recovery && <p className="restart-hint"><strong>Easier step</strong> <span>{recovery.label}</span></p>}
    {habit.replacement && <div className="form-stack"><p>{habit.replacement.cue} · {habit.replacement.action}</p>
      <label className="check-label"><input type="checkbox" checked={usedReplacement}
        onChange={(event) => setUsedReplacement(event.target.checked)} /> I used the replacement</label></div>}
    {habit.thresholds && <>
      <label>Amount ({habit.unit})<input type="number" inputMode={habit.trackingType === 'measurement' ? 'decimal' : 'numeric'} value={amount} onChange={(event) => setAmount(event.target.value)}
        min={habit.trackingType === 'measurement' ? 0.01 : 1} max={habit.trackingType === 'rating' ? 5 : 100000} step={habit.trackingType === 'measurement' ? 'any' : 1} required placeholder="0" /></label>
      <div className="level-choices">{Object.entries(habit.thresholds).map(([label, value]) =>
        <button type="button" className="secondary-button" key={label} aria-pressed={amountValue === value}
          onClick={() => setAmount(String(value))}>{label} <strong>{value}</strong></button>)}</div>
      {habit.trackingType === 'minutes' && <div className="minute-presets">{[30, 60].filter((value) => !Object.values(habit.thresholds!).includes(value)).map((value) =>
        <button type="button" className="text-button" key={value} onClick={() => setAmount(String(value))}>{value} min</button>)}</div>}
    </>}
    <label>Note <span className="muted">(optional)</span><textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} rows={2} /></label>
    <button className="primary-button" disabled={busy}><Check size={18} /> {submitLabel}</button>
    {habit.trackingType === 'avoid' && habit.slipCount && <fieldset className="slip-choices"><legend>Didn't avoid it? How many {habit.slipCount.unit}</legend>
      <div className="slip-count"><input type="number" inputMode="numeric" min={1} max={1000} value={slipAmount} aria-label={`How many ${habit.slipCount.unit}`}
        onChange={(event) => setSlipAmount(event.target.value)} placeholder="0" />
        <button type="button" className={`secondary-button slip-${validSlip ? slipSize(habit, slipValue) : 'normal'}`} disabled={busy || !validSlip}
          onClick={() => save({ ...entry('slipped', slipValue, slipSize(habit, slipValue)) })}>
          {validSlip ? `Save · ${{ little: 'a little', normal: 'normal amount', lot: 'a lot' }[slipSize(habit, slipValue)]}` : 'Enter a number'}</button></div>
      <p className="muted">Up to {habit.slipCount.little} is a little and still counts as a minimum. {habit.slipCount.lot} or more is a lot.</p>
    </fieldset>}
    {habit.trackingType === 'avoid' && !habit.slipCount && <fieldset className="slip-choices"><legend>Didn't avoid it? How much</legend>
      <p className="muted">A little still counts as a minimum. A normal amount or a lot is a miss.</p>
      <div>{([['little', 'A little'], ['normal', 'Normal amount'], ['lot', 'A lot']] as const).map(([slip, label]) =>
        <button type="button" key={slip} className={`secondary-button slip-${slip}`} disabled={busy}
          aria-pressed={log?.status === 'slipped' && (log.slip ?? 'normal') === slip} onClick={() => save(entry('slipped', 0, slip))}>{label}</button>)}</div>
    </fieldset>}
    <div className="log-options">
      {recovery && recovery.value === undefined && <button type="button" className="secondary-button" disabled={busy}
        onClick={() => save(entry('restart', 0))}>Log easier step</button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => save(entry('rest', 0))}>Planned rest</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => save(entry('skipped', 0))}>Skip today</button>
      {log && <button type="button" className="text-button" disabled={busy} onClick={() => save()}>Undo entry</button>}
      {edit && <button type="button" className="text-button" disabled={busy} onClick={edit}>Edit habit</button>}
    </div>
  </form>;
}

export function CategoryForm({ initial, categories, save, busy }: { initial: Category; categories: Category[]; save: (category: Category) => void; busy: boolean }) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);
  const [color, setColor] = useState(initial.color);
  const [parentId, setParentId] = useState(initial.parentId ?? '');
  const hasChildren = categories.some((category) => category.parentId === initial.id);
  return <form className="form-stack" onSubmit={(event) => {
    event.preventDefault();
    if (name.trim()) save({ ...initial, name: name.trim(), icon, color, parentId: parentId || undefined });
  }}>
    <label>Area name<input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>Icon<select value={icon} onChange={(event) => setIcon(event.target.value as Category['icon'])}>
      {icons.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
    </select></label>
    <label>Accent color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
    {!hasChildren && <label>Parent area (optional)<select value={parentId} onChange={(event) => setParentId(event.target.value)}>
      <option value="">Top-level area</option>
      {categories.filter((category) => category.id !== initial.id && !category.parentId).map((category) =>
        <option key={category.id} value={category.id}>{category.name}</option>)}
    </select></label>}
    <button className="primary-button" disabled={busy || !name.trim()}>Save area</button>
  </form>;
}
