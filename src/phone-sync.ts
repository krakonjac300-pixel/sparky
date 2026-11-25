import { useCallback, useEffect, useRef, useState } from 'react';
import { androidRequest, onAndroid } from './android.ts';
import { reminderPlan } from './reminders.ts';
import { localDate, mergePhoneActivity, phoneActivitySchema, type AppData, type PhoneActivitySnapshot } from './model.ts';
import { updateData } from './storage.ts';

const sources = ['sleep', 'steps', 'exercise', 'distance', 'screen'] as const;

export function usePhoneSync(update: (data: AppData) => void, today: string) {
  const [status, setStatus] = useState<PhoneActivitySnapshot>();
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  const running = useRef(false);
  const forced = useRef(false);
  const queuedForce = useRef(false);
  const seen = useRef<Partial<Record<typeof sources[number], number>>>({});

  const refresh = useCallback(async function requestPhoneActivity(force = false) {
    if (!onAndroid() || (!force && document.hidden)) return;
    if (busy.current || running.current) {
      if (force && !forced.current) queuedForce.current = true;
      return;
    }
    const fresh = force || queuedForce.current;
    queuedForce.current = false;
    const attempt = ++generation.current;
    running.current = true;
    forced.current = fresh;
    try {
      const snapshot = phoneActivitySchema.parse(await androidRequest('phoneActivity', fresh ? 'refresh' : ''));
      if (generation.current !== attempt) return;
      const delta = { ...snapshot };
      for (const key of sources) {
        if (snapshot[key]?.updated === seen.current[key]) delete delta[key];
      }
      if (sources.some((key) => delta[key])) {
        const data = await updateData((current) => mergePhoneActivity(current, delta));
        if (generation.current !== attempt) return;
        update(data);
        if (delta.steps || delta.exercise || delta.distance || delta.sleep) {
          await androidRequest('syncHabitReminders', JSON.stringify(reminderPlan(data, localDate())));
          if (generation.current !== attempt) return;
        }
        for (const key of sources) {
          seen.current[key] = snapshot[key]?.updated;
        }
      }
      setStatus(snapshot);
      setError('');
    } catch {
      if (generation.current === attempt) setError('Could not load phone activity. Sparky will try again automatically.');
    } finally {
      if (generation.current === attempt) {
        running.current = false;
        forced.current = false;
        if (queuedForce.current && !document.hidden) void requestPhoneActivity(true);
      }
    }
  }, [update]);

  useEffect(() => {
    if (!onAndroid()) return;
    const sync = () => { void refresh(); };
    const onResume = (event: Event) => {
      if (!document.hidden) void refresh(event instanceof CustomEvent && event.detail?.usageChanged === true);
    };
    sync();
    // Re-read screen time every 10 minutes while Sparky is open; health data stays hourly on the Android side.
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 10 * 60 * 1000);
    window.addEventListener('one-life-phone-activity', onResume);
    document.addEventListener('visibilitychange', sync);
    return () => {
      ++generation.current;
      running.current = false;
      forced.current = false;
      queuedForce.current = false;
      window.clearInterval(timer);
      window.removeEventListener('one-life-phone-activity', onResume);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [refresh, today]);

  async function command(action: string, value = '') {
    ++generation.current;
    running.current = false;
    forced.current = false;
    busy.current = true;
    try { return await androidRequest<boolean>(action, value); }
    finally {
      busy.current = false;
      await refresh(true);
    }
  }

  return { status, error, command, refresh };
}

export type PhoneSync = ReturnType<typeof usePhoneSync>;
