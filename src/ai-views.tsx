import { useEffect, useState } from 'react';
import { friendlyError } from './friendly.ts';
import { AiText } from './ai-text-view.tsx';
import { Bot, Sparkles } from 'lucide-react';
import { androidRequest, onAndroid } from './android.ts';
import { askChatGpt, chatModels, optionalAiData, pickModel, rememberSummary, saveChatModel, summaryPrompt, type ChatModel } from './ai.ts';
import { Dialog } from './forms.tsx';
import { calendarDate, newId, type AppData } from './model.ts';
import type { Commit } from './expansion.tsx';

const failure = (cause: unknown, fallback: string) => friendlyError(cause, fallback);
const notConnected = 'Connect ChatGPT first: Life, then Coach, then Continue with ChatGPT.';

async function connected() {
  return (await androidRequest<{ authorized: boolean }>('chatStatus')).authorized;
}

/** Pick the ChatGPT model once; every question and summary uses it until you change it. */
export function ChatModelSetting() {
  const [models, setModels] = useState<ChatModel[]>();
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('Loading your models…');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (!(await connected())) { if (live) setMessage(notConnected); return; }
        const available = await chatModels();
        if (!live) return;
        setModels(available);
        setModel(pickModel(available));
        setMessage('');
      } catch (cause) { if (live) setMessage(failure(cause, 'Could not load your ChatGPT models.')); }
    })();
    return () => { live = false; };
  }, []);

  return <section className="panel settings-panel">
    <div className="small-panel-heading"><span className="small-icon"><Bot size={19} /></span>
      <div><h2>ChatGPT model</h2><p className="muted">For questions and summaries.</p></div></div>
    {models?.length ? <label>Model<select value={model} onChange={(event) => {
      setModel(event.target.value);
      saveChatModel(event.target.value);
    }}>{models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      : <p className="muted" role="status">{message}</p>}
  </section>;
}

const summaryDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

/** One tap: ChatGPT reviews the chosen period, remembers it, and builds on earlier reviews. */
export function AiSummary({ data, today, days, label, previousDays, currentDate, commit }: {
  data: AppData; today: string; days: number; label: string; previousDays: number; currentDate: string; commit: Commit;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<string>();
  if (!onAndroid()) return null;
  const saved = data.aiSummaries ?? [];
  const current = saved.find((entry) => entry.date === today && entry.days === days && entry.label === label);
  const past = saved.filter((entry) => entry !== current);

  async function summarize() {
    if (busy || !prompt?.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (!(await connected())) throw new Error(notConnected);
      const text = await askChatGpt([{ role: 'user', content: prompt }]);
      const entry = { id: current?.id ?? newId(), date: today, days, label, text: text.trim() || 'ChatGPT returned an empty answer.' };
      if (await commit((latest) => rememberSummary(latest, entry), 'Summary saved.')) setPrompt(undefined);
    } catch (cause) {
      setError(failure(cause, 'ChatGPT could not write the summary. Try again when you are online.'));
    }
    finally { setBusy(false); }
  }

  return <section className="panel settings-panel ai-summary">
    <div className="small-panel-heading"><span className="small-icon"><Sparkles size={19} /></span>
      <div><h2>AI summary</h2><p className="muted">How your {label.toLowerCase()} went, what to fix, which habits to add or drop.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {current && <AiText text={current.text} />}
    <button className="primary-button" disabled={busy} onClick={() => {
      setError(''); setPrompt(summaryPrompt(optionalAiData(data), today, days, label, previousDays, currentDate));
    }}>
      <Sparkles size={16} /> {busy ? 'Writing your summary…' : current ? 'Write it again' : `Summarize my ${label.toLowerCase()}`}
    </button>
    <p className="muted chat-privacy">Preview the report text before sending it to OpenAI.</p>
    {prompt !== undefined && <Dialog title="Review what goes to OpenAI" close={() => { if (!busy) setPrompt(undefined); }}>
      <div className="form-stack">
        <label>Report prompt<textarea rows={10} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={busy} /></label>
        <button className="primary-button" disabled={busy || !prompt.trim()} onClick={() => void summarize()}>{busy ? 'Writing your summary…' : 'Send report prompt'}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Dialog>}
    {past.length > 0 && <div className="past-summaries">
      <h3>Past summaries</h3>
      {past.map((entry) => <details key={entry.id}>
        <summary>{entry.label} review · {summaryDate.format(calendarDate(entry.date))}</summary>
        <AiText text={entry.text} compact />
      </details>)}
    </div>}
  </section>;
}
