/**
 * Search Intent classification (PRD §7 module 5).
 *
 * This is a weighted-signal classifier rather than an LLM call, for three
 * reasons: it is free, it is instant at 10K+ rows, and it is deterministic so
 * a keyword does not silently change bucket between two runs of the same
 * report. `src/lib/ai/claude.ts` can refine low-confidence rows on demand —
 * that is the escape hatch, not the default path.
 */

import { QUESTION_WORDS, normalizeText, words } from "./normalize";

export const INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const;

export type Intent = (typeof INTENTS)[number];

export interface IntentResult {
  intent: Intent;
  /** 0..1 — share of total signal weight won by the chosen intent. */
  confidence: number;
  /** Which phrases fired, for the "why did it say that" tooltip in the UI. */
  signals: string[];
}

/**
 * Weights are relative, not probabilities. Multi-word signals are checked as
 * phrases so "near me" does not get split into two useless unigrams.
 */
type SignalTable = Array<[phrase: string, weight: number]>;

const TRANSACTIONAL: SignalTable = [
  ["near me", 3.0], ["for sale", 3.0], ["buy", 3.0], ["order online", 3.0],
  ["free shipping", 2.5], ["coupon", 2.5], ["discount code", 2.5],
  ["purchase", 2.5], ["book", 2.0], ["hire", 2.0], ["order", 2.0],
  ["price", 2.0], ["pricing", 2.0], ["cost", 1.8], ["cheap", 2.0],
  ["affordable", 1.8], ["deal", 1.8], ["deals", 1.8], ["shop", 2.0],
  ["store", 1.5], ["discount", 1.8], ["quote", 1.8], ["delivery", 1.5],
  ["subscription", 1.5], ["open now", 2.0], ["nearby", 2.5],
];

const COMMERCIAL: SignalTable = [
  ["vs", 3.0], ["versus", 3.0], ["comparison", 2.5], ["compare", 2.5],
  ["alternative", 2.5], ["alternatives", 2.5], ["best", 2.2], ["top", 2.0],
  ["review", 2.5], ["reviews", 2.5], ["rating", 2.0], ["ratings", 2.0],
  ["ranked", 1.8], ["which is better", 3.0], ["pros and cons", 2.5],
  ["worth it", 2.0], ["recommended", 1.8], ["leading", 1.5],
];

const NAVIGATIONAL: SignalTable = [
  ["login", 3.5], ["log in", 3.5], ["sign in", 3.5], ["signin", 3.5],
  ["official site", 3.5], ["official website", 3.5], ["homepage", 3.0],
  ["customer service", 2.5], ["contact number", 2.5], ["app download", 2.5],
  ["download", 2.0], ["portal", 2.5], ["dashboard", 2.0], ["my account", 3.0],
  ["careers", 2.0], ["headquarters", 2.0],
];

const INFORMATIONAL: SignalTable = [
  ["how to", 3.0], ["what is", 3.0], ["why is", 3.0], ["guide", 2.5],
  ["tutorial", 2.5], ["examples", 2.0], ["example", 1.8], ["ideas", 2.0],
  ["tips", 2.2], ["meaning", 2.5], ["definition", 2.5], ["explained", 2.5],
  ["checklist", 2.0], ["template", 1.8], ["difference between", 2.5],
  ["benefits", 2.0], ["symptoms", 2.0], ["causes", 2.0], ["history", 2.0],
  ["statistics", 2.0], ["learn", 2.0], ["diy", 2.2], ["steps", 1.8],
];

const TABLES: Array<[Intent, SignalTable]> = [
  ["informational", INFORMATIONAL],
  ["navigational", NAVIGATIONAL],
  ["commercial", COMMERCIAL],
  ["transactional", TRANSACTIONAL],
];

/**
 * Ties break toward the intent that costs the least to be wrong about.
 * Mislabelling a transactional term as informational loses a money page;
 * the reverse just adds a blog post to a cluster. Higher index wins ties.
 */
const TIE_BREAK: Intent[] = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
];

function matchPhrase(haystack: string, tokens: string[], phrase: string): boolean {
  if (phrase.includes(" ")) return haystack.includes(phrase);
  return tokens.includes(phrase);
}

export function classifyIntent(keyword: string): IntentResult {
  const normalized = normalizeText(keyword);
  const tokens = words(keyword);
  const padded = ` ${normalized} `;

  const scores = new Map<Intent, number>(INTENTS.map((i) => [i, 0]));
  const signals: string[] = [];

  for (const [intent, table] of TABLES) {
    for (const [phrase, weight] of table) {
      const hit = phrase.includes(" ")
        ? padded.includes(` ${phrase} `) || normalized.startsWith(`${phrase} `)
        : matchPhrase(normalized, tokens, phrase);
      if (hit) {
        scores.set(intent, (scores.get(intent) ?? 0) + weight);
        signals.push(phrase);
      }
    }
  }

  // A leading question word is a strong informational cue even with no other
  // signal ("does gold tarnish"). Only counted in first position — "how much
  // is X" leads with how, but "buy how-to book" should not.
  if (tokens.length > 0 && QUESTION_WORDS.has(tokens[0])) {
    scores.set("informational", (scores.get("informational") ?? 0) + 2.0);
    signals.push(`leading "${tokens[0]}"`);
  }
  if (keyword.includes("?")) {
    scores.set("informational", (scores.get("informational") ?? 0) + 1.0);
    signals.push("question mark");
  }

  // Deliberately NO "single bare token => navigational" rule. It is tempting
  // (bare brand searches are navigational) but most single-word keywords in a
  // research set are broad head terms like "jewellery", and mislabelling those
  // would poison every cluster they seed. Unsignalled terms fall through to
  // the zero-confidence branch below, which is the honest answer.

  let best: Intent = "informational";
  let bestScore = -1;
  for (const intent of INTENTS) {
    const score = scores.get(intent) ?? 0;
    const better =
      score > bestScore ||
      (score === bestScore &&
        TIE_BREAK.indexOf(intent) > TIE_BREAK.indexOf(best));
    if (better) {
      best = intent;
      bestScore = score;
    }
  }

  const total = [...scores.values()].reduce((a, b) => a + b, 0);
  // No signal at all: an unmodified multi-word noun phrase. Default to
  // informational at low confidence so the UI can flag it for AI refinement.
  if (total === 0) {
    return { intent: "informational", confidence: 0, signals: [] };
  }

  return {
    intent: best,
    confidence: Number((bestScore / total).toFixed(3)),
    signals,
  };
}

/** Commercial weighting used by the opportunity score — money intents rank up. */
export function intentValueWeight(intent: Intent): number {
  switch (intent) {
    case "transactional":
      return 1.0;
    case "commercial":
      return 0.8;
    case "navigational":
      return 0.3;
    case "informational":
      return 0.5;
  }
}
