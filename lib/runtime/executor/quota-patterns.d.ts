export declare const PROVIDER_QUOTA_RE: RegExp;
/**
 * Looser list for the text of a CLI that already failed (exit ≠ 0 or an error envelope): there the text is the
 * provider's error, not a test log, so the short forms are safe.
 */
export declare const CLI_FAILURE_QUOTA_RE: RegExp;
export declare function isProviderQuotaText(text: string): boolean;
