export type TurtlePose = 'ready' | 'proud' | 'disappointed' | 'so-so';
type Key = readonly [time: number, value: number];

const neutral = { strength: 0, turn: 0, dip: 0, lean: 0, squash: 0, lift: 0, palm: 0, thumb: 0, glance: 0, squint: 0 };
type Channel = keyof typeof neutral;
type Performance = Partial<Record<Channel, readonly Key[]>>;

const acting: Record<Exclude<TurtlePose, 'ready'>, Performance> = {
  proud: {
    strength: [[0, 0], [180, .05], [520, 1], [1100, .87], [1550, 1], [1920, .83], [2270, 1]],
    turn: [[0, 0], [155, -.14], [560, .1], [1050, 0], [1560, .10], [2300, .06], [2950, 0]],
    dip: [[0, 0], [180, .18], [570, -.45], [940, -.12], [1460, -.35], [1840, -.08], [2200, -.28], [2920, -.13]],
    lean: [[0, 0], [160, -.1], [630, .39], [1130, .13], [1700, .27], [2600, .18]],
    squash: [[0, 0], [170, .27], [520, -.25], [800, .06], [1400, -.11], [1750, .08], [2150, -.13], [2820, 0]],
    lift: [[0, 0], [270, 0], [708, 1], [1010, .89], [1220, .68], [1485, .94],
      [1710, .85], [1910, .66], [2220, .90], [2430, .81], [3210, 0]],
    palm: [[0, 0], [690, -.24], [1200, -.08], [1480, -.28], [1890, -.08], [2190, -.23], [3210, 0]],
    thumb: [[0, 0], [480, .04], [708, 1], [2470, 1], [3120, 0]],
    glance: [[0, 0], [165, -.25], [560, .1], [910, 0]],
  },
  'so-so': {
    strength: [[0, 0], [280, .24], [660, .9], [1070, .91], [1720, 1], [2510, .88]],
    turn: [[0, 0], [314, .16], [740, .25], [1300, .07], [1870, -.11], [2630, .04]],
    dip: [[0, 0], [420, -.12], [960, .05], [1440, .13], [1840, .02], [2500, .07]],
    lean: [[0, 0], [420, .31], [760, -.32], [1140, -.51], [1700, -.17], [2390, -.29]],
    lift: [[0, 0], [460, 0], [930, .72], [1220, .58], [1660, .79], [1940, .65], [2670, 0]],
    palm: [[0, 0], [710, -.1], [950, -.78], [1230, .49], [1520, -.68], [1840, .3], [2670, 0]],
    glance: [[0, 0], [315, .82], [695, .78], [1130, .12], [1420, .6], [2140, 0]],
    squint: [[0, 0], [570, .09], [1030, .17], [2180, .07]],
  },
  disappointed: {
    strength: [[0, 0], [190, .14], [600, .88], [1160, .90], [1950, 1], [3000, .92], [3580, .88]],
    turn: [[0, 0], [260, -.12], [670, .74], [1090, -.92], [1470, .73], [1850, -.74],
      [2210, .59], [2530, -.50], [2860, .16], [3350, 0]],
    dip: [[0, 0], [240, .08], [700, .53], [1120, .71], [2180, .82], [2680, .70], [3500, .45]],
    lean: [[0, 0], [555, -.09], [1100, .16], [1840, .04], [2820, .08]],
    squash: [[0, 0], [550, .29], [1100, .16], [2060, .27], [3360, .05]],
    glance: [[0, 0], [220, -.48], [590, .25], [1250, -.12], [2860, .28], [3450, 0]],
    squint: [[0, 0], [420, .26], [685, .1], [1530, .18], [2700, .35], [3250, .1]],
  },
};

function sample(keys: readonly Key[], time: number) {
  for (let index = 1; index < keys.length; index++) {
    const [end, target] = keys[index];
    if (time > end) continue;
    const [start, initial] = keys[index - 1];
    const progress = Math.max(0, (time - start) / (end - start));
    const smooth = progress * progress * (3 - 2 * progress);
    return initial + (target - initial) * smooth;
  }
  return keys[keys.length - 1][1];
}

export function turtleMotion(pose: TurtlePose, elapsed: number, reduced = false) {
  if (pose === 'ready') return neutral;
  const tracks = acting[pose];
  const result = { ...neutral };
  for (const name of Object.keys(tracks) as Channel[]) result[name] = sample(tracks[name]!, reduced ? Infinity : elapsed);
  if (reduced && pose === 'proud') Object.assign(result, { lift: .82, thumb: 1 });
  if (reduced && pose === 'so-so') Object.assign(result, { lift: .64, palm: -.54 });
  return result;
}
