import { useEffect, useRef, useState } from 'react';
import { playTurtleAnimation, turtleFrameSize, warmTurtleEncouragement } from './turtle-animation.ts';
import type { TurtlePose } from './turtle-motion.ts';

type Cue = { id: number; reactionKey: string; kind: 'greeting' | 'habit' | 'welcome' | 'plan' | 'reset' };

export function TurtleAvatar({ pose, reactionKey, today, completed, comeback, planned, reset }: {
  pose: TurtlePose; reactionKey: string; today: string; completed: number; comeback: boolean; planned: boolean; reset: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cueSequence = useRef(0);
  const previousProgress = useRef({ today, completed, reactionKey, planned, reset });
  const finishedReaction = useRef<string>(undefined);
  const [cue, setCue] = useState<Cue>();
  const [rendered, setRendered] = useState(false);
  const activeCue = cue?.reactionKey === reactionKey ? cue : undefined;
  const petting = activeCue?.kind === 'greeting';
  const clip = petting ? 'pet' : activeCue?.kind === 'welcome' ? 'welcome' : activeCue ? 'encourage' : pose;
  const stillPose = petting ? 'ready' : activeCue ? 'proud' : pose;
  const clipKey = activeCue ? `cue-${activeCue.id}` : reactionKey;

  const welcomed = useRef('');
  useEffect(() => {
    const previous = previousProgress.current;
    previousProgress.current = { today, completed, reactionKey, planned, reset };
    let kind: Cue['kind'] | undefined;
    if (comeback && welcomed.current !== today) {
      try { welcomed.current = localStorage.getItem('sparky-last-welcome') ?? ''; } catch { /* Use memory when storage is unavailable. */ }
      if (welcomed.current !== today) {
        kind = 'welcome';
        welcomed.current = today;
        try { localStorage.setItem('sparky-last-welcome', today); } catch { /* The mounted card remembers this greeting. */ }
      }
    }
    if (!kind && previous.today === today) {
      if (planned && !previous.planned) kind = 'plan';
      else if (reset && !previous.reset) kind = 'reset';
      else if (completed > previous.completed && previous.reactionKey === reactionKey) kind = 'habit';
    }
    if (kind) setCue({ id: ++cueSequence.current, reactionKey, kind });
  }, [today, completed, reactionKey, comeback, planned, reset]);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let stop: (() => void) | undefined;
    let fallbackTimer: number;

    const finishCue = () => {
      if (activeCue) setCue((current) => current?.id === activeCue.id ? undefined : current);
    };
    const showStill = () => {
      setRendered(false);
      if (activeCue) fallbackTimer = window.setTimeout(finishCue, 1250);
    };
    const updateMotion = () => {
      stop?.();
      window.clearTimeout(fallbackTimer);
      if (motion.matches) {
        showStill();
        return;
      }
      stop = playTurtleAnimation(surface, clip, {
        settled: !activeCue && pose !== 'ready' && finishedReaction.current === reactionKey,
        onFrame() {
          setRendered(true);
          if (!activeCue) warmTurtleEncouragement();
        },
        onFinish() {
          if (activeCue) finishCue();
          else finishedReaction.current = reactionKey;
        },
        onFallback: showStill,
      });
    };

    updateMotion();
    if (typeof motion.addEventListener === 'function') motion.addEventListener('change', updateMotion);
    else motion.addListener(updateMotion);
    return () => {
      stop?.();
      window.clearTimeout(fallbackTimer);
      if (typeof motion.removeEventListener === 'function') motion.removeEventListener('change', updateMotion);
      else motion.removeListener(updateMotion);
    };
  }, [activeCue, clip, pose, reactionKey]);

  function greet() {
    finishedReaction.current = reactionKey;
    setCue({ id: ++cueSequence.current, reactionKey, kind: 'greeting' });
  }

  return <button type="button" className="budget-turtle" aria-label="Pet Sparky"
    data-renderer={rendered ? 'clip' : 'sprite'} data-greeting={activeCue?.kind === 'greeting'}
    data-cue={activeCue?.kind} onClick={greet}>
    <span key={clipKey} className={`turtle-sprites${petting ? '' : activeCue ? ' greeting' : pose !== 'ready' ? ` reaction ${pose}` : ''}`} aria-hidden="true">
      <span className="turtle-sprite ready" />
      {stillPose !== 'ready' && <span className={`turtle-sprite expression ${stillPose}`} />}
    </span>
    <canvas ref={canvas} width={turtleFrameSize} height={turtleFrameSize} className="turtle-canvas" aria-hidden="true" />
    {petting && <span className="sr-only" role="status">Sparky leans into your hand.</span>}
  </button>;
}

export function SparkyCheer({ welcome }: { welcome: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    return playTurtleAnimation(surface, welcome ? 'welcome' : 'encourage', {
      settled: false, onFrame() { surface.parentElement?.setAttribute('data-playing', 'true'); }, onFinish() {}, onFallback() {},
    });
  }, [welcome]);
  return <span aria-hidden="true" className="sparky-cheer"><canvas ref={canvas} width={turtleFrameSize} height={turtleFrameSize} /></span>;
}
