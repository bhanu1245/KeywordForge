/**
 * Per-call costs and the pre-flight estimator.
 *
 * SINGLE SOURCE OF TRUTH. `dataforseo.ts` reports these on its responses and
 * the quota check estimates against them, so the two can never disagree about
 * what an operation is expected to cost.
 *
 * Every figure below was MEASURED against the live API, not guessed:
 *
 *   keyword_ideas (limit 5)      cost 0.0126
 *   search_volume (2 keywords)   cost 0.0900
 *
 * The search_volume figure is the one that matters most: it was previously
 * modelled at $0.00005 per keyword, which predicted $0.0001 for a call that
 * actually cost $0.09 — a ~900x understatement. Google Ads volume is billed
 * per TASK.
 *
 * CAVEAT, and the reason for the safety margin below: each figure is a SINGLE
 * observation. keyword_ideas may scale with `limit`, and one 2-keyword call
 * cannot distinguish a flat per-task fee from a per-keyword component. The
 * estimator therefore rounds against us, never in our favour.
 */

/** Observed cost of one DataForSEO Labs keyword_ideas call. */
export const COST_PER_IDEAS_CALL = 0.0126;

/** Observed cost of one google_ads/search_volume TASK (not per keyword). */
export const COST_PER_VOLUME_CALL = 0.09;

/** SERP live/advanced, one call per keyword. Not yet observed live. */
export const COST_PER_SERP_CALL = 0.002;

/**
 * Keywords sent per search_volume task. MUST match the chunk size used by
 * `enrichKeywordList`, which is why that code imports this constant rather
 * than repeating the number — if the batch size drifts, every estimate
 * silently becomes wrong.
 */
export const VOLUME_KEYWORDS_PER_CALL = 400;

/**
 * Estimates are multiplied by this before being checked against quota.
 *
 * Justification rather than superstition: the two live figures are single
 * observations, and a quota that under-estimates lets real spend past the cap
 * it exists to enforce. Over-estimating only refuses work slightly early,
 * which is the cheaper error. 25% is deliberately modest — a per-keyword
 * component in search_volume would blow past any margin this size, so the
 * margin is a cushion for small variation, not a substitute for measuring.
 */
export const ESTIMATE_SAFETY_MARGIN = 1.25;

/** Rounds UP to the cent, so an estimate is never optimistic. */
function ceilCents(value: number): number {
  return Math.ceil(value * 100) / 100;
}

function withMargin(raw: number): number {
  return ceilCents(raw * ESTIMATE_SAFETY_MARGIN);
}

/**
 * Bulk enrichment: one search_volume TASK per batch of keywords.
 * Batches are rounded up — 401 keywords is two tasks, not 1.0025.
 */
export function estimateBulkEnrichCost(keywordCount: number): number {
  if (keywordCount <= 0) return 0;
  const batches = Math.ceil(keywordCount / VOLUME_KEYWORDS_PER_CALL);
  return withMargin(batches * COST_PER_VOLUME_CALL);
}

/** SERP analysis: one metered call per keyword. */
export function estimateSerpCost(keywordCount: number): number {
  if (keywordCount <= 0) return 0;
  return withMargin(keywordCount * COST_PER_SERP_CALL);
}

/** Discovery: a single keyword_ideas call regardless of the limit requested. */
export function estimateDiscoverCost(): number {
  return withMargin(COST_PER_IDEAS_CALL);
}

/**
 * A rank check refreshes SERPs (bypassing cache — see SerpInput.fresh) and
 * then records positions, so its cost is the SERP cost with no cache relief.
 */
export function estimateRankCheckCost(keywordCount: number): number {
  return estimateSerpCost(keywordCount);
}

/**
 * How far an actual cost may drift from its constant before it is worth
 * saying out loud. Below this, normal per-request variation; above it, the
 * constant is probably wrong and every estimate built on it is too.
 */
export const COST_DRIFT_TOLERANCE = 0.25;

/**
 * Compares a provider-reported cost against the constant we estimate with.
 * Returns the actual figure and warns once per call when they diverge —
 * silently absorbing the gap is how a cost model rots without anyone noticing.
 */
export function reconcileCost(
  label: string,
  actual: number | null | undefined,
  expected: number,
): number {
  if (typeof actual !== "number" || !Number.isFinite(actual) || actual < 0) {
    return expected;
  }
  if (expected > 0) {
    const drift = Math.abs(actual - expected) / expected;
    if (drift > COST_DRIFT_TOLERANCE) {
      console.warn(
        `[costs] ${label}: provider reported $${actual.toFixed(4)} but the estimate constant is $${expected.toFixed(4)} ` +
          `(${(drift * 100).toFixed(0)}% drift). Quota estimates built on this constant are off — re-measure it.`,
      );
    }
  }
  return actual;
}
