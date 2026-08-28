/**
 * Text normalisation shared by intent classification, clustering and
 * question detection. Deliberately dependency-free and deterministic — the
 * same keyword must always normalise the same way, or cached intent and
 * cluster assignments would drift between runs.
 */

/**
 * Stopwords are removed before clustering so that "how to clean a gold ring"
 * and "cleaning gold rings" collide on {clean, gold, ring}. Kept small on
 * purpose: aggressive stopword lists destroy short head terms.
 */
export const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "in", "into", "is", "it", "of", "on", "or", "that", "the", "their",
  "there", "to", "was", "were", "will", "with", "your", "you",
]);

/** Question leaders, used by both intent and the Question Finder module. */
export const QUESTION_WORDS = new Set([
  "how", "what", "why", "when", "where", "who", "which", "whose", "whom",
  "can", "do", "does", "did", "is", "are", "should", "will", "would",
]);

/**
 * Folds accents on Latin text ("café" -> "cafe") WITHOUT destroying scripts
 * that depend on combining marks to spell words at all.
 *
 * The naive version — decompose to NFKD and strip every combining mark —
 * silently mangles Devanagari, Arabic, Thai and others, where vowel signs are
 * combining marks carrying real meaning: "जूते" would become "जत". So marks
 * are dropped only when the base character they attach to is Latin.
 */
function foldLatinDiacritics(input: string): string {
  const decomposed = input.normalize("NFD");
  let out = "";
  let baseIsLatin = false;
  for (const ch of decomposed) {
    if (/\p{M}/u.test(ch)) {
      if (!baseIsLatin) out += ch;
      continue;
    }
    baseIsLatin = /\p{Script=Latin}/u.test(ch);
    out += ch;
  }
  return out.normalize("NFC");
}

/**
 * Lowercase, strip punctuation, collapse whitespace.
 *
 * Letters, digits and combining marks from ANY script are preserved. An
 * earlier version kept only `[a-z0-9]`, which erased non-Latin keywords to an
 * empty string — that silently dropped every row of a non-English bulk import
 * rather than failing loudly, so it is guarded by tests now.
 */
export function normalizeText(input: string): string {
  return foldLatinDiacritics(input)
    .toLowerCase()
    // Keep intra-word apostrophes out of the way ("women's" -> "womens").
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, " ")
    .replace(/[-\s]+/g, " ")
    .trim();
}

/**
 * A light suffix stemmer. Not Porter — Porter over-stems short commercial
 * terms ("ring" -> "r" style collapses in naive implementations) and we only
 * need plural/gerund folding to make clustering work.
 */
export function stem(token: string): string {
  let t = token;
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith("sses")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("ses")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) {
    t = t.slice(0, -1);
  }
  if (t.length > 5 && t.endsWith("ing")) {
    const base = t.slice(0, -3);
    // "running" -> "run", not "runn"
    t = /(.)\1$/.test(base) ? base.slice(0, -1) : base;
  } else if (t.length > 5 && t.endsWith("ed")) {
    t = t.slice(0, -2);
  }
  return t;
}

/** Raw word list, stopwords and stemming left intact. */
export function words(input: string): string[] {
  const n = normalizeText(input);
  return n.length === 0 ? [] : n.split(" ");
}

/** Content tokens: stopwords dropped, everything stemmed. */
export function tokenize(input: string): string[] {
  return words(input)
    .filter((w) => !STOPWORDS.has(w))
    .map(stem)
    .filter((w) => w.length > 0);
}

/** Deduplicated content tokens, for set-similarity work. */
export function tokenSet(input: string): Set<string> {
  return new Set(tokenize(input));
}

/** Word count on the raw phrase — long-tail detection counts stopwords. */
export function wordCount(input: string): number {
  return words(input).length;
}
