import { useState } from 'react';
import { MessageCircle, Mic, Share2, Sparkles } from 'lucide-react';
import { androidRequest, onAndroid, shareText } from './android.ts';
import { coach, coachingSuggestion, dailyCoaching } from './coach.ts';
import type { Commit } from './expansion.tsx';
import { newId, savePlan, type AppData } from './model.ts';
import { makeReport } from './reports.ts';
import { ChatGpt } from './chatgpt.tsx';
import { privateCoachCommit } from './coach-private.ts';

export function Coach({ data, today, commit: save, active }: { data: AppData; today: string; commit: Commit; active: () => boolean }) {
  const commit = privateCoachCommit(save, data.coachDataOwner, active);
  const record = data.routines.find((entry) => entry.date === today);
  const [plan, setPlan] = useState(record?.plan ?? '');
  const [reflection, setReflection] = useState(record?.reflection ?? '');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [approve, setApprove] = useState(false);
  const suggestion = coachingSuggestion(data, today);
  const daily = dailyCoaching(data, today);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try { await action(); }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setNotice(error instanceof Error ? error.message : 'Could not complete the action.'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="expanded-stack">
      {onAndroid() && <ChatGpt data={data} today={today} commit={save} active={active} />}
      <section className="panel settings-panel">
        <div className="small-panel-heading"><span className="small-icon"><Sparkles size={20} /></span>
          <div><h2>Daily coaching</h2><p className="muted">Plan the day and reflect on what happened.</p></div></div>
        <p><strong>Recorded today</strong> · {daily.target} of {daily.due} scheduled targets reached. {daily.rested > 0 && `${daily.rested} planned rest.`} {daily.lowEnergy && 'Low energy check-in.'}</p>
        <p className="coach-guidance"><strong>Suggested next step</strong> · {daily.first
          ? daily.startSmall ? `Start small with ${daily.first.title}${daily.first.thresholds ? ` (${daily.first.thresholds.minimum} ${daily.first.unit})` : ''}.`
            : `Give ${daily.first.title} a time or a place.`
          : daily.rested > 0 ? 'Keep the rest you planned.' : 'Reflect on what helped today.'}
          {daily.goal && ` Your next dated goal is ${daily.goal.title}.`}</p>
        <details className="audit"><summary>Review the past seven days</summary>
          <p>{daily.week.rate === undefined ? 'There were no scheduled targets in this period.' : `${daily.week.hit} of ${daily.week.planned} scheduled targets reached (${daily.week.rate}%).`}</p>
          {daily.week.rate !== undefined && daily.previous.rate !== undefined && <p>The previous seven days were at {daily.previous.rate}%.</p>}
          {daily.difficult && <p>Consider a smaller first step for {daily.difficult.title}. You reached {daily.difficult.hit} of {daily.difficult.planned} targets.</p>}
        </details>
        <form className="form-stack" onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await commit((current) => ({
              ...current, routines: [...current.routines.filter((entry) => entry.date !== today), { date: today, plan: plan.trim(), reflection: reflection.trim() }],
            }), 'Daily coaching notes saved.');
          });
        }}>
          <label>Morning plan<textarea value={plan} onChange={(event) => setPlan(event.target.value)} rows={2} maxLength={2000} /></label>
          <label>Evening reflection<textarea value={reflection} onChange={(event) => setReflection(event.target.value)} rows={3} maxLength={2000} /></label>
          <div className="connection-actions">
            <button className="primary-button" disabled={busy}>Save notes</button>
            {onAndroid() && <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
              const words = await androidRequest<string>('voice');
              if (words) setReflection((value) => [value, words].filter(Boolean).join('\n').slice(0, 2000));
            })}><Mic size={16} /> Dictate reflection</button>}
          </div>
        </form>
      </section>
      <section className="panel settings-panel">
        <h2>Habit suggestions</h2>
        <p className="muted">Suggestions use rules based on the last seven days of entries saved in Sparky.</p>
        {suggestion ? <div className="connection-row">
          <h3>{suggestion.habit.title}</h3>
          <p>{suggestion.reason}</p>
          <p>Suggested target · {suggestion.target} {suggestion.habit.unit}</p>
          {approve ? <div className="connection-actions"><button className="primary-button" disabled={busy} onClick={() => void perform(async () => {
            const changed = await commit((current) => {
              const latest = coachingSuggestion(current, today);
              if (!latest || latest.habit.id !== suggestion.habit.id || latest.target !== suggestion.target || !latest.habit.thresholds) {
                throw new Error('The suggestion changed. Review it again.');
              }
              return savePlan({ ...current, audit: [...current.audit, { id: newId(), timestamp: new Date().toISOString(),
                detail: `${latest.habit.title} target changed from ${latest.habit.thresholds.target} to ${latest.target} ${latest.habit.unit}.`,
              }] }, { ...latest.habit, thresholds: { ...latest.habit.thresholds, target: latest.target } }, today);
            }, 'Suggested change approved.');
            if (changed) setApprove(false);
          })}>Approve target change</button><button className="secondary-button" onClick={() => setApprove(false)}>Cancel</button></div>
            : <button className="secondary-button" onClick={() => setApprove(true)}>Review change</button>}
        </div> : <p className="muted">A suggestion appears when your logged habits show a consistent pattern.</p>}
        {data.audit.length > 0 && <details className="audit"><summary>Approved changes</summary>
          <ul>{[...data.audit].reverse().map((entry) => <li key={entry.id}>{new Date(entry.timestamp).toLocaleDateString()} · {entry.detail}</li>)}</ul>
        </details>}
      </section>
      {!onAndroid() && <section className="panel settings-panel">
        <div className="small-panel-heading"><span className="small-icon"><MessageCircle size={19} /></span>
          <div><h2>ChatGPT</h2><p className="muted">Your ChatGPT subscription is {coach.status === 'not-connected' ? 'not connected' : 'connected'}.</p></div></div>
        <p className="muted">The installed Android app can connect your ChatGPT plan for in-app answers. In this browser, you can prepare an editable summary.</p>
        <div className="connection-actions">
          <button className="secondary-button" onClick={() => {
            const report = makeReport(data, today, 7);
            setDraft([
              'Act as my accountability coach. Ask what got in the way and suggest one practical next step.',
              `Over the last seven days, I logged ${report.actions} habit ${report.actions === 1 ? 'action' : 'actions'}.`,
              report.planned ? `I reached target on ${report.hit} of ${report.planned} scheduled habits with recorded schedules.` : '',
              report.checkIns.length ? `Average mood: ${report.mood?.toFixed(1)}/5. Average energy: ${report.energy?.toFixed(1)}/5 across ${report.checkIns.length} check-ins.` : '',
            ].filter(Boolean).join('\n'));
          }}>Prepare weekly summary</button>
          <a className="text-button" href="https://chatgpt.com/">Open ChatGPT</a>
        </div>
        {draft && <div className="form-stack">
          <label>Summary to share<textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={8000} rows={6} /></label>
          <div className="connection-actions">
            <button className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
              if (onAndroid()) await androidRequest('copy', draft);
              else if (navigator.clipboard) await navigator.clipboard.writeText(draft);
              else throw new Error('Select the summary and copy the text.');
              setNotice('Summary copied.');
            })}>Copy summary</button>
            {(onAndroid() || typeof navigator.share === 'function') && <button className="secondary-button" disabled={busy}
              onClick={() => void perform(() => shareText(draft))}><Share2 size={16} /> Share summary</button>}
          </div>
        </div>}
      </section>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </>;
}
