export const programGuides = {
  mornings: { title: 'Steady mornings', original: 'Set out what you need for the first task tomorrow.', steps: [
    'Tonight, put one thing you will need tomorrow where you can see it.',
    'After you get up, use what you set out and do one small action before checking your phone.',
    'Link two short actions together, such as opening the curtains and getting dressed.',
    'Try a five-minute routine. Keep one action as your fallback on rushed mornings.',
    'Run a ten-minute routine and finish by choosing your first priority.',
    'Design a version for a rushed morning and try it on a busy day.',
    'Try your routine in a different setting or at a different start time. Keep the same core cue.',
    'Review a week of mornings and write down a standard routine and a backup you can switch between.',
  ] },
  sleep: { title: 'Better sleep', original: 'Set a wind-down cue and spend ten quiet minutes away from screens.', steps: [
    'Pick a wake-up time you can keep every day this week, weekends included, and set one alarm for it.',
    'Choose a wind-down cue about an hour before bed, such as plugging your phone in outside the bedroom. Spend ten quiet minutes after it.',
    'Get daylight within an hour of waking: five to ten minutes outside or at a bright window.',
    'Have your last caffeine at least six hours before bed, and keep the last few hours free of alcohol and heavy meals.',
    'Make the bedroom dark, quiet and cool. Fix one thing tonight, such as curtains, earplugs or a lower temperature.',
    'If you lie awake for what feels like 20 minutes, get up, do something calm in dim light, and go back to bed when sleepy.',
    'Keep the bed for sleep for a whole week: no phone, no work and no series in bed.',
    'Review a week of wake times, bedtimes and how rested you felt. Keep what worked and plan a short version for disrupted nights.',
  ] },
  movement: { title: 'Move more', original: 'Take a short walk or pick movement that suits your energy.', steps: [
    'Try two minutes of comfortable movement, indoors or outdoors.',
    'Take a five-minute walk or do five minutes of a movement you enjoy.',
    'Try eight minutes at a comfortable pace, or repeat five minutes if that suits you.',
    'Plan two short movement breaks this week and choose when you will do the first.',
    'Try a 15-minute activity you enjoy at a pace where you can talk comfortably.',
    'Plan three enjoyable movement sessions with recovery time between harder efforts.',
    'Pick one small, measurable challenge, such as walking a slightly longer route at your usual pace.',
    'Plan a week that combines movement you enjoy with recovery. Adjust the plan after reviewing how you felt.',
  ] },
  reading: { title: 'Read regularly', original: 'Read a few pages after an activity you already do each day.', steps: [
    'Put a book where you will see it and read one page.',
    'Read for five minutes after something you already do, such as making coffee.',
    'Read for eight to ten minutes and jot down one idea you want to remember.',
    'Try a comfortable ten-minute reading block and keep one page as your fallback.',
    'Read for 15 minutes and summarize the main idea in one sentence.',
    'Read a longer section and write one question about something you want to understand better.',
    'Compare two passages or sources on the same idea and note where they agree or differ.',
    'Write or explain a short synthesis in your own words, using examples from what you read.',
  ] },
  concentration: { title: 'Practice concentration', original: 'Choose one task and set aside ten minutes for it.', steps: [
    'Choose one small task, put the phone out of reach, and work for three minutes.',
    'Close unrelated tabs and spend five minutes on one task.',
    'Try a ten-minute focus block. Write distractions down and return to the task.',
    'Try a fifteen-minute block with a short break afterward.',
    'Set one concrete outcome for a 25-minute work block and take a five-minute break afterward.',
    'Try two focus blocks with a break. Decide what you will finish in each block before starting.',
    'Use a longer block for demanding work and end by noting what distracted you and what helped.',
    'Plan your week around a few protected blocks for your hardest work. Review what you completed and adjust.',
  ] },
  confidence: { title: 'Build confidence', original: 'Choose one manageable challenge and write down what you learned.', steps: [
    'Briefly look up and say hello or thank you during an ordinary interaction, such as at a checkout.',
    'Ask one simple question where it feels natural, such as asking a barista how their day is going.',
    'If the other person seems open to chatting, ask one follow-up question and listen to the answer.',
    'Start a brief conversation in a shared setting. Make one observation and ask what the other person thinks.',
    'Join a small group conversation when there is an opening. Introduce yourself and ask one open question.',
    'Speak up early in a meeting or group discussion. Share one opinion and give a concise reason for it.',
    'Ask for something that matters to you, such as feedback or a change of plan. Leave room for the other person to decline.',
    'Lead a short group discussion or give a brief talk. Invite questions and ask someone you trust for specific feedback.',
  ] },
  project: { title: 'Finish a personal project', original: 'Break the next step into something you can finish today.', steps: [
    'Write down what finished would look like and name one tiny next action.',
    'Spend five minutes making a rough start on that next action.',
    'Set a ten-minute block and finish one small piece you can see or use.',
    'Review what you made, pick the next milestone, and schedule a short block for it.',
    'Define what counts as done for the next milestone and deliver a small usable version.',
    'Ask one person for specific feedback on what you made, then act on one useful point.',
    'Set a deadline and identify what you can cut to finish on time. Deliver one complete milestone.',
    'Finish and share a usable version with its intended audience. Write down what the next iteration should tackle.',
  ] },
  balance: { title: 'Balance your routine', original: 'Make time for one important task and one recovery activity.', steps: [
    'Pick one thing that matters today and one two-minute pause for yourself.',
    'Put a brief recovery activity after a task you already do.',
    'Choose one priority and one thing you can intentionally leave for another day.',
    'Set up a simple day with one priority, one daily responsibility, and protected recovery time.',
    'Plan tomorrow with a buffer between commitments and protect one block of free time.',
    'Review your week and move or drop one commitment that keeps crowding out your priorities.',
    'Practice setting a clear boundary around a commitment while making room for something important to you.',
    'Design a weekly rhythm for priorities, recovery, and unexpected demands. Review and adjust it after a week.',
  ] },
} as const;

export type ProgramGuide = keyof typeof programGuides;
export const guideKeys = Object.keys(programGuides) as [ProgramGuide, ...ProgramGuide[]];
export const programLevels = ['Beginner', 'Beginner plus', 'Intermediate', 'Intermediate plus', 'Advanced', 'Advanced plus', 'Expert', 'Expert plus'] as const;

export function programStep(guide: ProgramGuide, practices: number, duration: number, selected?: number) {
  const steps = programGuides[guide].steps;
  const index = selected === undefined ? Math.min(3, Math.floor(practices * 4 / duration)) : selected - 1;
  return { number: index + 1, action: steps[index], easier: index > 0 ? steps[index - 1] : undefined };
}
