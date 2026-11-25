import { useState } from 'react';
import { askChatGpt } from './ai.ts';
import { AiText } from './ai-text-view.tsx';
import { onAndroid } from './android.ts';
import { friendlyError } from './friendly.ts';
import { Dialog } from './forms.tsx';

export function ProgramTips({ title, action }: { title: string; action: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const native = onAndroid();
  const prompt = [`My program is ${title}.`, `My current practice is: ${action}`,
    'Suggest an easy way to try it today, one smaller fallback, and a slightly harder option for when it feels comfortable. Give a concrete example and keep it brief.',
    question.trim() && `My question: ${question.trim()}`].filter(Boolean).join('\n');

  return <>
    <button type="button" className="secondary-button" onClick={() => {
      setQuestion(''); setAnswer(''); setError(''); setOpen(true);
    }}>Ask ChatGPT for tips</button>
    {open && <Dialog title="Ask ChatGPT for program tips" close={() => { if (!busy) setOpen(false); }}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        if (busy || !native) return;
        setError(''); setAnswer(''); setBusy(true);
        void askChatGpt([{ role: 'user', content: prompt }]).then(setAnswer)
          .catch((cause: unknown) => setError(friendlyError(cause, 'Could not get tips. Check your connection in Life, Coach, Ask ChatGPT.')))
          .finally(() => setBusy(false));
      }}>
        <p>{title} · {action}</p>
        <label>Your question (optional)<textarea rows={3} maxLength={1000} value={question} disabled={busy}
          onChange={(event) => setQuestion(event.target.value)} placeholder="What could I say if I feel awkward?" /></label>
        <p className="muted">The prompt includes this program’s name, current practice, and the question you type. Your journal stays private.</p>
        {native ? <button className="primary-button" disabled={busy}>{busy ? 'Asking ChatGPT…' : 'Send to ChatGPT'}</button> : <>
          <p className="muted">Use the connected coach in the Android app, or copy this prompt to ChatGPT.</p>
          <label>Prompt to copy<textarea rows={5} value={prompt} readOnly /></label>
        </>}
        {error && <p className="error" role="alert">{error}</p>}
        {answer && <div aria-live="polite"><AiText text={answer} compact /></div>}
      </form>
    </Dialog>}
  </>;
}
