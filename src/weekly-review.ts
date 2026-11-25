import { androidRequest } from './android.ts';
import { rememberSummary, weeklySession } from './ai.ts';
import { privateCoachCommit } from './coach-private.ts';
import type { Commit } from './expansion.tsx';

export async function importWeeklyReview(dataOwner: string | undefined, commit: Commit, active: () => boolean, request = androidRequest) {
  const session = weeklySession();
  const current = () => active() && session.active();
  if (!current()) return;
  const grant = await request<string>('weeklyGrant');
  if (!current() || typeof grant !== 'string' || !grant.startsWith(session.owner + '.')) return;
  const stored = await request<string>('weeklyResult', grant);
  if (!stored || !current()) return;
  const result = JSON.parse(stored);
  if (result.weeklyGrant !== grant || result.dataOwner !== (dataOwner ?? '')) return;
  if (await request<string>('weeklyGrant') !== grant || !current()) return;
  const { date, text } = result;
  // Native receipts stay out of exported summary rows, including older backups.
  const entry = { id: `weekly-${date}`, date, days: 7, label: 'Week', text };
  const save = privateCoachCommit(commit, dataOwner, current);
  if (await save(data => rememberSummary(data, entry), 'Sparky saved your weekly summary in History, Reports.')) {
    await request('clearWeekly', JSON.stringify({ weeklyGrant: grant, date }));
  }
}
