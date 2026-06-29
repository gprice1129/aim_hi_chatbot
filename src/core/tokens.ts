export {
  estimate_tokens,
  DEFAULT_CHARS_PER_TOKEN,
}
export type {
  TokenEstimator,
}

/*
 * A deterministic, dependency-free token estimator. This is a deliberately
 * simple guardrail proxy so that core can budget context with no I/O and no
 * network.
 *
 * The chars-per-token ratio is a coarse English-ish average; it under-counts
 * dense code and non-English text, so the budgets built on it are kept
 * conservative. A host can re-baseline DEFAULT_CHARS_PER_TOKEN from a
 * count_tokens sample offline, or inject a different TokenEstimator entirely.
 */

// Maps text to an approximate token count. Pure; same input -> same output.
type TokenEstimator = (text: string) => number;

// ~4 chars per token: a conservative English-ish proxy; re-baseline offline.
const DEFAULT_CHARS_PER_TOKEN = 4;

/*
 * (string) => number
 * Estimate the token count of text as ceil(chars / DEFAULT_CHARS_PER_TOKEN).
 * Monotonic in length; empty text estimates 0.
 * Pure
 * Public
 */
function estimate_tokens(text: string): number {
  return Math.ceil(text.length / DEFAULT_CHARS_PER_TOKEN);
}
