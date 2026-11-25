import { useEffect, useState } from 'react';
import { Dialog } from './forms.tsx';
import { calendarDate } from './model.ts';
import { flameTier, streakMilestones, type streakInfo } from './streak.ts';

type Info = ReturnType<typeof streakInfo>;
const dayName = new Intl.DateTimeFormat('en', { weekday: 'short' });

export function Flame({ days, size, lit = days > 0 }: { days: number; size: number; lit?: boolean }) {
  const color = flameTier(Math.max(days, 1))?.color ?? '#ff7a45';
  const scaled = Math.round(size * (days ? Math.min(1.25, 0.85 + Math.log10(days + 1) * 0.2) : 0.85));
  return <span className={`flame${lit ? '' : ' out'}`} aria-hidden="true">
    <svg width={scaled} height={scaled} viewBox="0 0 24 24">
      <path d="M12 2c1 3.5 5 5.6 5 10.2A5 5 0 0 1 12 17a5 5 0 0 1-5-4.8c0-2 1-3.4 2.2-4.5.2 1.6 1 2.6 2.1 3C10.6 8.2 11.2 5 12 2Z" fill={color} />
      <path d="M12 9.5c.6 1.7 2.6 2.7 2.6 5A2.6 2.6 0 0 1 12 17a2.6 2.6 0 0 1-2.6-2.5c0-1.4.9-2.3 1.7-3 .2.8.5 1.2 1 1.4-.2-1.3-.3-2.4-.1-3.4Z" fill="#fff6d6" opacity=".9" />
    </svg>
  </span>;
}

/** The flame in the top bar; tap it for the details. */
export function StreakChip({ info }: { info: Info }) {
  const [open, setOpen] = useState(false);
  if (!info.streak && !info.paused) return null;
  return <>
    <button type="button" className={`streak-chip${info.streak ? '' : ' cold'}`} aria-label={`Streak: ${info.streak} ${info.streak === 1 ? 'day' : 'days'}${info.paused ? ', paused' : ''}`}
      onClick={() => setOpen(true)}><Flame days={info.streak} size={18} />{info.streak}{info.paused && ' ⏸'}</button>
    {open && <Dialog title="Your streak" close={() => setOpen(false)}><StreakSheet info={info} /></Dialog>}
  </>;
}

function StreakSheet({ info }: { info: Info }) {
  const tier = flameTier(info.streak);
  return <div className="streak-sheet">
    <Flame days={info.streak} size={76} />
    <strong className="streak-count">{info.streak} {info.streak === 1 ? 'day' : 'days'}</strong>
    <p className="muted">{tier ? `${tier.name} streak` : 'No streak yet'} · best ever {Math.max(info.best, info.streak)} {info.best === 1 ? 'day' : 'days'}</p>
    <div className="streak-week">{info.week.map((day) => <div key={day.date} title={day.date + " " + day.state} className={`streak-day ${day.state}`}>
      <i>{day.state === 'done' ? <Flame days={Math.max(info.streak, 1)} size={20} /> : day.state === 'frozen' ? '🧊' : day.state === 'paused' ? '⏸' : day.state === 'missed' ? '·' : ''}</i>
      {dayName.format(calendarDate(day.date))}
    </div>)}</div>
    {info.paused && <p>Streak paused. Resume in Settings.</p>}
    {!info.paused && !info.todayCounts && info.streak > 0 && <p className="streak-today">Finish 70% of today's habits to keep the flame going.</p>}
    <div className="streak-milestones">{streakMilestones.map((goal) => <div key={goal} className={`streak-milestone${Math.max(info.best, info.streak) >= goal ? ' hit' : ''}`}>
      <span>🔥</span>{goal}</div>)}</div>
    <div className="streak-freeze"><b aria-hidden="true">🧊</b><p><strong>{info.freezes ? `${info.freezes} streak ${info.freezes === 1 ? 'freeze' : 'freezes'} ready` : 'No streak freeze yet'}</strong>
      You earn one for every full week (up to 2). If you miss a day, it saves your streak on its own.</p></div>
    <p className="muted streak-rule">Log a qualifying completion and finish the day with a proud or so-so Sparky.</p>
  </div>;
}

/** Shown once when today pushes the streak onto a milestone. */
export function StreakMilestone({ days, done }: { days: number; done: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(done, 4500);
    return () => window.clearTimeout(timer);
  }, [done]);
  return <div className="day-celebration" role="status" onClick={done}>
    <div className="celebration-card streak-celebration">
      <Flame days={days} size={92} />
      <strong>{days}-day streak!</strong>
      <span>{days >= 30 ? 'Your flame burns blue. That is rare. Sparky is beaming.' : 'Every day you show up, the flame grows.'}</span>
    </div>
  </div>;
}
