import { useEffect, useState, type CSSProperties } from 'react';
import { Vibrate, Volume2, VolumeX } from 'lucide-react';
import { feedback, feedbackEnabled, setFeedbackEnabled, type FeedbackSetting } from './feedback.ts';

export function FeedbackSettings() {
  const [enabled, setEnabled] = useState({ sound: feedbackEnabled('sound'), haptics: feedbackEnabled('haptics') });
  const toggle = (setting: FeedbackSetting) => {
    const on = !enabled[setting];
    setFeedbackEnabled(setting, on);
    setEnabled((current) => ({ ...current, [setting]: on }));
    if (on) feedback('done');
  };
  return <section className="panel settings-panel">
    <h2>Sound and vibration</h2>
    <p className="muted">Quiet when your phone is on silent.</p>
    <div className="themes">
      <button className="secondary-button" type="button" aria-pressed={enabled.sound} onClick={() => toggle('sound')}>
        {enabled.sound ? <Volume2 size={17} /> : <VolumeX size={17} />} Sounds {enabled.sound ? 'on' : 'off'}</button>
      <button className="secondary-button" type="button" aria-pressed={enabled.haptics} onClick={() => toggle('haptics')}>
        <Vibrate size={17} /> Vibration {enabled.haptics ? 'on' : 'off'}</button>
    </div>
  </section>;
}

const confettiColors = ['#b6e9bd', '#f7c873', '#f29b7f', '#8fd3f4', '#f5e6a8', '#c9b6f2'];
const pieces = Array.from({ length: 34 }, (_, index) => ({
  left: (index * 37) % 100,
  delay: (index % 9) * 0.07,
  drift: ((index * 53) % 60) - 30,
  spin: ((index * 71) % 540) - 270,
  color: confettiColors[index % confettiColors.length],
  round: index % 3 === 0,
}));
export const celebrationMs = 2800;

/** The whole day is done: Sparky jumps, confetti falls, then it gets out of the way. */
export function DayCelebration({ done }: { done: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(done, celebrationMs);
    return () => window.clearTimeout(timer);
  }, [done]);
  return <div className="day-celebration" role="status" aria-live="polite" onClick={done}>
    <div className="confetti" aria-hidden="true">{pieces.map((piece, index) => <span key={index} className={piece.round ? 'round' : undefined}
      style={{ left: `${piece.left}%`, background: piece.color, animationDelay: `${piece.delay}s`,
        '--drift': `${piece.drift}vw`, '--spin': `${piece.spin}deg` } as CSSProperties} />)}</div>
    <div className="celebration-card">
      <span className="celebration-sparky" aria-hidden="true" />
      <strong>All habits done!</strong>
      <span>Sparky is proud of you.</span>
    </div>
  </div>;
}
