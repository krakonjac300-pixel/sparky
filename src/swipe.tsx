import { useEffect, useRef, type CSSProperties } from 'react';
import { tick } from './feedback.ts';

/** Returns true when it handled the swipe; otherwise the next listener (the main tabs) gets it. */
type Listener = { priority: number; handle: (direction: 1 | -1) => boolean };
const listeners = new Set<Listener>();
const minDistance = 70;
let start: { x: number; y: number; time: number } | undefined;

/** Swipes that start in a field, a chart or anything scrolling sideways belong to that element. */
function ownsSwipe(target: EventTarget | null) {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.matches('input, textarea, select, canvas, [role="dialog"], [data-no-swipe]')) return true;
    const overflow = getComputedStyle(node).overflowX;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollWidth > node.clientWidth + 2) return true;
  }
  return false;
}

function install() {
  window.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    start = event.touches.length === 1 && !ownsSwipe(event.target) ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : undefined;
  }, { passive: true });
  window.addEventListener('touchend', (event) => {
    const from = start;
    start = undefined;
    const touch = event.changedTouches[0];
    if (!from || !touch || Date.now() - from.time > 700) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const direction = dx < 0 ? 1 : -1;
    for (const listener of [...listeners].sort((a, b) => b.priority - a.priority)) if (listener.handle(direction)) return;
  }, { passive: true });
}
let installed = false;

/** Swipe left for the next view, right for the previous. Sections use priority 1, the main tabs 0. */
export function useSwipe(handle: (direction: 1 | -1) => boolean, priority: number) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    if (!installed) { install(); installed = true; }
    const listener = { priority, handle: (direction: 1 | -1) => latest.current(direction) };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [priority]);
}

/** The pill switcher used by Today, History and Life, with swipe between its options. */
export function Segments<T extends string>({ label, options, value, onChange }: {
  label: string; options: readonly T[]; value: T; onChange: (value: T) => void;
}) {
  useSwipe((direction) => {
    const next = options[options.indexOf(value) + direction];
    if (next === undefined) return false;
    tick();
    onChange(next);
    return true;
  }, 1);
  const index = Math.max(0, options.indexOf(value));
  return <div className={`periods segments segments-${options.length}`} role="group" aria-label={label}
    style={{ '--segments': options.length, '--segment': index } as CSSProperties}>
    <span className="segment-thumb" aria-hidden="true" />
    {options.map((option) => <button key={option} type="button" className="secondary-button" aria-pressed={value === option}
      onClick={() => { if (option !== value) tick(); onChange(option); }}>{option}</button>)}
  </div>;
}
