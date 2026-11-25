import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, History, MessageCircle, Send } from 'lucide-react';
import { androidRequest } from './android.ts';
import { friendlyError } from './friendly.ts';
import { AiText } from './ai-text-view.tsx';
import { newId, type AppData } from './model.ts';
import type { Commit } from './expansion.tsx';
import { chatAtRisk, chatTitle, deleteChat, exportTranscript, maxChats, maxTurns, ownedChats, saveChatTurn, type SavedChat } from './chat-history.ts';
import { privateCoachCommit } from './coach-private.ts';
import { askChatGpt, chatContext, invalidateWeeklyChoice, optionalAiData, setModelOwner, weeklyAiRequest, type ChatMessage } from './ai.ts';

type Account = { authorized: boolean; owner?: string; registered: boolean; email: string; accounts: { id: string; email: string }[] };
type CoachProps = { data: AppData; today: string; commit: Commit; active: () => boolean };
type Turn = { question: string; answer: string };

const chatDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ChatGpt(props: CoachProps) {
  const [account, setAccount] = useState<Account>();
  const [connection, setConnection] = useState('');
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState('');
  const identity = useRef('');
  const generation = useRef(0);
  const statusVersion = useRef(0);
  const verifiedVersion = useRef(-1);
  const verification = useRef<Promise<void>>(undefined);
  const mounted = useRef(false);
  const changing = useRef(false);
  const applyAccount = useCallback((next?: Account) => {
    const owner = next?.authorized ? next.owner || '' : '';
    if (identity.current !== owner) generation.current++;
    identity.current = owner;
    setModelOwner(owner);
    setAccount(next);
  }, []);

  const refresh = useCallback(async () => {
    const version = ++statusVersion.current;
    setChecking(true);
    try {
      const next = await androidRequest<Account>('chatStatus');
      if (!mounted.current || version !== statusVersion.current) return;
      applyAccount(next);
      verifiedVersion.current = version;
      if (next.authorized && !next.owner) setMessage('Could not verify the active ChatGPT account. Reconnect to open your chats.');
    } catch (cause) {
      if (!mounted.current || version !== statusVersion.current) return;
      applyAccount();
      setMessage(friendlyError(cause, 'Could not check the ChatGPT connection.'));
    } finally {
      if (mounted.current && version === statusVersion.current) setChecking(false);
    }
  }, [applyAccount]);

  useLayoutEffect(() => {
    mounted.current = true;
    const resume = () => { if (!document.hidden && !changing.current) verification.current = refresh(); };
    resume();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('one-life-phone-activity', resume);
    return () => {
      mounted.current = false;
      statusVersion.current++;
      generation.current++;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('one-life-phone-activity', resume);
    };
  }, [refresh]);

  async function changeAccount(action: 'chatConnect' | 'chatSignOut', choice = '') {
    if (changing.current) return;
    changing.current = true;
    statusVersion.current++;
    applyAccount();
    setMessage('');
    setConnection(action === 'chatConnect' ? connectStages.browser : 'Signing out…');
    const progress = action === 'chatConnect' ? window.setInterval(() => {
      void androidRequest<string>('chatConnectStage', '', 5000).then((stage) => {
        const text = connectStages[stage as keyof typeof connectStages];
        if (mounted.current && changing.current && text) setConnection(text);
      }).catch(() => undefined);
    }, 1000) : undefined;
    try {
      const ok = await androidRequest<boolean>(action, choice, 360000);
      if (mounted.current && action === 'chatConnect') setMessage('');
      if (mounted.current && action === 'chatSignOut') setMessage(ok ? 'Signed out of Sparky.' : 'Signed out on this phone. Check ChatGPT settings to confirm remote revocation.');
    } catch (cause) {
      if (mounted.current) setMessage(friendlyError(cause, 'Could not change the ChatGPT connection.'));
    } finally {
      window.clearInterval(progress);
      if (mounted.current) {
        await refresh();
        changing.current = false;
        setConnection('');
      }
    }
  }

  const epoch = generation.current;
  const active = () => props.active() && mounted.current && generation.current === epoch && verifiedVersion.current === statusVersion.current;
  async function verified() {
    // A warm return may check the same account while its answer is arriving.
    let pending;
    do {
      pending = verification.current;
      await pending;
    } while (pending !== verification.current);
    return active();
  }
  return <>
    {message && <p role="status">{message}</p>}
    {checking && <p role="status">Checking the ChatGPT account…</p>}
    <div hidden={checking}><ChatSession key={epoch} {...props} commit={privateCoachCommit(props.commit, props.data.coachDataOwner, active)}
      active={active} verified={verified} account={account} connection={connection} changeAccount={changeAccount} /></div>
  </>;
}

/** What Coach says while each step of the ChatGPT sign-in runs (stages come from Android). */
export const connectStages = {
  browser: 'Sign in with OpenAI in your browser, then tap Open Sparky Coach. Sparky is waiting.',
  finishing: 'Finishing sign-in with OpenAI…',
  waiting: 'Almost done. Sparky finishes the sign-in as soon as it is open again.',
};

function ChatSession({ data, today, commit, active, verified, account, connection, changeAccount }: CoachProps & {
  verified: () => Promise<boolean>;
  account?: Account; connection: string; changeAccount: (action: 'chatConnect' | 'chatSignOut', choice?: string) => Promise<void>;
}) {
  const owner = account?.authorized ? account.owner || '' : '';
  const [chatId, setChatId] = useState<string>();
  const [showHistory, setShowHistory] = useState(false);
  const chats = data.chats ?? [];
  const savedChats = ownedChats(chats, owner);
  const atRisk = chatAtRisk(chats, chatId, owner);
  const temporary = !savedChats.length && chats.length >= maxChats;
  const [exportId, setExportId] = useState('');
  const exportTarget = savedChats.find((chat) => chat.id === exportId) ?? savedChats[0];
  const [question, setQuestion] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [reviewWeekly, setReviewWeekly] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [savedAccount, setSavedAccount] = useState('');
  const [working, setBusy] = useState('');
  const busy = connection || working;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const context = includeContext ? chatContext(optionalAiData(data), today) : '';

  useEffect(() => {
    if (!account?.authorized) return;
    let active = true;
    void androidRequest<boolean>('weeklyStatus').then((value) => { if (active) setWeekly(value === true); }).catch(() => undefined);
    return () => { active = false; };
  }, [account]);

  async function run(label: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setNotice('');
    setError('');
    try { await operation(); }
    catch (cause) { setError(friendlyError(cause, 'That did not work. Try again in a moment.')); }
    finally { setBusy(''); }
  }

  function exportChat(chat: SavedChat) {
    void run('Exporting chat...', async () => {
      if (!active()) return;
      const saved = await androidRequest<boolean>('exportChat', exportTranscript(chat, owner));
      setNotice(saved ? 'Chat exported.' : 'Export canceled.');
    });
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt) return;
    if (atRisk && !new FormData(event.currentTarget).has('allowTrim')) return;
    void run('Waiting for ChatGPT…', async () => {
      const history = turns.slice(-6);
      while (JSON.stringify(history).length > 60000 && history.length) history.shift();
      const messages: ChatMessage[] = history.flatMap((turn): ChatMessage[] => [
        { role: 'user', content: turn.question }, { role: 'assistant', content: turn.answer.slice(0, 12000) },
      ]);
      messages.push({ role: 'user', content: context ? `${context}\n\nMy question: ${prompt}` : prompt });
      const answer = await askChatGpt(messages, { owner, active });
      if (!await verified()) return;
      const id = chatId ?? newId();
      const saved = temporary || await commit((current) => {
        if (chatId && !ownedChats(current.chats ?? [], owner).some((chat) => chat.id === chatId)) {
          throw new Error('This chat was removed while waiting for the answer.');
        }
        const latestRisk = chatAtRisk(current.chats ?? [], id, owner);
        if (latestRisk && JSON.stringify(latestRisk) !== JSON.stringify(atRisk)) {
          throw new Error('Chat history changed while waiting for the answer. The answer was not saved. Review the updated history before sending again.');
        }
        return saveChatTurn(current, id, { question: prompt, answer, at: new Date().toISOString() }, owner);
      }, '');
      if (!await verified()) return;
      if (!saved) {
        setError('Your answer could not be saved. Your question is still here.');
        return;
      }
      if (!temporary) setChatId(id);
      setTurns((current) => [...current, { question: prompt, answer }]);
      setQuestion('');
      setIncludeContext(false);
    });
  }

  // Shown beside the buttons that caused it, so the result of a tap is always in view.
  const status = <>
    {busy && <p role="status" className="coach-status">{busy}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status" className="coach-status">{notice}</p>}
  </>;
  return <section className="panel settings-panel chatgpt-panel" aria-labelledby="chatgpt-heading">
    <div className="small-panel-heading"><span className="small-icon"><MessageCircle size={19} /></span>
      <div>
        <h2 id="chatgpt-heading">Ask ChatGPT</h2>
        <p className="muted">{owner
          ? `Using ChatGPT plan${account?.email ? ` · ${account.email}` : ''}`
          : 'Connect your ChatGPT plan for answers here.'}</p>
      </div>
    </div>
    {owner && status}
    <p className="muted">Sparky saves up to {maxChats} chats on this device and {maxTurns} question and answer pairs per chat. Sign in to reopen or export chats saved with your ChatGPT account. Full device backups include chats from all accounts and older chats without an owner.</p>
    {exportTarget && <div className="connection-actions">
      <p className="muted">Export chat saves a readable JSON file with just the selected conversation and its timestamps. Anyone with the file can read it.</p>
      <label>Chat to export<select value={exportTarget.id} onChange={(event) => setExportId(event.target.value)}>
        {savedChats.map((chat) => <option key={chat.id} value={chat.id}>{chatTitle(chat)}</option>)}
      </select></label>
      <button className="secondary-button" disabled={!!busy} onClick={() => exportChat(exportTarget)}>Export chat</button>
    </div>}
    {!owner ? <>
      <p className="muted">OpenAI asks you to sign in and allow plan usage in your browser. After that, ask questions and read answers in Sparky.</p>
      {(account?.accounts?.length ?? 0) > 1 && <label className="saved-chat-account">Saved ChatGPT account
        <select value={savedAccount} disabled={!!busy} onChange={(event) => setSavedAccount(event.target.value)}>
          <option value="">Most recent account</option>
          {account?.accounts.map((entry, index) => <option key={entry.id} value={entry.id}>{entry.email || 'ChatGPT account'} · {index + 1}</option>)}
        </select>
      </label>}
      <div className="connection-actions">
        <button className="primary-button" disabled={!!busy} onClick={() => void changeAccount('chatConnect', savedAccount)}>Continue with ChatGPT</button>
        <button className="secondary-button" disabled={!!busy} onClick={() => void run('Checking OpenAI…', async () => {
          await androidRequest('chatConnectionCheck');
          setNotice('Sparky reached OpenAI’s sign-in and ChatGPT services. You can sign in now.');
        })}>Test connection</button>
        {account?.registered && <button className="secondary-button" disabled={!!busy} onClick={() => void changeAccount('chatConnect', 'new')}>Use another account</button>}
      </div>
      {status}
    </> : <>
      <div className="connection-actions">
        <a href="https://chatgpt.com/settings/usage" className="text-button">Manage plan usage</a>
        <button className="text-button" disabled={!!busy} onClick={() => void changeAccount('chatSignOut')}>Sign out</button>
        {turns.length > 0 && <button className="text-button" disabled={!!busy} onClick={() => { setTurns([]); setChatId(undefined); setError(''); }}>New chat</button>}
        {savedChats.length > 0 && <button className="text-button" disabled={!!busy} aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
          <History size={15} /> Chat history ({savedChats.length})</button>}
      </div>
      <div className="connection-row">
        <h3>Weekly AI review</h3>
        <p className="muted">Optional Sunday review. OpenAI receives habit totals only. The request can run while the app is closed.</p>
        {weekly ? <button className="secondary-button" disabled={!!busy} onClick={() => void run('Turning off weekly reviews…', async () => {
          invalidateWeeklyChoice();
          await androidRequest('weeklyDisable'); setWeekly(false);
        })}>Turn off weekly AI reviews</button> : <button className="secondary-button" disabled={!!busy} onClick={() => setReviewWeekly(true)}>Review weekly AI sharing</button>}
        {reviewWeekly && !weekly && <div className="form-stack">
          <label>Example weekly prompt<textarea readOnly rows={4} value={JSON.parse(weeklyAiRequest(data, today)).prompt} /></label>
          <div className="connection-actions">
            <button className="primary-button" disabled={!!busy} onClick={() => void run('Enabling weekly reviews…', async () => {
              if (!active()) return;
              invalidateWeeklyChoice();
              await androidRequest('weeklyEnable', weeklyAiRequest(data, today)); setWeekly(true); setReviewWeekly(false);
            })}>Allow automatic weekly AI reviews</button>
            <button className="text-button" disabled={!!busy} onClick={() => setReviewWeekly(false)}>Cancel</button>
          </div>
        </div>}
      </div>
      {showHistory && <ul className="chat-history" aria-label="Chat history">{savedChats.map((chat) => <li key={chat.id}>
        <button type="button" disabled={!!busy} aria-current={chat.id === chatId || undefined} onClick={() => {
          setTurns(chat.turns.map(({ question, answer }) => ({ question, answer })));
          setChatId(chat.id);
          setShowHistory(false);
          setError('');
        }}><span><strong>{chatTitle(chat)}</strong>
          <small>{chatDate.format(new Date(chat.started))} · {chat.turns.length} {chat.turns.length === 1 ? 'answer' : 'answers'}</small></span>
          <ChevronRight size={16} aria-hidden="true" /></button>
      </li>)}</ul>}
      {turns.length > 0 && <ol className="chat-turns" aria-label="Conversation">{turns.map((turn, index) => <li key={index}>
        <p className="chat-question"><strong>You</strong><span>{turn.question}</span></p>
        <div className="chat-answer"><strong>ChatGPT</strong><AiText text={turn.answer} compact /></div>
      </li>)}</ol>}
      {chatId && turns.length > 0 && <button className="text-button danger-text chat-delete" disabled={!!busy} onClick={() => {
        const id = chatId;
        void commit((current) => deleteChat(current, id, owner), 'Chat deleted.').then((ok) => { if (ok && active()) { setTurns([]); setChatId(undefined); } });
      }}>Delete this chat</button>}
      <form className="form-stack chat-form" onSubmit={send}>
        {temporary && <p>Device chat history is full. This conversation is temporary and will close when you leave the session.</p>}
        <label>Question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000}
          rows={3} placeholder="What should I focus on this week?" disabled={!!busy} required /></label>
        {atRisk && <div key={JSON.stringify([chatId, atRisk.id, atRisk.turns[0].at, atRisk.turns.at(-1)?.at])}>
          <p>{atRisk.id === chatId ? 'Saving another answer will remove the oldest question and answer in this chat.'
            : `Saving a new chat will remove your least recently used chat, "${chatTitle(atRisk)}".`}</p>
          <button type="button" className="secondary-button" disabled={!!busy} onClick={() => exportChat(atRisk)}>Export before sending</button>
          <label className="check-label"><input type="checkbox" name="allowTrim" required disabled={!!busy} /> Allow removal when this answer is saved</label>
        </div>}
        <p className="muted chat-privacy">OpenAI receives your question and recent turns in this conversation.</p>
        <label className="check-label"><input type="checkbox" checked={includeContext} disabled={!!busy}
          onChange={(event) => setIncludeContext(event.target.checked)} /> Include an app context summary in this message</label>
        {includeContext && <label>App context sent to OpenAI<textarea value={context} readOnly rows={6} /></label>}
        <div className="connection-actions">
          <button className="primary-button" disabled={!!busy || !question.trim()}><Send size={16} /> Send</button>
          <button type="button" className="secondary-button" disabled={!!busy} onClick={() => {
            setQuestion('Summarize my week and suggest one practical adjustment for next week.');
          }}>Summarize my week</button>
        </div>
      </form>
      <p className="muted chat-privacy">Change the ChatGPT model in Settings.</p>
    </>}
  </section>;
}
