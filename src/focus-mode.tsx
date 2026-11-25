import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Minimize2, Square } from 'lucide-react';
import { useFocusAwake } from './focus-awake.ts';
import { timerCue } from './feedback.ts';
import { playTurtleAnimation, turtleFrameSize } from './turtle-animation.ts';
import { timerReading, type TimerGoal } from './timer-reading.ts';

type Props = {
  title: string; started: string; goal?: TimerGoal; alreadySeconds: number; busy: boolean;
  stop: () => void; minimize: () => void;
};

export function FocusDialog({ title, phase, minimize, children }: {
  title: string; phase?: string; minimize?: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`focus-mode ${phase ?? ''}`} role="dialog" aria-modal="true" aria-label={`Focus: ${title}`}
    onCancel={(event) => { event.preventDefault(); minimize?.(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled');
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first || document.activeElement === event.currentTarget ||
          document.activeElement === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }}>
    {children}
  </dialog>;
}

export function FocusStage({ progress, stretch = 0, proud = false }: { progress: number; stretch?: number; proud?: boolean }) {
  const sparky = useRef<HTMLCanvasElement>(null);
  const clip = proud ? 'proud' : 'ready';
  useEffect(() => {
    const surface = sparky.current;
    if (!surface || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    return playTurtleAnimation(surface, clip, {
      settled: false, onFrame() { surface.dataset.playing = 'true'; surface.parentElement?.setAttribute('data-playing', 'true'); },
      onFinish() {}, onFallback() { surface.dataset.playing = ''; surface.parentElement?.removeAttribute('data-playing'); },
    });
  }, [clip]);
  const radius = 138;
  const circumference = 2 * Math.PI * radius;
  return <div className="focus-stage">
    <svg className="focus-ring" viewBox="0 0 300 300" aria-hidden="true">
      <circle className="focus-track" cx="150" cy="150" r={radius} />
      <circle className="focus-progress" cx="150" cy="150" r={radius} strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)} transform="rotate(-90 150 150)" />
      {stretch > 0 && <circle className="focus-stretch" cx="150" cy="150" r={radius - 14} strokeDasharray={2 * Math.PI * (radius - 14)}
        strokeDashoffset={2 * Math.PI * (radius - 14) * (1 - stretch)} transform="rotate(-90 150 150)" />}
    </svg>
    <span className={`focus-sparky ${clip}`} aria-hidden="true"><canvas ref={sparky} width={turtleFrameSize} height={turtleFrameSize} /></span>
  </div>;
}

const awayKey = (started: string) => `one-life-focus-away-${started}`;
const minutes = (seconds: number) => seconds < 60 ? `${seconds} sec` : `${Math.round(seconds / 60)} min`;

/** Seconds spent outside the app during this session, kept across reloads of the page. */
function useAwayTime(started: string) {
  const [away, setAway] = useState(() => {
    try { return Number(sessionStorage.getItem(awayKey(started))) || 0; } catch { return 0; }
  });
  const [lastTrip, setLastTrip] = useState(0);
  useEffect(() => {
    let leftAt = document.hidden ? Date.now() : 0;
    const onChange = () => {
      if (document.hidden) { leftAt = Date.now(); return; }
      if (!leftAt) return;
      const trip = Math.round((Date.now() - leftAt) / 1000);
      leftAt = 0;
      if (trip < 3) return;
      setLastTrip(trip);
      setAway((total) => {
        const next = total + trip;
        try { sessionStorage.setItem(awayKey(started), String(next)); } catch { /* Shown for this visit only. */ }
        return next;
      });
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [started]);
  return { away, lastTrip, dismissTrip: () => setLastTrip(0) };
}

function sparkyLine(phase: string, progress: number, trip: number) {
  if (trip) return `You were gone for ${minutes(trip)}. I waited. Let's keep going.`;
  if (phase === 'stretch') return 'Stretch reached! I am so proud of you.';
  if (phase === 'target') return 'Target done! Stay a little longer for the stretch?';
  if (progress >= 0.75) return 'Almost there. Don\'t stop now.';
  if (progress >= 0.5) return 'Halfway. You are doing great.';
  if (progress >= 0.1) return 'Nice rhythm. Phone stays down.';
  return 'I\'m watching. Put the phone down and start.';
}

/** Full-screen session: Sparky in the middle, a ring filling to the target, then on toward the stretch. */
export function FocusMode({ title, started, goal, alreadySeconds, busy, stop, minimize }: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(started)) / 1000));
  const reading = timerReading(elapsed, goal, alreadySeconds);
  const total = alreadySeconds + elapsed;
  const targetProgress = goal ? Math.min(1, total / (goal.target * 60)) : 0;
  const stretchProgress = goal && total > goal.target * 60
    ? Math.min(1, (total - goal.target * 60) / Math.max(60, (goal.stretch - goal.target) * 60)) : 0;
  const { away, lastTrip, dismissTrip } = useAwayTime(started);

  useFocusAwake(true);

  // A ding at the target and a fanfare at the stretch, for crossings seen live.
  const phase = useRef(reading.phase);
  useEffect(() => {
    if (phase.current !== reading.phase && (reading.phase === 'target' || reading.phase === 'stretch')) {
      timerCue(started, reading.phase);
    }
    phase.current = reading.phase;
  }, [reading.phase]);

  useEffect(() => {
    if (!lastTrip) return;
    const timer = window.setTimeout(dismissTrip, 12000);
    return () => window.clearTimeout(timer);
  }, [lastTrip, dismissTrip]);

  return <FocusDialog title={title} phase={`focus-${reading.phase}`} minimize={minimize}>
    <div className="focus-top">
      <span className="focus-label">Focus with Sparky</span>
      <button type="button" className="icon-button" aria-label="Minimize focus" onClick={minimize}><Minimize2 size={20} /></button>
    </div>
    <h2 className="focus-title">{title}</h2>
    <FocusStage progress={targetProgress} stretch={stretchProgress} proud={reading.phase !== 'down' && reading.phase !== 'plain'} />
    <strong className="focus-time" role="timer" aria-live="off">{reading.display}</strong>
    <p className="focus-detail">{reading.detail || 'Counting your minutes'}</p>
    <p className={`focus-speech${lastTrip ? ' away' : ''}`} role="status">{sparkyLine(reading.phase, targetProgress, lastTrip)}</p>
    {away > 0 && !lastTrip && <p className="focus-away">Away from this session: {minutes(away)}</p>}
    <div className="focus-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={stop}><Square size={16} /> Stop and save</button>
      <button type="button" className="text-button" onClick={minimize}>Keep timing in the background</button>
    </div>
  </FocusDialog>;
}
