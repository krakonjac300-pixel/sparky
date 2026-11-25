import { useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog } from './forms.tsx';
import type { AppData, Habit } from './model.ts';
import { defaultTurtleReviewHour } from './turtle-review.ts';
import type { Commit } from './expansion.tsx';

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
  const [step, setStep] = useState<'pick' | 'rule'>('pick');
  const [chosen, setChosen] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.habits.filter((habit) => habit.thresholds).map((habit) => [habit.id, habit.thresholds!.target])));
  const [saving, setSaving] = useState(false);
  const hour = `${data.budgetCoach?.reviewHour ?? defaultTurtleReviewHour}:00`;
  const toggle = (id: string) => setChosen((current) => current.includes(id) ? current.filter((item) => item !== id)
    : [...current, id]);
  const finish = async (ids: string[]) => {
    setSaving(true);
    if (await commit((current) => applyOnboarding(current, ids, targets), 'Your plan is set. Sparky is watching.')) { markOnboarded(); done(); }
    setSaving(false);
  };

  if (step === 'rule') return <Dialog title="How Sparky holds you to it" close={() => void finish(chosen)}>
    <div className="form-stack onboarding">
      <p>Every evening at {hour} Sparky checks your day.</p>
      <ul className="onboarding-rule">
        <li><strong>Everything done</strong>: proud, thumbs up.</li>
        <li><strong>70% or more</strong>: so-so.</li>
        <li><strong>Less than that</strong>: disappointed. He means it.</li>
      </ul>
      <p>Small wins count as one more item. Sparky's card shows tonight's exact bar.</p>
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
