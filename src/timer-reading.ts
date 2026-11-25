export type TimerGoal = { minimum: number; target: number; stretch: number };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Where a running session stands: counting down to the target, then up past it toward the stretch. */
export function timerReading(elapsedSeconds: number, goal?: TimerGoal, alreadySeconds = 0) {
  const total = alreadySeconds + elapsedSeconds;
  if (!goal) return { phase: 'plain' as const, display: clock(elapsedSeconds), detail: '' };
  const toTarget = goal.target * 60 - total;
  if (toTarget > 0) return { phase: 'down' as const, display: clock(toTarget), detail: `to your ${goal.target} min target` };
  const over = -toTarget;
  const toStretch = goal.stretch * 60 - total;
  return toStretch > 0
    ? { phase: 'target' as const, display: `+${clock(over)}`, detail: `Target done · stretch in ${Math.ceil(toStretch / 60)} min` }
    : { phase: 'stretch' as const, display: `+${clock(over)}`, detail: `Stretch reached · ${Math.floor(total / 60)} min total` };
}
