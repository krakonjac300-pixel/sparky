import type { ProgramGuide } from './program-guide.ts';

/**
 * Coaching that works without ChatGPT: practical tips drawn from established guidance for each program,
 * plus program-specific wording for the journal and for the optional ChatGPT question.
 * Sources: NHS and AASM sleep advice, WHO physical activity guidelines, graded exposure from CBT for social anxiety,
 * implementation intentions and habit stacking research, timeboxing and single-tasking for focus.
 */
export const programCoaching: Record<ProgramGuide, {
  tips: readonly string[]; example: string; reflect: string; question: string;
}> = {
  mornings: {
    tips: [
      'Decide the night before: the first task, the clothes, the breakfast. Fewer choices in the morning means less friction.',
      'Keep your phone out of reach until your first action is done, so the morning starts on your terms.',
      'Anchor the routine to something that already happens, like the kettle boiling or opening the curtains.',
      'Have a two-minute fallback for rushed days. Doing the small version keeps the routine alive.',
    ],
    example: 'I laid out my gym clothes last night and put them on before checking my phone.',
    reflect: 'What made this morning easier or harder?',
    question: 'How do I keep this going on mornings when I oversleep?',
  },
  sleep: {
    tips: [
      'Get up at the same time every day, weekends included. A steady wake time sets your body clock more than an early bedtime does.',
      'Get daylight within an hour of waking, even five to ten minutes outside or at a bright window.',
      'Stop caffeine at least six hours before bed, and keep alcohol and heavy meals away from the last few hours.',
      'Keep the bedroom dark, quiet and cool, and use the bed only for sleep. If you lie awake for what feels like 20 minutes, get up, do something calm in dim light, and go back when sleepy.',
    ],
    example: 'I plugged my phone in outside the bedroom at 22:30 and read for ten minutes.',
    reflect: 'How did you sleep, and what helped you wind down?',
    question: 'What can I do when my mind keeps racing at bedtime?',
  },
  movement: {
    tips: [
      'Any movement counts. Short bouts add up, and the WHO guideline is about 150 minutes of moderate activity a week.',
      'Use the talk test: at a moderate pace you can talk but not sing.',
      'Pick a fixed slot, such as a walk straight after lunch, so you are not deciding every day.',
      'Pair it with something you enjoy, like a podcast or a friend, and lay out your shoes where you will see them.',
    ],
    example: 'I walked for ten minutes after lunch instead of scrolling.',
    reflect: 'How did your body and mood feel afterwards?',
    question: 'What movement fits a busy day when I only have ten minutes?',
  },
  reading: {
    tips: [
      'Keep the book where your phone usually is: bedside, sofa, bag.',
      'Read right after something you already do each day, such as your morning coffee or getting into bed.',
      'Stop at a point where you want to continue. It makes the next session easier to start.',
      'If a book is a chore, switch books. Reading something you enjoy beats finishing something you do not.',
    ],
    example: 'I read twelve pages with my coffee before opening any apps.',
    reflect: 'What idea from today’s reading do you want to remember?',
    question: 'How can I remember more of what I read?',
  },
  concentration: {
    tips: [
      'Decide the exact outcome before you start, like “draft the first two paragraphs”, not “work on the report”.',
      'Put the phone in another room or out of sight. Even a face-down phone pulls at attention.',
      'Keep a distraction list. Write the thought down and go straight back to the task.',
      'Work in timed blocks with a real break between them, and do your hardest work when your energy is highest.',
    ],
    example: 'I worked 25 minutes on the budget with my phone in the kitchen and wrote down three distractions.',
    reflect: 'What pulled your attention away, and what helped you come back?',
    question: 'How do I get back into focus after an interruption?',
  },
  confidence: {
    tips: [
      'Go step by step. Repeating a manageable challenge until it feels easier works better than one big leap.',
      'Stay in the situation a little longer than feels comfortable. Nervousness usually fades if you do not escape early.',
      'Drop small safety habits, like rehearsing every word or avoiding eye contact, so you learn you cope without them.',
      'Afterwards, write down what actually happened, not what you feared would happen.',
    ],
    example: 'I asked the barista how her day was going and we chatted for a minute.',
    reflect: 'What did you expect to happen, and what actually happened?',
    question: 'What could I say if I feel awkward in a conversation?',
  },
  project: {
    tips: [
      'Write down what “done” looks like, so you know when to stop polishing.',
      'Always know the next physical action, like “open the file and write the headline”, not “work on the website”.',
      'Book the time in your calendar and treat it like an appointment with yourself.',
      'Ship a small version early. Feedback on something real beats planning in your head.',
    ],
    example: 'I wrote the outline for chapter two in a 20-minute block.',
    reflect: 'What did you finish, and what is the next action?',
    question: 'How do I keep going when I lose motivation halfway through?',
  },
  balance: {
    tips: [
      'Choose one priority a day. Everything else is a bonus.',
      'Put recovery in the calendar the same way you put in work: a walk, a call with a friend, time doing nothing.',
      'Leave buffers between commitments so one overrun does not break the whole day.',
      'Practise a kind no. “I can’t this week, could we do next week?” protects your time without burning bridges.',
    ],
    example: 'I finished the report, then took a 20-minute walk without my phone.',
    reflect: 'What gave you energy today, and what drained it?',
    question: 'How do I say no to extra work without feeling guilty?',
  },
};
