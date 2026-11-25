import type { TurtlePose } from './turtle-motion.ts';

// Sparky's clips (Nov 2026): Kling 3.0 Pro on fal, started and ended on his original poses so loops close,
// keyed from flat green, interpolated to 60 FPS with RIFE. See one-life-tools/fal/build_fal.py.
export const turtleFrameSize = 384;
const columns = 10;
const framesPerChunk = 40;
const framesPerSecond = 60;
type TurtleClip = TurtlePose | 'encourage' | 'welcome' | 'pet';
// cycle: instead of wagging nonstop, replay the whole thumbs up now and then with idle breathing in between.
type Clip = { name: string; frames: number; loopStart: number | null; first?: number; cycle?: boolean };
const clips = {
  ready: { name: 'idle', frames: 302, loopStart: 0 },
  pet: { name: 'idle', frames: 90, loopStart: null },
  proud: { name: 'proud', frames: 544, loopStart: 242, cycle: true },
  'so-so': { name: 'mixed', frames: 302, loopStart: 0 },
  disappointed: { name: 'disappointed', frames: 302, loopStart: 0 },
  welcome: { name: 'welcome', frames: 302, loopStart: null },
  encourage: { name: 'encourage', frames: 242, loopStart: null },
} satisfies Record<TurtleClip, Clip>;

const chunkFile = (name: string, chunk: number) => `/turtle-plush-${name}-${chunk}.webp`;
const clipChunks = (clip: Clip) => Math.ceil(clip.frames / framesPerChunk);

export const turtleAnimationFiles = [
  '/turtle-plush-poses.png',
  ...new Set(Object.values(clips).flatMap((clip) =>
    Array.from({ length: clipChunks(clip) }, (_, chunk) => chunkFile(clip.name, chunk)))),
];

const decodedChunks = new Map<string, Promise<HTMLImageElement>>();
const maxDecodedChunks = 6;

function loadChunk(file: string) {
  const cached = decodedChunks.get(file);
  if (cached) {
    decodedChunks.delete(file);
    decodedChunks.set(file, cached);
    return cached;
  }
  const image = new Image();
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the turtle animation.'));
    image.src = file;
  });
  const decoded = loaded.then(async (atlas) => {
    if (typeof atlas.decode === 'function') await atlas.decode();
    return atlas;
  }).catch((error: unknown) => {
    if (decodedChunks.get(file) === decoded) decodedChunks.delete(file);
    throw error;
  });
  decodedChunks.set(file, decoded);
  const warm = chunkFile(clips.encourage.name, 0);
  while (decodedChunks.size > maxDecodedChunks) {
    const oldest = [...decodedChunks.keys()].find((key) => key !== warm && key !== file);
    if (!oldest) break;
    decodedChunks.delete(oldest);
  }
  return decoded;
}

export function warmTurtleEncouragement() {
  void loadChunk(chunkFile(clips.encourage.name, 0)).catch(() => { /* Try again if a habit cue needs the clip. */ });
}

export type TurtleFrame = { name: string; index: number };

// The proud clip: frames 0..241 lift the arm into a thumbs up, 242..543 wag the thumb.
const proudLift = 242;
const proudFrames = 544;
// Lower at the same pace he lifted, so both halves feel like one motion.
const lowerSpeed = 1;
const lowerSteps = Math.ceil(proudLift / lowerSpeed);
/** Steps into the cycle where Sparky has lowered his arm and starts breathing. */
export const thumbsUpRestStep = proudFrames + lowerSteps;

/**
 * One thumbs-up cycle: lift and wag, lower the arm by replaying the lift backwards, then breathe in the idle loop
 * for rest(cycle) whole idle loops. Proud frame 0 and idle frame 0 are the same standing pose, so every seam closes.
 */
export function thumbsUpCycle(idleFrames: number, rest: (cycle: number) => number) {
  // Cycle start steps, filled in as playback reaches them. Lookahead can ask past a boundary and then step back.
  const starts = [0];
  const idles: number[] = [];
  const idleOf = (cycle: number) => (idles[cycle] ??= rest(cycle) * idleFrames);
  let cycle = 0;
  return (step: number): TurtleFrame => {
    while (step >= starts[cycle] + thumbsUpRestStep + idleOf(cycle)) {
      starts[cycle + 1] ??= starts[cycle] + thumbsUpRestStep + idleOf(cycle);
      cycle++;
    }
    while (cycle > 0 && step < starts[cycle]) cycle--;
    const t = step - starts[cycle];
    if (t < proudFrames) return { name: 'proud', index: t };
    if (t < thumbsUpRestStep) return { name: 'proud', index: Math.max(0, proudLift - 1 - Math.round((t - proudFrames) * lowerSpeed)) };
    return { name: 'idle', index: (t - thumbsUpRestStep) % idleFrames };
  };
}

interface Playback {
  onFrame: () => void;
  onFinish: () => void;
  onFallback: () => void;
  settled: boolean;
}

export function playTurtleAnimation(canvas: HTMLCanvasElement, pose: TurtleClip, playback: Playback) {
  const context = canvas.getContext('2d');
  if (!context) {
    playback.onFallback();
    return;
  }

  const clip: Clip = clips[pose];
  const size = turtleFrameSize;
  const chunks = new Map<string, HTMLImageElement>();
  const pending = new Set<string>();
  let request = 0;
  let elapsed = 0;
  let previousTime: number | undefined;
  let previousFrame = -1;
  let visible = typeof IntersectionObserver === 'undefined';
  let disposed = false;
  let finished = false;
  let failed = false;
  let reportedReaction = playback.settled;
  const cycle = clip.cycle
    ? thumbsUpCycle(clips.ready.frames, () => 1)
    : undefined;
  // Which frame of which clip shows at each step (60 steps per second).
  const frameAt = (step: number): TurtleFrame => {
    if (cycle) return cycle(step);
    if (step < clip.frames) return { name: clip.name, index: step };
    if (clip.loopStart === null) return { name: clip.name, index: clip.frames - 1 };
    return { name: clip.name, index: clip.loopStart + (step - clip.loopStart) % (clip.frames - clip.loopStart) };
  };
  // A remounted card skips the reaction it already showed: the cycle resumes while Sparky breathes.
  const firstStep = playback.settled ? (cycle ? thumbsUpRestStep : clip.loopStart ?? 0) : 0;

  // Fade from whatever Sparky was doing when a new clip starts, so reactions never jump.
  const fadeMs = 220;
  let fadeFrom: HTMLCanvasElement | undefined;
  if (canvas.width && canvas.height) {
    fadeFrom = document.createElement('canvas');
    fadeFrom.width = canvas.width;
    fadeFrom.height = canvas.height;
    fadeFrom.getContext('2d')?.drawImage(canvas, 0, 0);
  }
  let lastKey = '';

  const chunkKey = (frame: TurtleFrame) => `${frame.name}:${Math.floor(frame.index / framesPerChunk)}`;

  function want(frame: TurtleFrame) {
    const key = chunkKey(frame);
    if (chunks.has(key) || pending.has(key)) return;
    pending.add(key);
    void loadChunk(chunkFile(frame.name, Math.floor(frame.index / framesPerChunk))).then((image) => {
      if (disposed) return;
      chunks.set(key, image);
      updatePlayback();
    }).catch(() => {
      if (!disposed && !failed) {
        failed = true;
        playback.onFallback();
      }
    });
  }

  function frameImage(frame: TurtleFrame) {
    const image = chunks.get(chunkKey(frame));
    if (!image) return undefined;
    const local = frame.index % framesPerChunk;
    return { image, sx: (local % columns) * size, sy: Math.floor(local / columns) * size };
  }

  function draw(position: number) {
    const step = Math.floor(position);
    const frame = frameAt(step);
    const index = frame.index;
    const current = frameImage(frame);
    // Keep upcoming chunks decoding ahead of playback, including across clips and the reversed lift.
    for (const ahead of [1, 20, 40]) want(frameAt(step + ahead));
    if (!current || !context) return false;
    const blend = pose === 'pet' ? 0 : position - step;
    const fade = fadeFrom ? Math.max(0, 1 - elapsed / fadeMs) : 0;
    const key = `${frame.name}:${index}:${Math.round(blend * 10)}:${Math.round(fade * 20)}`;
    if (key === lastKey) return true;
    lastKey = key;
    context.globalAlpha = 1;
    if (pose === 'pet') {
      const lean = Math.sin(Math.PI * index / (clip.frames - 1)) ** 2;
      const scale = size / 192;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, size, size);
      // Shift the cheeks and crown together, easing to a planted chest and feet.
      for (let y = 0; y < size; y += 2) {
        const weight = Math.max(0, Math.min(1, (139 * scale - y) / (60 * scale)));
        const soft = weight * weight * (3 - 2 * weight);
        context.drawImage(current.image, current.sx, current.sy + y, size, 2, 9 * scale * lean * soft, y, size, 2);
      }
    } else {
      context.globalCompositeOperation = 'copy';
      context.drawImage(current.image, current.sx, current.sy, size, size, 0, 0, size, size);
      context.globalCompositeOperation = 'source-over';
      const next = blend > .05 ? frameImage(frameAt(step + 1)) : undefined;
      if (next) {
        context.globalAlpha = blend;
        context.drawImage(next.image, next.sx, next.sy, size, size, 0, 0, size, size);
      }
    }
    if (fadeFrom && fade > 0) {
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = fade;
      context.drawImage(fadeFrom, 0, 0, size, size);
    } else fadeFrom = undefined;
    context.globalAlpha = 1;
    if (previousFrame < 0) playback.onFrame();
    previousFrame = step;
    return true;
  }

  function advance(time: number) {
    request = 0;
    if (previousTime !== undefined) elapsed += Math.min(100, time - previousTime);
    previousTime = time;
    const position = firstStep + (elapsed * framesPerSecond) / 1000;
    const step = Math.floor(position);
    const ends = clip.loopStart === null && !cycle;
    const shown = draw(ends ? Math.min(clip.frames - 1, position) : position);
    if (shown && clip.loopStart !== null && clip.loopStart > 0 && !reportedReaction && step >= clip.loopStart) {
      reportedReaction = true;
      playback.onFinish();
    }
    if (shown && ends && step >= clip.frames - 1) {
      finished = true;
      playback.onFinish();
    }
    // Wait for a chunk that is still decoding instead of skipping ahead.
    if (!shown && previousTime !== undefined) elapsed = Math.max(0, elapsed - Math.min(100, 1000 / framesPerSecond));
    updatePlayback();
  }

  function updatePlayback() {
    const onScreen = visible && !document.hidden;
    if (!disposed && chunks.size && !finished && !failed && onScreen) {
      if (!request) request = window.requestAnimationFrame(advance);
    } else {
      window.cancelAnimationFrame(request);
      request = 0;
      previousTime = undefined;
    }
  }

  const observer = typeof IntersectionObserver === 'undefined' ? undefined :
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updatePlayback();
    });
  observer?.observe(canvas);
  document.addEventListener('visibilitychange', updatePlayback);

  const first = frameAt(firstStep);
  const firstKey = chunkKey(first);
  pending.add(firstKey);
  void loadChunk(chunkFile(first.name, Math.floor(first.index / framesPerChunk))).then((image) => {
    if (disposed) return;
    chunks.set(firstKey, image);
    draw(firstStep);
    updatePlayback();
  }).catch(() => {
    if (!disposed) playback.onFallback();
  });

  return () => {
    disposed = true;
    updatePlayback();
    observer?.disconnect();
    document.removeEventListener('visibilitychange', updatePlayback);
  };
}
