/**
 * Long-Tail Finder and Question Finder (PRD §7 modules 7 and 8).
 *
 * Both are filters over an already-discovered keyword set rather than
 * separate upstream calls — that matters for cost (PRD §6): one Keyword Ideas
 * call feeds discovery, long-tail and questions at once instead of three.
 */

import { QUESTION_WORDS, normalizeText, words, wordCount } from "./normalize";

/** Phrases that make a keyword a question without a leading question word. */
const EMBEDDED_QUESTION_MARKERS = [
  "how to", "how much", "how many", "how long", "how often", "what is",
  "what are", "why is", "why do", "when to", "where to", "which is",
  "difference between", "vs",
];

export function isQuestion(keyword: string): boolean {
  if (keyword.includes("?")) return true;
  const normalized = normalizeText(keyword);
  const tokens = words(keyword);
  if (tokens.length === 0) return false;

  // Leading interrogative: "does gold tarnish", "can you resize a ring".
  if (QUESTION_WORDS.has(tokens[0])) return true;

  return EMBEDDED_QUESTION_MARKERS.some(
    (m) => normalized.startsWith(`${m} `) || normalized.includes(` ${m} `),
  );
}

/**
 * Long-tail threshold. Three words is the conventional cut-off in SEO
 * practice; exposed as a parameter because it genuinely varies by vertical
 * (local queries run long, B2B SaaS terms run short).
 */
export const DEFAULT_LONG_TAIL_MIN_WORDS = 4;

export function isLongTail(
  keyword: string,
  minWords = DEFAULT_LONG_TAIL_MIN_WORDS,
): boolean {
  return wordCount(keyword) >= minWords;
}

/**
 * Groups questions by their interrogative so the UI can render the
 * "How / What / Why / Where" accordion that content strategists expect.
 */
export function groupQuestionsByType(
  keywords: string[],
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const keyword of keywords) {
    if (!isQuestion(keyword)) continue;
    const tokens = words(keyword);
    const lead = tokens[0] ?? "";
    const key = QUESTION_WORDS.has(lead) ? lead : "other";
    (groups[key] ??= []).push(keyword);
  }
  return groups;
}
