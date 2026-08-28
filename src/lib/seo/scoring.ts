/**
 * Keyword Difficulty, Opportunity Score, Traffic Potential and Commercial
 * Value (PRD §7 modules 3, 4, 19, 20).
 *
 * HONESTY NOTE — read before trusting these numbers:
 * Ahrefs/Moz difficulty is fundamentally a *backlink* metric. PRD §6 states
 * plainly that a link index is not buildable in-house at MVP stage. So the
 * difficulty here is a documented proxy built from the inputs we actually
 * have (paid competition, volume, phrase length, and SERP composition when a
 * SERP call was made). It ranks keywords against each other usefully; it is
 * not numerically comparable to an Ahrefs KD, and the UI says so. When a
 * backlink index is licensed in Phase 4, `serpStrength` becomes the real
 * authority signal and the weights below shift toward it.
 */

import { type Intent, intentValueWeight } from "./intent";
import { wordCount } from "./normalize";

export interface DifficultyInput {
  volume?: number | null;
  /** Paid competition 0..1 as reported by the data provider. */
  competition?: number | null;
  keyword: string;
  /**
   * Mean authority 0..100 of the domains ranking in the top 10. Only present
   * when a SERP call was made for this keyword — SERP calls are metered, so
   * most bulk rows will not have it.
   */
  serpStrength?: number | null;
}

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

/** log-scaled 0..1: 10/mo -> ~0, 100k/mo -> 1. */
export function volumeScore(volume?: number | null): number {
  if (!volume || volume <= 0) return 0;
  return clamp(Math.log10(volume) / 5, 0, 1);
}

/**
 * Longer phrases are easier to rank for. Steep between 2 and 5 words, flat
 * after — a 9-word query is not meaningfully easier than a 6-word one.
 */
function lengthDifficulty(keyword: string): number {
  const n = wordCount(keyword);
  if (n <= 1) return 100;
  if (n === 2) return 85;
  if (n === 3) return 65;
  if (n === 4) return 48;
  if (n === 5) return 35;
  if (n === 6) return 27;
  return 20;
}

export function keywordDifficulty(input: DifficultyInput): number {
  const lengthPart = lengthDifficulty(input.keyword);
  const competitionPart = clamp((input.competition ?? 0) * 100);
  const volumePart = volumeScore(input.volume) * 100;
  const hasSerp =
    input.serpStrength !== undefined && input.serpStrength !== null;

  // With a SERP sample the composition of who already ranks is by far the
  // best signal available, so it takes nearly half the weight. Without it the
  // weight is redistributed proportionally across the remaining three.
  const score = hasSerp
    ? 0.45 * clamp(input.serpStrength as number) +
      0.28 * competitionPart +
      0.15 * volumePart +
      0.12 * lengthPart
    : 0.51 * competitionPart + 0.27 * volumePart + 0.22 * lengthPart;

  return Math.round(clamp(score));
}

/** Human label for a KD score, used for the colour band in the explorer. */
export function difficultyBand(
  kd: number,
): "easy" | "medium" | "hard" | "very hard" {
  if (kd < 20) return "easy";
  if (kd < 45) return "medium";
  if (kd < 70) return "hard";
  return "very hard";
}

/**
 * Organic CTR by position. Approximate industry curve — used for traffic
 * potential only, never presented as a guarantee.
 */
const CTR_BY_POSITION = [
  0.28, 0.15, 0.11, 0.08, 0.06, 0.05, 0.04, 0.03, 0.028, 0.025,
];

export function ctrForPosition(position: number): number {
  if (position < 1) return 0;
  if (position <= CTR_BY_POSITION.length) return CTR_BY_POSITION[position - 1];
  return 0.01;
}

/** Estimated monthly organic sessions if you ranked at `position`. */
export function trafficPotential(
  volume?: number | null,
  position = 3,
): number {
  if (!volume || volume <= 0) return 0;
  return Math.round(volume * ctrForPosition(position));
}

/**
 * Monthly value of that traffic, in the CPC's currency — what you would have
 * paid Google Ads for the same clicks. This is the number that goes in a
 * client pitch deck.
 */
export function commercialValue(
  volume?: number | null,
  cpc?: number | null,
  position = 3,
): number {
  if (!volume || !cpc || volume <= 0 || cpc <= 0) return 0;
  return Number((trafficPotential(volume, position) * cpc).toFixed(2));
}

export interface OpportunityInput {
  volume?: number | null;
  difficulty: number;
  intent: Intent;
}

/**
 * Opportunity Score 0..100 — the single column an agency sorts by.
 *
 * Deliberately a transparent weighted blend rather than a black box, because
 * the answer has to be defensible to a client: "this ranks high because it
 * has real volume, we can realistically rank for it, and it is a buying
 * query." Volume is log-scaled so a 50k head term does not bulldoze the
 * whole list.
 */
export function opportunityScore(input: OpportunityInput): number {
  const vol = volumeScore(input.volume);
  const ease = clamp(100 - input.difficulty, 0, 100) / 100;
  const intent = intentValueWeight(input.intent);
  const raw = vol * 0.5 + ease * 0.35 + intent * 0.15;
  return Math.round(clamp(raw * 100));
}
