import { logKey, type AppData } from './model.ts';

function restoreRow<T>(rows: T[] | undefined, matches: (row: T) => boolean, previous: T | undefined, index: number) {
  const kept = rows?.filter((row) => !matches(row));
  if (!previous) return kept;
  const restored = kept ?? [];
  restored.splice(index, 0, previous);
  return restored;
}

// Undo only this habit and date. A phone refresh or another edit can occur while the toast is visible.
export function habitUndo(before: AppData, after: AppData, habitId: string, date: string) {
  const id = logKey(habitId, date);
  const matches = (row: { habitId: string; date: string }) => row.habitId === habitId && row.date === date;
  const snapshot = (data: AppData) => ({
    log: data.logs.find((row) => row.id === id),
    remainder: data.timerRemainders?.find(matches),
    override: data.healthOverrides?.find(matches),
  });
  const previous = snapshot(before);
  const logIndex = previous.log ? before.logs.indexOf(previous.log) : 0;
  const remainderIndex = before.timerRemainders?.findIndex(matches) ?? 0;
  const overrideIndex = before.healthOverrides?.findIndex(matches) ?? 0;
  const expected = JSON.stringify(snapshot(after));
  const dataOwner = after.coachDataOwner;
  return (current: AppData): AppData => {
    if (current.coachDataOwner !== dataOwner || JSON.stringify(snapshot(current)) !== expected ||
        !current.habits.some((habit) => habit.id === habitId)) {
      throw new Error('This habit changed again. Open its latest entry to edit it.');
    }
    return {
      ...current,
      logs: restoreRow(current.logs, matches, previous.log, logIndex) ?? [],
      timerRemainders: restoreRow(current.timerRemainders, matches, previous.remainder, remainderIndex),
      healthOverrides: restoreRow(current.healthOverrides, matches, previous.override, overrideIndex),
    };
  };
}
