import type { AppData } from './model.ts';
import type { Commit } from './expansion.tsx';

// Check inside the IndexedDB updater too. A replacement in another window can
// commit after an answer arrives and before this window obtains its transaction.
export function privateCoachCommit(commit: Commit, dataOwner: AppData['coachDataOwner'], active: () => boolean): Commit {
  return async (update, message) => {
    if (!active()) return false;
    return commit((current) => {
      if (!active() || current.coachDataOwner !== dataOwner) {
        throw new Error('Sparky records or the Coach session changed. Please try again.');
      }
      return update(current);
    }, message);
  };
}
