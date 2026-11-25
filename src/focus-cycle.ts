export function focusCycle(work: number, rest: number, rounds: number, elapsed: number) {
  const cycle = work + rest;
  const total = cycle * rounds;
  const seconds = Math.max(0, Math.min(total, elapsed));
  const round = Math.min(rounds, Math.floor(seconds / cycle) + 1);
  const phaseElapsed = seconds - (round - 1) * cycle;
  const finished = seconds === total;
  const onBreak = !finished && phaseElapsed >= work;
  const remaining = finished ? 0 : (onBreak ? cycle : work) - phaseElapsed;
  const focused = (round - 1) * work + Math.min(work, phaseElapsed);
  const progress = finished ? 1 : onBreak ? (phaseElapsed - work) / rest : phaseElapsed / work;
  return { total, seconds, round, finished, onBreak, remaining, focused, progress };
}
