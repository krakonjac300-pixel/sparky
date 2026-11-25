import { androidRequest, onAndroid } from './android.ts';

export type FeedbackKind = 'done' | 'allDone' | 'undo' | 'win';
export type FeedbackSetting = 'sound' | 'haptics';

const key = (setting: FeedbackSetting) => `one-life-${setting}`;

export function feedbackEnabled(setting: FeedbackSetting) {
  try { return localStorage.getItem(key(setting)) !== 'off'; } catch { return true; }
}

export function setFeedbackEnabled(setting: FeedbackSetting, on: boolean) {
  try { localStorage.setItem(key(setting), on ? 'on' : 'off'); } catch { /* Lasts until the app closes. */ }
}

/** WebView audio ignores the ringer switch, so Android tells us when the phone is on silent or vibrate. */
let phoneSilent = false;
export async function checkPhoneSilent() {
  if (!onAndroid()) return;
  try { phoneSilent = !(await androidRequest<boolean>('soundAllowed', '', 3000)); } catch { phoneSilent = false; }
}

let audio: AudioContext | undefined;

/** One soft bell-like note: quick attack, gentle exponential fade. */
function note(context: AudioContext, frequency: number, start: number, length: number, volume: number, type: OscillatorType = 'sine') {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

/** Notes as [frequency Hz, delay s, length s, volume]. Sine for warmth, a quiet triangle on top for sparkle. */
const sounds: Record<FeedbackKind, [number, number, number, number][]> = {
  // A bright two-note "pop": A5 then E6.
  done: [[880, 0, 0.16, 0.16], [1318.5, 0.07, 0.32, 0.14]],
  // A little fanfare: C5 E5 G5 C6, then a held C6 + E6 shimmer.
  allDone: [[523.3, 0, 0.18, 0.13], [659.3, 0.1, 0.18, 0.13], [784, 0.2, 0.2, 0.13], [1046.5, 0.3, 0.7, 0.15], [1318.5, 0.3, 0.7, 0.08]],
  // One light high note for a small step toward a small win.
  win: [[1174.7, 0, 0.16, 0.1]],
  // A soft falling click for undo.
  undo: [[392, 0, 0.09, 0.08], [293.7, 0.06, 0.14, 0.07]],
};

function playSound(kind: FeedbackKind) {
  if (!feedbackEnabled('sound') || phoneSilent || typeof AudioContext === 'undefined') return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime + 0.01;
    for (const [frequency, delay, length, volume] of sounds[kind]) {
      note(audio, frequency, now + delay, length, volume);
      if (kind !== 'undo') note(audio, frequency * 2, now + delay, length * 0.6, volume * 0.12, 'triangle');
    }
  } catch { /* Sound is a nice extra; never block saving on it. */ }
}

const webPatterns: Record<FeedbackKind, number[]> = { done: [18], allDone: [30, 70, 30, 70, 60], undo: [8], win: [10] };

function vibrate(kind: FeedbackKind) {
  if (!feedbackEnabled('haptics')) return;
  if (onAndroid()) void androidRequest('haptic', kind === 'win' ? 'undo' : kind, 3000).catch(() => undefined);
  else navigator.vibrate?.(webPatterns[kind]);
}

/** A barely-there tap when switching tabs and sections. */
export function tick() {
  if (feedbackEnabled('haptics') && onAndroid()) void androidRequest('haptic', 'undo', 3000).catch(() => undefined);
}

/** The same running timer can be on screen in several places (Today, a habit sheet, full-screen Focus); each
 * target or stretch crossing rings once, however many of them are mounted. */
const timerCues = new Set<string>();
export function timerCue(started: string, phase: 'target' | 'stretch') {
  const key = started + '|' + phase;
  if (timerCues.has(key)) return;
  timerCues.add(key);
  feedback(phase === 'stretch' ? 'allDone' : 'done');
}

export function feedback(kind: FeedbackKind) {
  vibrate(kind);
  playSound(kind);
}
