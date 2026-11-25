/** Plain words for technical failures. Anything unclear falls back to a message written for that spot. */
export function friendlyError(cause: unknown, fallback: string) {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  if (looksOffline(raw)) return 'You seem to be offline. Check your internet, then try again.';
  if (/\b401\b|unauthori[sz]ed|sign in again|token.*expired|expired.*token/i.test(raw)) return 'Your ChatGPT sign-in expired. Sign in again in Life, then Coach.';
  if (/\b429\b|rate.?limit|quota|usage limit|too many requests/i.test(raw)) return 'ChatGPT is busy or your plan limit was reached. Try again in a few minutes.';
  if (!raw || raw.length > 180 || /unknown error|^mock$|undefined|null|exception|stack|\bat [\w.]+\(/i.test(raw)) return fallback;
  return raw;
}

export function looksOffline(raw = '') {
  return (typeof navigator !== 'undefined' && navigator.onLine === false)
    || /network|failed to fetch|unable to resolve|timed? ?out|unreachable|socket|no internet|connection (reset|refused|closed|abort)/i.test(raw);
}

/** "just now", "4 min ago", "2 h ago", or a date for older times. */
export function timeAgo(timestamp: number, now = Date.now()) {
  const minutes = Math.round((now - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
