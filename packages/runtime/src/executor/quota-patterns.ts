/**
 * OXB-191: what a provider says when it refuses a call for quota, rate limit or overload.
 *
 * One list for the scheduler and for every CLI adapter. Each alternative needs the provider's own wording: a bare
 * "reset", a bare "429" or the words "rate limit" alone also appear in ordinary test output (a test named "resets the
 * form", `src/foo.ts:429:12`, a suite for the project's own rate limiter) and must never pause a run as quota.
 */
const PROVIDER_QUOTA_SOURCE = [
  'usage limit',
  // "You've hit your weekly limit", "hit your limit"
  "hit your (?:[a-z0-9-]+ )?(?:usage )?limit",
  // "rate limit exceeded", "rate-limited", "rate_limit_error", "Request rate limit reached"
  'rate[ _-]?limit(?:ed\\b|[ _-]?(?:exceeded|reached|error|hit))',
  'exceeded (?:your |the )?(?:current )?(?:quota|rate limit)',
  'quota (?:exceeded|exhausted)',
  'insufficient_quota',
  '\\bRESOURCE_EXHAUSTED\\b',
  'overloaded_error',
  'credit balance is too low',
  // the status as a status, never a lone number
  '(?:HTTP|status(?: code)?|error(?: code)?)[ :=]*429\\b',
  '\\b429[ :-]+too many requests',
  '(?:usage|rate|session|weekly|daily|monthly|hourly|request|token) limit reached',
  // the reset only counts on a line that already speaks of a limit or quota
  '(?:limit|quota)[^\\n]{0,120}\\bresets? (?:at|in|on)?\\s*\\S',
].join('|');

export const PROVIDER_QUOTA_RE = new RegExp(PROVIDER_QUOTA_SOURCE, 'i');

/**
 * Looser list for the text of a CLI that already failed (exit ≠ 0 or an error envelope): there the text is the
 * provider's error, not a test log, so the short forms are safe.
 */
export const CLI_FAILURE_QUOTA_RE = new RegExp(
  `${PROVIDER_QUOTA_SOURCE}|\\bquota\\b|credit balance|\\boverloaded\\b|too many requests|try again (?:later|in \\d|after \\d)`,
  'i',
);

export function isProviderQuotaText(text: string): boolean {
  return PROVIDER_QUOTA_RE.test(String(text || ''));
}
