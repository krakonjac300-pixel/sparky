import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { timerCue } from './feedback.ts';
import { timerReading, type TimerGoal } from './timer-reading.ts';

export function HabitTimer({ started, busy, title, onPress, goal, alreadySeconds = 0 }: {
  started?: string; busy: boolean; title?: string; onPress: () => void; goal?: TimerGoal; alreadySeconds?: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!started) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [started]);
  const seconds = Math.max(0, Math.floor((now - Date.parse(started ?? '')) / 1000));
  const reading = timerReading(seconds, goal, alreadySeconds);

  // A ding when the countdown hits zero and again at the stretch, only for crossings seen live.
  const phase = useRef(reading.phase);
  useEffect(() => {
    if (started && phase.current !== reading.phase && (reading.phase === 'target' || reading.phase === 'stretch')) {
      timerCue(started, reading.phase);
    }
    phase.current = reading.phase;
  }, [reading.phase, started]);

  return <button type="button" className={`habit-timer secondary-button timer-${reading.phase}`} disabled={busy} onClick={onPress}>
    {started ? <Square size={15} /> : <Play size={15} />}
    <span>{started ? 'Stop and save' : 'Start focus'}{title && ` · ${title}`}
      {started && reading.detail && <small className="timer-detail">{reading.detail}</small>}</span>
    {started && <strong role="timer">{reading.display}</strong>}
  </button>;
}
