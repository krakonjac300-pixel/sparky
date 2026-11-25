import { flushSync } from 'react-dom';
import { isAndroidAppPage, onAndroid } from './android.ts';
import { newId } from './model.ts';

export const browserNavigation = () => !isAndroidAppPage() && !onAndroid();

type Entry = { daybookStep?: number; daybookDialogs?: string[] };
type Frame = { id: string; step: number; close: () => void };
const active: Frame[] = [];
const forward = new Map<string, { step: number; open: () => void }>();
let traversing = false;
let reopening: string | undefined;
let openingButton: HTMLButtonElement | undefined;
let dismissing = false;

export function watchDialogOpeners() {
  const capture = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    openingButton = button ?? undefined;
    window.setTimeout(() => { if (openingButton === button) openingButton = undefined; }, 0);
  };
  document.addEventListener('click', capture, true);
  return () => document.removeEventListener('click', capture, true);
}

export function pushView(state: object) {
  const step = (history.state?.daybookStep ?? 0) + 1;
  for (const [id, entry] of forward) if (entry.step >= step) forward.delete(id);
  history.pushState({ ...state, daybookStep: step }, '');
}

// Local sheets own their form state. Forward uses the same opening control so it
// reads current data again. Never replay a submission or guess among duplicates.
function rememberOpener(opener?: HTMLButtonElement) {
  if (!opener || opener.form && opener.type === 'submit') return () => {};
  const original = new WeakRef(opener);
  const name = (button: HTMLButtonElement) => button.getAttribute('aria-label') ?? button.textContent;
  const label = name(opener);
  const style = opener.className;
  const candidates = () => {
    const scope = [...document.querySelectorAll('dialog:modal')].at(-1) ?? document;
    return [...scope.querySelectorAll<HTMLButtonElement>('button')].filter(button => name(button) === label &&
      button.className === style && button.checkVisibility() && !button.disabled && !(button.form && button.type === 'submit'));
  };
  const unique = candidates().length === 1;
  return () => {
    const matches = candidates();
    const trigger = matches.find(button => button === original.deref()) ?? (unique && matches.length === 1 ? matches[0] : undefined);
    trigger?.focus();
    trigger?.click();
  };
}

export function trackDialog(close: () => void, restore?: () => void) {
  const id = reopening ?? newId();
  const ids = [...active.map(frame => frame.id), id];
  if (reopening === undefined) pushView({ ...history.state, daybookDialogs: ids });
  const step = forward.get(id)?.step ?? history.state?.daybookStep ?? 0;
  const frame = { id, step, close };
  active.push(frame);
  forward.set(id, { step, open: restore ?? rememberOpener(openingButton) });
  function unmount() {
    active.splice(active.indexOf(frame), 1);
    if (traversing) return;
    // Saving or cancelling inside a form can remove several sheets in one commit.
    queueMicrotask(() => {
      const current: string[] = history.state?.daybookDialogs ?? [];
      if (current.at(-1) === id && current.length > active.length) history.go(active.length - current.length);
    });
  }
  function dismiss() {
    if (history.state?.daybookDialogs?.at(-1) !== id) return close();
    if (dismissing) return;
    dismissing = true;
    history.back();
  }
  return { unmount, dismiss };
}

export function restoreView(state: Entry, renderView: () => void) {
  const target = state.daybookDialogs ?? [];
  dismissing = false;
  let common = 0;
  while (common < active.length && active[common].id === target[common]) common++;
  traversing = true;
  try {
    while (active.length > common) {
      const frame = active[active.length - 1];
      flushSync(frame.close);
      if (active.includes(frame)) {
        // A pending save can veto dismissal. Return to its existing history entry.
        history.go(frame.step - (state.daybookStep ?? 0));
        return;
      }
    }
    flushSync(renderView);
    for (const id of target.slice(common)) {
      const entry = forward.get(id);
      if (!entry) break;
      reopening = id;
      flushSync(entry.open);
      if (active.at(-1)?.id !== id) break;
    }
    if (active.length !== target.length) {
      history.replaceState({ ...history.state, daybookDialogs: active.map(frame => frame.id) }, '');
    }
  } finally {
    reopening = undefined;
    traversing = false;
  }
}
