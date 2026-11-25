import type { AppData } from './model.ts';
import { guideKeys, programGuides, programStep } from './program-guide.ts';

type Program = NonNullable<AppData['programs']>[number];

export function guideFor(program: Partial<Program>) {
  return program.guide ?? guideKeys.find((key) => program.title === programGuides[key].title && program.action === programGuides[key].original);
}

export function exerciseFor(program: Program, today: string) {
  const guide = guideFor(program);
  const repeated = new Set(program.repeatDays ?? []);
  const practices = program.days.filter((date) => date < today && !repeated.has(date)).length;
  return guide ? programStep(guide, practices, program.duration, program.level) : undefined;
}
