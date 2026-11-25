import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, CircleCheck, Compass, Settings2 } from 'lucide-react';
import { BreakList, Dialog, CategoryForm, HabitForm, LogForm } from './forms.tsx';
import { History, OfflineNotice, Settings, Today, type HistoryView, type TodayView } from './views.tsx';
import { browserNavigation, pushView, restoreView, watchDialogOpeners } from './dialog-history.ts';
import { Life, lifeSections, type LifeSection } from './expansion.tsx';
import { Coach } from './coach-view.tsx';
import { Connections } from './connections.tsx';
import { androidRequest, isAndroidAppPage, onAndroid, readAndroidBackup } from './android.ts';
import { LegalGate } from './legal.tsx';
import { Onboarding, needsOnboarding } from './onboarding.tsx';
import { habitUndo } from './habit-undo.ts';
import { reminderPlan, suggestedReminder, unfinishedToday } from './reminders.ts';
import { createBackupFile, downloadJson, fileChunks, readBackupFile } from './backup.ts';
import { BackupSettings, useDownloadsBackup } from './backup-settings.tsx';
import { availableHabits, localDate, logKey, newId, savePlan, shiftDate, starterData, writeLog, type AppData, type Category, type Habit, type LogEntry } from './model.ts';
import { applyPhoneCompletions, prioritiesFor, reaches, recoveryFor, weekDates, type PhoneCompletion } from './planning.ts';
import { PrioritiesForm, SessionsForm } from './planning-views.tsx';
import { updateData } from './storage.ts';
import { orderedPhoneScores } from './phone-score.ts';
import { startHabitTimer, stopHabitTimer, timerBaseSeconds } from './model.ts';
import { HabitTimer } from './habit-timer.tsx';
import { usePhoneSync } from './phone-sync.ts';
import { SparkyCheer } from './turtle-avatar.tsx';
import { budgetPlan, dailyTurtleReaction, eveningSummary, turtleHabitProgress } from './budget-coach.ts';
import { defaultTurtleReviewHour, useTurtleReview } from './turtle-review.ts';
import { invalidateWeeklyChoice, weeklyAiRequest, weeklySession } from './ai.ts';
import { importWeeklyReview } from './weekly-review.ts';
import { checkPhoneSilent, feedback, type FeedbackKind } from './feedback.ts';
import { DayCelebration } from './feedback-views.tsx';
import { useSwipe } from './swipe.tsx';
import { FocusMode } from './focus-mode.tsx';
import { FocusSessions } from './focus-sessions.tsx';
import { streakInfo, streakMilestones } from './streak.ts';
import { StreakChip, StreakMilestone } from './streak-view.tsx';
import './styles.css';
import './daybook.css';
import { Segments } from './swipe.tsx';
import { tick } from './feedback.ts';

const tabs = [
  ['Today', CircleCheck], ['History', CalendarDays], ['Life', Compass], ['Settings', Settings2],
] as const;
type Tab = typeof tabs[number][0] | 'Phone';
type NavigationEntry = { tab: Tab; life: LifeSection; today: TodayView; history: HistoryView };
/** Settings and phone connections share one tab, split by a switcher. */
const settingsViews = ['General', 'Phone'] as const;
type SaveNotice = { message: string; habitTitle?: string; comeback?: boolean; feel?: FeedbackKind; undo?: (current: AppData) => AppData };
type Modal =
  | { type: 'habit'; habit?: Habit; breakTitle?: string }
  | { type: 'breakList' }
  | { type: 'log'; habit: Habit; date: string }
  | { type: 'priorities'; date: string }
  | { type: 'sessions'; habit: Habit; date: string }
  | { type: 'category'; category: Category }
  | { type: 'reset' }
  | { type: 'import'; backup: AppData };

function phoneScore(data: AppData, date: string, streak = streakInfo(data, date)) {
  return { ...eveningSummary(data, date), streak: streak.streak, streakToday: streak.todayCounts };
}

const publishPhoneScore = orderedPhoneScores(async () => {
  const current = await updateData();
  return phoneScore(current, localDate());
}, async (summary, ids) => {
  if (ids) await androidRequest('ackPhoneHabitActions', JSON.stringify({ ids, summary }));
  else await androidRequest('syncEvening', JSON.stringify(summary));
});

function App() {
  const [data, setData] = useState<AppData>();
  const [onboardingClosed, setOnboardingClosed] = useState(false);
  const [tab, setTab] = useState<Tab>('Today');
  const [sheets, setSheets] = useState<Modal[]>([]);
  const modal = sheets.at(-1);
  function setModal(next?: Modal) {
    setSheets(previous => next ? (browserNavigation() ? [...previous, next] : [next]) : []);
  }
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<SaveNotice>();
  const [celebrating, setCelebrating] = useState(false);
  const [focusHidden, setFocusHidden] = useState<string>();
  const [milestone, setMilestone] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(localDate());
  const [lifeSection, setLifeSection] = useState<LifeSection>('Goals');
  const [programJump, setProgramJump] = useState<string>();
  useEffect(() => {
    if (tab !== 'Life' || lifeSection !== 'Programs' || !programJump) return;
    const card = document.getElementById(`program-${programJump}`);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'start' });
    setProgramJump(undefined);
  }, [tab, lifeSection, programJump]);
  const [openBudget, setOpenBudget] = useState(false);
  const [todayView, setTodayView] = useState<TodayView>('Habits');
  const [historyView, setHistoryView] = useState<HistoryView>('Daily');
  const firstNavigation = useRef(true);
  useEffect(() => {
    if (!browserNavigation()) return;
    const entry: NavigationEntry = {
      tab, life: tab === 'Life' ? lifeSection : 'Goals',
      today: tab === 'Today' ? todayView : 'Habits', history: tab === 'History' ? historyView : 'Daily',
    };
    const previous: NavigationEntry | undefined = history.state?.daybookView;
    if (firstNavigation.current) {
      firstNavigation.current = false;
      history.replaceState({ daybookView: entry, daybookStep: history.state?.daybookStep ?? 0 }, '');
    } else if (previous?.tab !== entry.tab || previous.life !== entry.life || previous.today !== entry.today || previous.history !== entry.history) {
      pushView({ daybookView: entry });
    }
  }, [tab, lifeSection, todayView, historyView]);
  useEffect(() => {
    if (!browserNavigation()) return;
    const restore = (event: PopStateEvent) => {
      const entry: NavigationEntry | undefined = event.state?.daybookView;
      if (!entry) return;
      restoreView(event.state, () => {
        setTab(entry.tab);
        // Entries saved before Goals and Timeline merged may still say Timeline.
        setLifeSection(lifeSections.includes(entry.life) ? entry.life : 'Goals');
        setTodayView(entry.today ?? 'Habits');
        setHistoryView(entry.history ?? 'Daily');
        setError('');
      });
    };
    window.addEventListener('popstate', restore);
    const unwatch = watchDialogOpeners();
    return () => { window.removeEventListener('popstate', restore); unwatch(); };
  }, []);
  const [online, setOnline] = useState(navigator.onLine);
  const backupControl = useDownloadsBackup(data, today);
  const [removeCopies, setRemoveCopies] = useState(false);
  const [coachScope, setCoachScope] = useState(() => new AbortController());
  const [replacingCoach, setReplacingCoach] = useState(false);
  const saving = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const theme = data?.settings.theme ?? 'light';
  const phoneSync = usePhoneSync(setData, today);
  const reviewing = useTurtleReview(today, data?.budgetCoach?.reviewHour ?? defaultTurtleReviewHour);
  const reviewRefresh = useRef('');
  const hasData = Boolean(data);
  const nativeBudget = data ? JSON.stringify(budgetPlan(data, today)) : undefined;

  useEffect(() => {
    if (!reviewing || !hasData || !onAndroid()) return;
    const refresh = () => {
      if (document.hidden || reviewRefresh.current === today) return;
      reviewRefresh.current = today;
      void phoneSync.refresh(true);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [reviewing, hasData, today, phoneSync.refresh]);

  useEffect(() => {
    if (!onAndroid() || nativeBudget === undefined) return;
    let active = true;
    void androidRequest('syncBudgetPlan', nativeBudget).catch(() => {
      if (active) setError('Android could not update the app budget widget or heads-up. Reopen Sparky to retry.');
    });
    return () => { active = false; };
  }, [nativeBudget]);

  // Past the first or last section of a tab, a swipe moves to the neighbouring tab.
  useSwipe((direction) => {
    const next = tabs[tabs.findIndex(([name]) => name === (tab === 'Phone' ? 'Settings' : tab)) + direction];
    if (!next || modal || !data) return false;
    navigate(next[0]);
    window.scrollTo({ top: 0 });
    return true;
  }, 0);

  const streak = useMemo(() => data ? streakInfo(data, today) : undefined, [data, today]);
  // Widgets read this summary: today's score, what is still open, and the streak.
  const nativeEvening = data && streak ? JSON.stringify(phoneScore(data, today, streak)) : undefined;
  // The day a milestone is reached, celebrate it once.
  useEffect(() => {
    if (!streak?.todayCounts || !(streakMilestones as readonly number[]).includes(streak.streak)) return;
    const key = `${today}:${streak.streak}`;
    let seen = '';
    try { seen = localStorage.getItem('one-life-streak-celebrated') ?? ''; } catch { /* Celebrate anyway. */ }
    if (seen === key) return;
    try { localStorage.setItem('one-life-streak-celebrated', key); } catch { /* Shown again next launch at worst. */ }
    const timer = window.setTimeout(() => { setMilestone(streak.streak); feedback('allDone'); }, 1800);
    return () => window.clearTimeout(timer);
  }, [streak?.todayCounts, streak?.streak, today]);

  // The small timer on Today can bring the full-screen focus back.
  useEffect(() => {
    const open = () => setFocusHidden(undefined);
    window.addEventListener('one-life-focus', open);
    return () => window.removeEventListener('one-life-focus', open);
  }, []);

  // A small win can finish the day too; it asks for the celebration through this event.
  useEffect(() => {
    const celebrate = () => setCelebrating(true);
    window.addEventListener('one-life-all-done', celebrate);
    return () => window.removeEventListener('one-life-all-done', celebrate);
  }, []);

  // Sounds follow the phone's ringer: checked on open and whenever the app comes back.
  useEffect(() => {
    void checkPhoneSilent();
    const onShow = () => { if (!document.hidden) void checkPhoneSilent(); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  useEffect(() => {
    if (!onAndroid() || !data) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const session = weeklySession();
      void androidRequest<string>('weeklyGrant').then((grant) => {
        if (live && !coachScope.signal.aborted && session.active() && typeof grant === 'string' && grant.startsWith(session.owner + '.')) {
          return androidRequest('syncWeekly', weeklyAiRequest(data, today, grant));
        }
      }).catch(() => undefined);
    }, 3000);
    return () => { live = false; window.clearTimeout(timer); };
  }, [data, today, coachScope]);

  // Import a completed review from Android's on-device storage.
  const importWeekly = useRef<() => void>(() => undefined);
  importWeekly.current = () => {
    if (!onAndroid() || !data) return;
    void importWeeklyReview(data.coachDataOwner, save, () => !coachScope.signal.aborted)
      .catch(() => { /* Retried on resume. */ });
  };
  useEffect(() => {
    importWeekly.current();
    const onShow = () => { if (!document.hidden) importWeekly.current(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('daybook-coach-account', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('daybook-coach-account', onShow);
    };
  }, [hasData]);

  useEffect(() => {
    if (!onAndroid() || nativeEvening === undefined) return;
    void publishPhoneScore().catch(() => { /* Retried on the next change; the in-app check still works. */ });
  }, [nativeEvening]);

  useEffect(() => {
    if (tab !== 'Today' || !openBudget || !data) return;
    const budget = document.getElementById('budget-coach');
    budget?.focus({ preventScroll: true });
    budget?.scrollIntoView();
    setOpenBudget(false);
  }, [tab, openBudget, data]);

  useEffect(() => {
    let active = true;
    let receiving = false;
    async function syncPhone() {
      if (!onAndroid() || receiving || saving.current) return;
      receiving = true;
      try {
        const actions = await androidRequest<{ completed?: PhoneCompletion[]; open?: { habitId: string; date: string; section?: string } } | null>('phoneHabitActions');
        const completed = Array.isArray(actions?.completed) ? actions.completed : [];
        if (!active || (!completed.length && !actions?.open)) return;
        const snapshot = await updateData(completed.length ? (current) => applyPhoneCompletions(current, completed) : undefined);
        if (!active) return;
        setData(snapshot);
        if (completed.length) {
          await androidRequest('syncHabitReminders', JSON.stringify(reminderPlan(snapshot, localDate())));
          await publishPhoneScore(completed.map(({ id }) => id));
        }
        if (actions?.open && active && [localDate(), shiftDate(localDate(), -1)].includes(actions.open.date)) {
          const habit = availableHabits(snapshot, actions.open.date).find(({ id }) => id === actions.open?.habitId);
          if (actions.open.section === 'coach') {
            setLifeSection('Coach');
            setTab('Life');
            setModal(undefined);
            return;
          }
          setTab('Today');
          setModal(habit ? { type: 'log', habit, date: actions.open.date } : undefined);
          if (actions.open.section === 'budget') setOpenBudget(true);
        }
      } catch {
        if (active) setError('Could not load an Android habit action. Sparky will try again.');
      } finally { receiving = false; }
    }
    function refresh() {
      updateData().then((snapshot) => {
        if (!active) return;
        setData(snapshot);
        if (onAndroid()) void androidRequest('syncHabitReminders', JSON.stringify(reminderPlan(snapshot, localDate()))).catch(() => {
          if (active) setError('Your habits loaded. Android reminders could not be synchronized.');
        });
        void syncPhone();
      }).catch(() => {
        if (active) setError('Could not open local storage. Use a regular browser window and try again.');
      });
    }
    const sync = typeof BroadcastChannel === 'function' ? new BroadcastChannel('one-life') : null;
    channel.current = sync;
    if (sync) sync.onmessage = refresh;
    function updateEnvironment() {
      setToday(localDate());
      setOnline(navigator.onLine);
      void syncPhone();
    }
    refresh();
    const timer = window.setInterval(updateEnvironment, 15000);
    window.addEventListener('focus', updateEnvironment);
    window.addEventListener('online', updateEnvironment);
    window.addEventListener('offline', updateEnvironment);
    window.addEventListener('one-life-phone-action', updateEnvironment);
    return () => {
      active = false;
      channel.current = null;
      sync?.close();
      window.clearInterval(timer);
      window.removeEventListener('focus', updateEnvironment);
      window.removeEventListener('online', updateEnvironment);
      window.removeEventListener('offline', updateEnvironment);
      window.removeEventListener('one-life-phone-action', updateEnvironment);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  }, [theme]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(undefined), success.undo ? 5000 : 2800);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function save(update: (current: AppData) => AppData, message: string | SaveNotice | ((before: AppData, after: AppData) => SaveNotice), close = false) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setSuccess(undefined);
    setError('');
    try {
      let notice: SaveNotice | undefined;
      const next = await updateData((current) => {
        const updated = update(current);
        notice = typeof message === 'string' ? { message } : typeof message === 'function' ? message(current, updated) : message;
        return updated;
      });
      setData(next);
      if (close) setModal(undefined);
      setSuccess(notice?.message ? notice : undefined);
      if (notice?.feel) {
        feedback(notice.feel);
        if (notice.feel === 'allDone') setCelebrating(true);
      }
      if (onAndroid()) {
        try { await androidRequest('syncHabitReminders', JSON.stringify(reminderPlan(next, localDate()))); }
        catch { setError('Your changes were saved. Android reminders could not be synchronized.'); }
      }
      channel.current?.postMessage('changed');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your changes. Please try again.');
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function timeHabit(habit: Habit, started?: string, close = false) {
    if (!started) {
      setFocusHidden(undefined);
      void save((current) => startHabitTimer(current, habit.id), `${habit.title} focus started.`, close);
      return;
    }
    void save((current) => stopHabitTimer(current, habit.id, started), (before, after) => {
      const timer = before.habitTimers?.find((item) => item.habit.id === habit.id && item.started === started);
      if (!timer) return { message: 'This session was already saved.' };
      const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(started)) / 1000));
      const saved = after.logs.find((entry) => entry.habitId === habit.id && entry.date === timer.date);
      if (!saved) return { message: `${seconds} sec kept. They add to your next ${habit.title} session today.` };
      return { message: `${habit.title} · ${Math.floor(seconds / 60)} min ${seconds % 60} sec saved. Day total: ${saved.value} min.`, feel: 'done' };
    }, close);
  }

  function recordHabit(habit: Habit, date: string, entry?: LogEntry, close = false) {
    const id = logKey(habit.id, date);
    void save((current) => writeLog(current, habit.id, date, entry), (before, after): SaveNotice => {
      const previous = before.logs.find((log) => log.id === id);
      const undo = habitUndo(before, after, habit.id, date);
      if (!entry) return { message: close ? 'Entry removed.' : 'Completion undone.', feel: 'undo', undo };
      const next = date === today ? unfinishedToday(after, today).filter((item) => item.trackingType !== 'avoid' && item.id !== habit.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)[0] : undefined;
      const then = next ? ` · Next: ${next.title}` : '';
      const recorded = after.logs.find((log) => log.id === id);
      const latest = after.habits.find((item) => item.id === habit.id) ?? habit;
      const finished = (state: AppData) => {
        const { done, total } = turtleHabitProgress(state, today);
        return total > 0 && done >= total;
      };
      const feel: FeedbackKind = date === today && finished(after) && !finished(before) ? 'allDone' : 'done';
      if (date === today && dailyTurtleReaction(after, today).comeback && !dailyTurtleReaction(before, today).comeback) {
        return { message: 'Sparky noticed your comeback.', habitTitle: latest.title, comeback: true, feel, undo };
      }
      if (reaches(latest, recorded, false) && !reaches(latest, previous, false)) {
        const message = latest.thresholds ? `${entry.value} ${latest.unit} · Target reached`
          : latest.trackingType === 'avoid' ? 'Avoided' : 'Completed';
        return { message: message + then, habitTitle: latest.title, feel, undo };
      }
      if (entry.restart || entry.status === 'restart') return { message: 'Easier step logged.', undo };
      return { message: 'Habit updated.', undo };
    }, close);
  }

  const settingsSwitch = <Segments label="Settings view" options={settingsViews} value={tab === 'Phone' ? 'Phone' : 'General'}
    onChange={(view) => navigate(view === 'Phone' ? 'Phone' : 'Settings')} />;

  function navigate(next: Tab, phoneActivity = false) {
    if (next === 'Life') setLifeSection('Goals');
    setTab(next);
    if (tab !== 'Today') setTodayView('Habits');
    if (tab !== 'History' || phoneActivity) setHistoryView(phoneActivity ? 'Phone activity' : 'Daily');
    setError('');
    window.scrollTo(0, 0);
  }

  async function exportData() {
    if (!data) return;
    try {
      const content = createBackupFile(data);
      if (onAndroid()) {
        if (await androidRequest<boolean>('export', content)) setSuccess({ message: 'Backup exported and verified.' });
      } else {
        downloadJson(content, `one-life-${today}.json`);
        setSuccess({ message: 'Backup download requested. Check your downloads for the file.' });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export the backup.');
    }
  }

  async function importData(file?: File) {
    setError('');
    try {
      const backup = file ? await readBackupFile(fileChunks(file), file.size) : await readAndroidBackup();
      if (!backup) return;
      setModal({ type: 'import', backup });
    } catch (error) {
      setError(error instanceof Error && error.message === 'This backup is too large.' ? error.message : 'This file is not a valid Sparky backup. Your records are unchanged.');
    }
  }

  async function saveHabit(habit: Habit) {
    let message = 'Habit saved.';
    if (onAndroid() && (habit.learnedLead || habit.reminderTime || habit.extraReminderTime || habit.replacement?.time)) {
      try {
        if (!(await androidRequest<boolean>('requestNotifications'))) message = 'Habit saved. Allow Sparky notifications to receive reminders.';
      } catch { message = 'Habit saved. Allow Sparky notifications to receive reminders.'; }
    }
    await save((current) => {
      const previous = current.habits.find(({ id }) => id === habit.id);
      if (previous?.archivedAt) throw new Error('This habit was removed in another tab.');
      return savePlan(current, previous ? habit : { ...habit, sortOrder: Math.max(-1, ...current.habits.map((item) => item.sortOrder)) + 1 }, localDate());
    }, message, true);
  }

  function archiveHabit(habit: Habit) {
    void save((current) => {
      const latest = current.habits.find((item) => item.id === habit.id);
      if (!latest) throw new Error('This habit is no longer available.');
      return savePlan(current, { ...latest, archivedAt: new Date().toISOString() }, localDate());
    }, 'Habit removed from your plan.', true);
  }

  const add = () => setModal({ type: 'habit' });
  const close = () => { if (!saving.current) { setSheets(previous => previous.slice(0, -1)); setError(''); } };
  const modalTitle = (modal: Modal) => modal.type === 'breakList' ? 'Break List'
    : modal?.type === 'priorities' ? 'Today’s priorities' : modal?.type === 'sessions' ? 'Plan weekly sessions'
    : modal?.type === 'habit' ? (modal.habit ? 'Edit habit' : modal.breakTitle !== undefined ? 'Add to Break List' : 'Add a habit')
    : modal?.type === 'log' ? modal.habit.title : modal?.type === 'category' ? 'Edit life area'
      : modal?.type === 'reset' ? 'Reset all data?' : 'Replace your current records?';

  return <div className="app-shell">
    {data && !onboardingClosed && needsOnboarding(data) && <Onboarding data={data} commit={save} done={() => setOnboardingClosed(true)} />}
    <a className="skip-link" href="#main" onClick={event => {
      if (!browserNavigation()) return;
      event.preventDefault();
      document.getElementById('main')?.focus();
    }}>Skip to content</a>
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="brand" onClick={() => navigate('Today')} aria-label="Sparky home">
          <img src="/icon-192.png" alt="" width="30" height="30" /><span className="brand-name">Sparky</span>
        </button>
        {streak && <StreakChip info={streak} />}
        {data && <button type="button" className="turtle-shortcut" onClick={() => {
          navigate('Today');
          setOpenBudget(true);
        }}><span className="turtle-shortcut-art" aria-hidden="true" />Sparky</button>}
      </div>
    </header>
    {!online && <OfflineNotice />}
    <main id="main" tabIndex={-1}>
      {error && !modal && <div className="error banner" role="alert"><span>{error}</span>
        <button type="button" className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
      {!data && !error && <p className="muted" role="status">Opening your plan…</p>}
      {data && <>
        {tab === 'Today' && <Today view={todayView} setView={setTodayView} data={data} date={today} busy={busy} add={add} addBreak={() => setModal({ type: 'breakList' })} openSettings={() => navigate('Settings')}
          commit={save} openGoals={() => navigate('Life')} reviewing={reviewing} sync={phoneSync} timeHabit={timeHabit}
          openActivity={() => navigate('History', true)}
          openFocus={() => { navigate('Life'); setLifeSection('Focus'); }}
          openProgram={(id) => { navigate('Life'); setLifeSection('Programs'); setProgramJump(id); }}
          priorities={() => setModal({ type: 'priorities', date: today })}
          configure={(habit) => setModal({ type: 'habit', habit })}
          sessions={(habit) => setModal({ type: 'sessions', habit, date: today })}
          consequence={(habit, date) => void save((current) => ({
            ...current, consequenceChecks: [...(current.consequenceChecks ?? []).filter((entry) => entry.habitId !== habit.id || entry.date !== date),
              { habitId: habit.id, date }],
          }), 'Consequence recorded.')}
          log={(habit) => setModal({ type: 'log', habit, date: today })}
          toggle={(habit, log) => recordHabit(habit, today, log?.status === 'done' ? undefined : { status: 'done', value: 1 })}
          checkIn={(entry) => void save((current) => ({ ...current, checkIns: [...current.checkIns.filter((item) => item.date !== entry.date), entry] }), 'Check-in saved.')} />}
        {tab === 'History' && <History view={historyView} setView={setHistoryView} data={data} today={today} sync={phoneSync} commit={save} openConnections={() => navigate('Phone')} />}
        {tab === 'Life' && <Life section={lifeSection} setSection={setLifeSection} data={data} today={today} commit={save} lastUsageSync={phoneSync.status?.screen?.updated} />}
        <div hidden={tab !== 'Life' || lifeSection !== 'Focus'}><FocusSessions data={data} today={today} commit={save} visible={tab === 'Life' && lifeSection === 'Focus'} /></div>
        {!replacingCoach && ((tab === 'Life' && lifeSection === 'Coach') || onAndroid()) && <div hidden={tab !== 'Life' || lifeSection !== 'Coach'}>
          <Coach key={JSON.stringify([today, data.coachDataOwner])} data={data} today={today}
            active={() => !coachScope.signal.aborted} commit={save} />
        </div>}
        {tab === 'Phone' && <Connections data={data} commit={save} sync={phoneSync} switcher={settingsSwitch} />}
        {tab === 'Settings' && <Settings backupSettings={<BackupSettings control={backupControl} />} data={data} today={today} commit={save} busy={busy} add={add} switcher={settingsSwitch}
          theme={(theme) => void save((current) => ({ ...current, settings: { ...current.settings, theme } }), 'Theme saved.')}
          editCategory={(category) => setModal({ type: 'category', category })} editHabit={(habit) => setModal({ type: 'habit', habit })}
          addCategory={() => setModal({ type: 'category', category: { id: newId(), name: '', icon: 'compass', color: '#74a987', sortOrder: Math.max(-1, ...data.categories.map(({ sortOrder }) => sortOrder)) + 1 } })}
          restoreHabit={(habit) => void save((current) => {
            const latest = current.habits.find((item) => item.id === habit.id);
            return latest?.archivedAt ? savePlan(current, { ...latest, archivedAt: undefined }, localDate()) : current;
          }, 'Habit restored.')}
          exportData={() => void exportData()} importData={(file) => void importData(file)} reset={() => { setRemoveCopies(false); setModal({ type: 'reset' }); }} />}
      </>}
    </main>
    <nav className="navigation" aria-label="Main navigation">
      <div>{tabs.map(([name, Icon]) => <button key={name} type="button" aria-current={tab === name || (name === 'Settings' && tab === 'Phone') ? 'page' : undefined}
        onClick={() => { if (tab !== name) tick(); navigate(name); }}>
        <span className="navigation-icon"><Icon size={21} strokeWidth={tab === name ? 2.2 : 1.7} aria-hidden="true" /></span><span>{name}</span>
      </button>)}</div>
    </nav>
    <div className={`toast${success ? ' visible' : ''}${success?.habitTitle ? ' completion-toast' : ''}`} role="status" aria-atomic="true">
      {success?.habitTitle ? <>
        <SparkyCheer welcome={!!success.comeback} />
        <svg className="completion-mark" width="42" height="42" viewBox="0 0 44 44" aria-hidden="true">
          <circle className="completion-track" cx="22" cy="22" r="17.5" />
          <circle className="completion-ring" cx="22" cy="22" r="17.5" pathLength="1" transform="rotate(-90 22 22)" />
          <path className="completion-check" d="M 14.5 22.5 L 19.5 27.5 L 30 17" pathLength="1" />
        </svg>
        <span className="completion-copy"><strong>{success.habitTitle}</strong><span>{success.message}</span></span>
      </> : success?.message}
      {success?.undo && <button type="button" className="toast-undo" disabled={busy} onClick={() => {
        const undo = success.undo!;
        void save((current) => undo(current), { message: 'Undone.', feel: 'undo' });
      }}>Undo</button>}
    </div>
    {data && !modal && (() => {
      const focus = data.habitTimers?.[0];
      return focus && focusHidden !== focus.started && <FocusMode key={focus.started} title={focus.habit.title} started={focus.started}
        goal={focus.habit.thresholds} alreadySeconds={timerBaseSeconds(data, focus.habit.id, focus.date)} busy={busy}
        stop={() => timeHabit(focus.habit, focus.started)} minimize={() => setFocusHidden(focus.started)} />;
    })()}
    {celebrating && <DayCelebration done={() => setCelebrating(false)} />}
    {!celebrating && milestone && <StreakMilestone days={milestone} done={() => setMilestone(undefined)} />}
    {data && sheets.map((modal, depth) => <Dialog key={depth} title={modalTitle(modal)} close={() => { if (!coachScope.signal.aborted) close(); }}
      restore={modal.type === 'import' ? () => { if (!coachScope.signal.aborted) setModal(modal); } : undefined}
      confirmation={modal.type === 'reset' || modal.type === 'import'}>
      {error && <p className="error" role="alert">{error}</p>}
      {modal.type === 'log' && modal.date !== today && <p className="muted">Log for {modal.date}</p>}
      {modal.type === 'breakList' && <BreakList existing={data.habits} choose={(breakTitle) => setModal({ type: 'habit', breakTitle })} />}
      {modal.type === 'habit' && <HabitForm initial={modal.habit} breakTitle={modal.breakTitle} categories={data.categories} habits={data.habits}
        reminderControls={data.reminderControls} suggestedTime={modal.habit && suggestedReminder(data, modal.habit.id, today)} busy={busy} save={saveHabit} archive={archiveHabit} />}
      {modal.type === 'priorities' && <PrioritiesForm data={data} today={modal.date} busy={busy} save={(items) => void save((current) => ({
        ...current, priorities: [...(current.priorities ?? []).filter((day) => day.date !== modal.date), { date: modal.date, items }],
      }), 'Priorities saved.', true)} />}
      {modal.type === 'sessions' && <SessionsForm data={data} habit={modal.habit} today={modal.date} busy={busy} save={(dates) => {
        const editable = new Set(weekDates(modal.date).filter((date) => date >= modal.date));
        void save((current) => ({
          ...current, weeklySessions: [...(current.weeklySessions ?? []).filter((entry) => entry.habitId !== modal.habit.id || !editable.has(entry.date)),
            ...dates.filter((date) => editable.has(date)).map((date) => ({ habitId: modal.habit.id, date }))],
        }), 'Sessions saved.', true);
      }} />}
      {modal.type === 'log' && <LogForm habit={modal.habit} busy={busy} edit={() => setModal({ type: 'habit', habit: modal.habit })}
        timer={modal.habit.trackingType === 'minutes' && modal.date === today && <HabitTimer busy={busy}
          goal={modal.habit.thresholds} alreadySeconds={timerBaseSeconds(data, modal.habit.id, modal.date)}
          started={data.habitTimers?.find((item) => item.habit.id === modal.habit.id)?.started}
          onPress={() => timeHabit(modal.habit, data.habitTimers?.find((item) => item.habit.id === modal.habit.id)?.started, true)} />}
        recovery={recoveryFor(data, modal.habit, modal.date, false)}
        useMinimum={prioritiesFor(data, modal.date).some((item) => item.habitId === modal.habit.id && item.minimum)}
        log={data.logs.find((entry) => entry.id === logKey(modal.habit.id, modal.date))}
        save={(entry) => recordHabit(modal.habit, modal.date, entry, true)} />}
      {modal.type === 'category' && <CategoryForm initial={modal.category} categories={data.categories} busy={busy} save={(category) => void save((current) => ({
        ...current, categories: [...current.categories.filter((item) => item.id !== category.id), category],
      }), 'Life area updated.', true)} />}
      {(modal.type === 'reset' || modal.type === 'import') && <div className="form-stack">
        <p>{modal.type === 'reset' ? 'This clears your logs, check-ins, and custom settings and restores the starter plan.'
          : 'Restoring replaces all device records, including chats and newer entries. Export the current records first if you want to keep them. Large restored histories use a Sparky JSON archive for future backups.'}</p>
        {modal.type === 'reset' && <p>Saved chats are cleared. Exported files remain wherever you saved them.{onAndroid() && ' Reset also turns off automatic copies and cancels weekly AI sharing. Check Downloads/Sparky for files left by earlier installations.'}</p>}
        {modal.type === 'reset' && backupControl.status?.supported && <label><input type="checkbox" checked={removeCopies} onChange={(event) => setRemoveCopies(event.target.checked)} /> Also delete automatic copies owned by this installation</label>}
        {modal.type === 'import' && <p>{modal.backup.habits.length} habits · {modal.backup.logs.length} habit entries · {modal.backup.checkIns.length} check-ins</p>}
        <div className="form-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy || replacingCoach}>Cancel</button>
          <button type="button" className="danger-button" disabled={busy || replacingCoach} onClick={() => {
            if (coachScope.signal.aborted) return;
            coachScope.abort();
            setReplacingCoach(true);
            void (async () => {
              try {
                invalidateWeeklyChoice();
                if (onAndroid()) await androidRequest('weeklyDisable');
                if (modal.type === 'reset' && onAndroid()) {
                  await backupControl.change(removeCopies ? 'clear' : 'off');
                  await androidRequest('reminder');
                  await phoneSync.command('pausePhoneActivity', 'all');
                }
                const replacement = modal.type === 'reset' ? starterData() : modal.backup;
                const saved = await save(() => ({ ...replacement, coachDataOwner: newId() }),
                  modal.type === 'reset' ? 'Starter plan restored.' : 'Backup restored.', true);
                if (!saved && saving.current) setError('Another save is finishing. Please try again.');
              } catch (error) { setError(error instanceof Error ? error.message : 'Could not replace the records.'); }
              finally {
                setCoachScope(new AbortController());
                setReplacingCoach(false);
              }
            })();
          }}>{modal.type === 'reset' ? 'Reset all data' : 'Replace with backup'}</button>
        </div>
      </div>}
    </Dialog>)}
  </div>;
}

createRoot(document.getElementById('root')!).render(isAndroidAppPage() ? <LegalGate><App /></LegalGate> : <App />);

if (import.meta.env.PROD && !onAndroid() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Offline installation is unavailable.', error);
    });
  });
}
