import { useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog } from './forms.tsx';
import type { AppData, Habit } from './model.ts';
import { defaultTurtleReviewHour } from './turtle-review.ts';
import type { Commit } from './expansion.tsx';
import { androidRequest, onAndroid } from './android.ts';

const seenKey = 'sparky-onboarding-done';
const starterIds = ['read', 'move', 'meditate', 'learn', 'gratitude', 'reach-out', 'project'];
const targetChoices = [5, 10, 15, 20, 30, 45, 60];

/** A brand-new install still holds exactly the untouched starter plan and nothing logged. */
export function needsOnboarding(data: AppData) {
  try { if (localStorage.getItem(seenKey)) return false; } catch { /* Fall back to the data check alone. */ }
  return data.logs.length === 0 && data.checkIns.length === 0 && (data.smallWins?.log.length ?? 0) === 0 &&
    data.habits.length === starterIds.length && data.habits.every((habit) => starterIds.includes(habit.id) && !habit.archivedAt);
}

/** Keeps only the chosen habits, with the chosen minute targets, as the plan from today. */
export function applyOnboarding(data: AppData, chosen: string[], targets: Record<string, number>): AppData {
  const keep = (habit: Habit): Habit => {
    const target = targets[habit.id];
    if (!habit.thresholds || !target) return habit;
    return { ...habit, thresholds: { minimum: Math.min(habit.thresholds.minimum, target), target, stretch: Math.max(habit.thresholds.stretch, target * 2) } };
  };
  const habits = data.habits.filter((habit) => chosen.includes(habit.id)).map(keep);
  return { ...data, habits, plans: habits.map((habit) => ({ date: data.planStart, habit })) };
}

export function markOnboarded() {
  try { localStorage.setItem(seenKey, '1'); } catch { /* Shown again only while the plan is still untouched. */ }
}

/** First run: choose any number of habits and their targets, then read the evening rule once. */
export function Onboarding({ data, commit, done }: { data: AppData; commit: Commit; done: () => void }) {
  const [step, setStep] = useState<'pick' | 'rule' | 'connect'>('pick');
  const [chosen, setChosen] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.habits.filter((habit) => habit.thresholds).map((habit) => [habit.id, habit.thresholds!.target])));
  const [saving, setSaving] = useState(false);
  const hour = `${data.budgetCoach?.reviewHour ?? defaultTurtleReviewHour}:00`;
  const toggle = (id: string) => setChosen((current) => current.includes(id) ? current.filter((item) => item !== id)
    : [...current, id]);
  const finish = async (ids: string[]) => {
    setSaving(true);
    if (await commit((current) => applyOnboarding(current, ids, targets), 'Your plan is set. Sparky is watching.')) {
      markOnboarded();
      // On the phone, offer every connection once so new users get the whole app from day one.
      if (onAndroid()) setStep('connect'); else done();
    }
    setSaving(false);
  };

  if (step === 'connect') return <ConnectSparky done={done} />;

  if (step === 'rule') return <Dialog title="How Sparky holds you to it" close={() => void finish(chosen)}>
    <div className="form-stack onboarding">
      <p>Every evening at {hour} Sparky checks your day.</p>
      <ul className="onboarding-rule">
        <li><strong>Everything done</strong>: proud, thumbs up.</li>
        <li><strong>70% or more</strong>: so-so.</li>
        <li><strong>Less than that</strong>: disappointed. He means it.</li>
      </ul>
      <p>Small wins count as one more item. Sparky's card shows tonight's exact bar.</p>
      <p>During the day Sparky learns when you usually finish each habit and reminds you a little before, if it is still open.</p>
      <p className="muted">Today counts too, even if you are starting late. A minimum or restart still counts as done. Sick? Pause scoring in Settings.</p>
      <button className="primary-button" disabled={saving} onClick={() => void finish(chosen)}>Start</button>
    </div>
  </Dialog>;

  return <Dialog title="Choose what Sparky holds you to" close={() => { markOnboarded(); done(); }}>
    <div className="form-stack onboarding">
      <p>Pick your habits, as many as you want. You can change them later.</p>
      <ul className="onboarding-habits">{data.habits.map((habit) => {
        const on = chosen.includes(habit.id);
        return <li key={habit.id}>
          <button type="button" className="onboarding-pick" aria-pressed={on} onClick={() => toggle(habit.id)}>
            <span className="onboarding-check" aria-hidden="true">{on && <Check size={16} />}</span>{habit.title}
          </button>
          {on && habit.thresholds && <label className="onboarding-target">Daily target
            <select value={targets[habit.id]} onChange={(event) => setTargets({ ...targets, [habit.id]: Number(event.target.value) })}>
              {targetChoices.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}</select></label>}
        </li>;
      })}</ul>
      <p className="muted" role="status">{chosen.length ? `${chosen.length} chosen` : 'Choose at least one to continue.'}</p>
      <button className="primary-button" disabled={!chosen.length} onClick={() => setStep('rule')}>Continue</button>
      <button className="text-button" onClick={() => { markOnboarded(); done(); }}>Keep all {data.habits.length} starter habits</button>
    </div>
  </Dialog>;
}

type ConnectState = 'idle' | 'busy' | 'on' | 'off';
const connections = [
  { id: 'notifications', title: 'Notifications', why: 'Reminders a little before your usual time, only while a habit is still open, and Sparky’s evening check.',
    run: () => androidRequest<boolean>('requestNotifications') },
  { id: 'usage', title: 'Screen time', why: 'Lets Sparky count your social media limit as one habit and show today’s time on the Today card.',
    run: () => androidRequest<boolean>('connectUsage') },
  { id: 'health', title: 'Health Connect', why: 'Shows your steps and sleep. On Samsung phones, also let Samsung Health share with Health Connect.',
    run: () => androidRequest<boolean>('connectHealth') },
  { id: 'chatgpt', title: 'ChatGPT (optional)', why: 'If you have a ChatGPT account, Coach can answer questions about your habits. No account? Just skip this.',
    run: () => androidRequest<boolean>('chatConnect', '', 300000) },
] as const;

/** Last first-run screen: ask for each connection once. Every one can be skipped and changed later in Settings. */
function ConnectSparky({ done }: { done: () => void }) {
  const [states, setStates] = useState<Record<string, ConnectState>>({});
  const [note, setNote] = useState('');
  const busy = Object.values(states).includes('busy');
  async function connect(item: typeof connections[number]) {
    setNote('');
    setStates((current) => ({ ...current, [item.id]: 'busy' }));
    if (item.id === 'chatgpt') setNote('Finish signing in to ChatGPT in your browser, then come back to Sparky.');
    let ok = false;
    try { ok = (await item.run()) !== false; } catch (error) { setNote(error instanceof Error ? error.message : 'That did not connect. You can try again in Settings.'); }
    setStates((current) => ({ ...current, [item.id]: ok ? 'on' : 'off' }));
    if (ok && item.id === 'chatgpt') setNote('');
  }
  return <Dialog title="Get the most out of Sparky" close={() => { if (!busy) done(); }}>
    <div className="form-stack onboarding">
      <p>Sparky works best with these. Allow what you like; you can change any of them later in Settings.</p>
      <ul className="onboarding-connect">{connections.map((item) => {
        const state = states[item.id] ?? 'idle';
        return <li key={item.id}>
          <div><strong>{item.title}</strong><p className="muted">{item.why}</p></div>
          {state === 'on' ? <span className="onboarding-connected"><Check size={16} /> Connected</span>
            : <button type="button" className="secondary-button" disabled={busy} onClick={() => void connect(item)}>
              {state === 'busy' ? 'Waiting…' : state === 'off' ? 'Try again' : item.id === 'chatgpt' ? 'Connect' : 'Allow'}</button>}
        </li>;
      })}</ul>
      {note && <p className="muted" role="status">{note}</p>}
      <p className="muted">Your records stay on this phone. Sparky has no server and no account. Only the Coach questions you choose to send go to OpenAI.</p>
      <button className="primary-button" disabled={busy} onClick={done}>{Object.values(states).some((state) => state === 'on') ? 'Done' : 'Skip for now'}</button>
    </div>
  </Dialog>;
}
