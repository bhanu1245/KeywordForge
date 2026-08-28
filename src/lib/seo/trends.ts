/**
 * Trend Detection and Seasonality (PRD §7 modules 27 and 28).
 *
 * Both read the 12-month relative-volume series already stored on every
 * KeywordMetric, so neither costs an extra provider call — the data arrived
 * with the original volume lookup. Pure functions, no I/O, fully tested.
 *
 * The series is RELATIVE (each point is a multiple of the 12-month mean), not
 * absolute searches. That is deliberate: it makes shape comparable between a
 * 200/mo keyword and a 200,000/mo one, which is what both of these modules
 * actually reason about.
 */

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export type TrendDirection = "rising" | "falling" | "stable";

export interface TrendResult {
  direction: TrendDirection;
  /** Percentage change, recent quarter vs the preceding one. */
  changePercent: number;
  /** 0..1 confidence that the movement is real rather than noise. */
  strength: number;
}

/**
 * Compares the most recent quarter against the one before it.
 *
 * Quarter-over-quarter rather than last-month-vs-first-month: a single month
 * is noisy, and a first-vs-last comparison on seasonal data reports a trend
 * that is really just the calendar (December vs January on a gifting keyword
 * always "falls", every year, forever).
 */
export function detectTrend(series: number[] | null | undefined): TrendResult {
  if (!series || series.length < 6) {
    return { direction: "stable", changePercent: 0, strength: 0 };
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const recent = mean(series.slice(-3));
  const prior = mean(series.slice(-6, -3));

  if (prior === 0) return { direction: "stable", changePercent: 0, strength: 0 };

  const changePercent = Number((((recent - prior) / prior) * 100).toFixed(1));
  const magnitude = Math.abs(changePercent);

  // Below 10% is inside the noise floor of relative monthly volume data;
  // calling that a trend would fill the UI with meaningless arrows.
  if (magnitude < 10) {
    return { direction: "stable", changePercent, strength: 0 };
  }

  return {
    direction: changePercent > 0 ? "rising" : "falling",
    changePercent,
    strength: Number(Math.min(magnitude / 50, 1).toFixed(2)),
  };
}

export interface SeasonalityResult {
  isSeasonal: boolean;
  /** 0..1 — how much of the variation is concentrated in a few months. */
  index: number;
  /** Month indices (0=Jan) that sit well above the yearly average. */
  peakMonths: number[];
  peakLabels: string[];
  /** Peak value as a multiple of the mean, e.g. 2.4x. */
  peakMultiple: number;
}

/**
 * Flags a keyword as seasonal and names its peak months.
 *
 * Uses coefficient of variation (standard deviation / mean) rather than raw
 * spread, because spread alone scales with the series' own magnitude and would
 * label every high-volume keyword seasonal.
 */
export function detectSeasonality(
  series: number[] | null | undefined,
  startMonth = 0,
): SeasonalityResult {
  const empty: SeasonalityResult = {
    isSeasonal: false,
    index: 0,
    peakMonths: [],
    peakLabels: [],
    peakMultiple: 1,
  };
  if (!series || series.length < 12) return empty;

  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  if (mean === 0) return empty;

  const variance =
    series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / series.length;
  const cv = Math.sqrt(variance) / mean;

  // 0.25 CV is roughly where a human looking at the chart starts calling it
  // "seasonal" rather than "bumpy".
  const isSeasonal = cv >= 0.25;
  const max = Math.max(...series);

  // A peak is a month at least 20% above the yearly average.
  const threshold = mean * 1.2;
  const peakMonths = series
    .map((v, i) => ({ v, i }))
    .filter((p) => p.v >= threshold)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((p) => (p.i + startMonth) % 12)
    .sort((a, b) => a - b);

  return {
    isSeasonal,
    index: Number(Math.min(cv, 1).toFixed(2)),
    peakMonths: isSeasonal ? peakMonths : [],
    peakLabels: isSeasonal ? peakMonths.map((m) => MONTHS[m]) : [],
    peakMultiple: Number((max / mean).toFixed(2)),
  };
}

/** Short human summary for the UI, e.g. "Seasonal — peaks Nov, Dec". */
export function describeSeasonality(result: SeasonalityResult): string {
  if (!result.isSeasonal) return "Evergreen";
  if (result.peakLabels.length === 0) return "Seasonal";
  return `Seasonal — peaks ${result.peakLabels.join(", ")}`;
}
