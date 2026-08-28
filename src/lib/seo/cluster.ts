/**
 * Keyword Clustering (PRD §7 module 9).
 *
 * WHY NOT EMBEDDINGS: an embedding pass over 10K keywords is an external API
 * call per batch — metered cost (PRD §6) and non-deterministic across model
 * versions, so the same client report would re-cluster differently next
 * quarter. Lexical clustering with IDF weighting gets most of the way there
 * for keyword data specifically, because keywords are short and share literal
 * head terms by construction. `EmbeddingSimilarity` below is the seam where a
 * vector backend slots in later (PRD §9 mentions pgvector) without the
 * calling code changing.
 *
 * ALGORITHM: greedy leader clustering, seeded highest-volume-first, so the
 * cluster head is the term you would actually target with the pillar page.
 * Candidate generation goes through an inverted token index, so we only score
 * pairs that share a discriminative token instead of all N² pairs.
 */

import type { Intent } from "./intent";
import { tokenize } from "./normalize";

export interface ClusterInputKeyword {
  id: string;
  text: string;
  volume?: number | null;
  difficulty?: number | null;
  intent?: Intent | null;
  /** Classifier confidence 0..1. Weights the cluster's intent vote. */
  intentConfidence?: number | null;
}

export interface ClusterResult {
  name: string;
  intent: Intent | null;
  primaryId: string;
  keywordIds: string[];
  totalVolume: number;
  avgDifficulty: number;
}

export interface ClusterOptions {
  /**
   * 0..1. Higher = tighter, more numerous clusters. 0.34 is tuned to keep
   * "gold ring" and "gold rings for women" together while splitting off
   * "silver necklace".
   */
  threshold?: number;
  /** Clusters smaller than this are merged into an "Ungrouped" bucket. */
  minClusterSize?: number;
}

const DEFAULT_THRESHOLD = 0.34;

/**
 * Inverse document frequency over the keyword set being clustered. Terms that
 * appear in nearly every keyword (the niche noun — "jewellery" in a jewellery
 * project) carry almost no weight, which is exactly right: they are what makes
 * the set a set, not what distinguishes clusters within it.
 */
export function buildIdf(texts: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const text of texts) {
    for (const token of new Set(tokenize(text))) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const n = Math.max(texts.length, 1);
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log(1 + n / count));
  }
  return idf;
}

/**
 * IDF-weighted Jaccard. Shared rare tokens dominate; shared filler does not.
 */
export function weightedSimilarity(
  a: Set<string>,
  b: Set<string>,
  idf: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  let union = 0;
  const seen = new Set<string>();
  for (const token of a) {
    const w = idf.get(token) ?? 1;
    union += w;
    seen.add(token);
    if (b.has(token)) shared += w;
  }
  for (const token of b) {
    if (seen.has(token)) continue;
    union += idf.get(token) ?? 1;
  }
  return union === 0 ? 0 : shared / union;
}

/**
 * Confidence-weighted intent vote.
 *
 * A plain headcount gets this wrong in a way that matters commercially: the
 * classifier defaults unsignalled keywords to "informational" with confidence
 * 0, so a cluster holding four confident "buy ..." terms and six defaulted
 * noun phrases would be labelled informational and quietly demoted in the
 * content plan. Weighting each vote by confidence lets the terms that actually
 * carry a signal decide, and falls back to a headcount only when nothing in
 * the cluster has any signal at all.
 */
function majorityIntent(keywords: ClusterInputKeyword[]): Intent | null {
  const weighted = new Map<Intent, number>();
  const counts = new Map<Intent, number>();

  for (const k of keywords) {
    if (!k.intent) continue;
    counts.set(k.intent, (counts.get(k.intent) ?? 0) + 1);
    const confidence = k.intentConfidence ?? 0;
    if (confidence > 0) {
      weighted.set(k.intent, (weighted.get(k.intent) ?? 0) + confidence);
    }
  }

  const tally = weighted.size > 0 ? weighted : counts;
  let best: Intent | null = null;
  let bestScore = 0;
  for (const [intent, score] of tally) {
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return best;
}

export function clusterKeywords(
  keywords: ClusterInputKeyword[],
  options: ClusterOptions = {},
): ClusterResult[] {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minClusterSize = options.minClusterSize ?? 1;
  if (keywords.length === 0) return [];

  const idf = buildIdf(keywords.map((k) => k.text));
  const tokens = new Map<string, Set<string>>();
  for (const k of keywords) tokens.set(k.id, new Set(tokenize(k.text)));

  // Inverted index: token -> keyword ids containing it.
  const index = new Map<string, string[]>();
  for (const k of keywords) {
    for (const token of tokens.get(k.id) ?? []) {
      const bucket = index.get(token);
      if (bucket) bucket.push(k.id);
      else index.set(token, [k.id]);
    }
  }

  const byId = new Map(keywords.map((k) => [k.id, k]));
  // Highest volume first, so the head term of each cluster is the term worth
  // building the pillar page around. Stable tiebreak on text keeps output
  // deterministic for identical volumes.
  const order = [...keywords].sort(
    (a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.text.localeCompare(b.text),
  );

  const assigned = new Set<string>();
  const clusters: ClusterResult[] = [];

  for (const seed of order) {
    if (assigned.has(seed.id)) continue;
    assigned.add(seed.id);

    const seedTokens = tokens.get(seed.id) ?? new Set();

    // Candidate generation uses an EXACT prefix filter — it prunes work
    // without ever changing which keywords cluster together.
    //
    // Why not the obvious shortcut: an earlier version probed only "rare"
    // tokens (those in under ~60% of the corpus). That silently changed
    // results — "buy gold rings" has exactly one rare token ("buy"), so it
    // could never reach "gold rings" and stranded itself in a singleton.
    //
    // The safe version: similarity is sharedIdf / unionIdf, and the union
    // always contains every seed token, so unionIdf >= seedTotal. For a
    // candidate to reach the threshold it therefore needs
    //     sharedIdf >= threshold * seedTotal.
    // Sort the seed's tokens by descending IDF and take the shortest prefix
    // whose *remaining* suffix sums to less than that bound. Any candidate
    // sharing nothing from the prefix can only share suffix tokens, whose
    // total is below the bound by construction — so it cannot qualify, and
    // skipping it is provably safe rather than merely convenient.
    const ordered = [...seedTokens].sort(
      (a, b) => (idf.get(b) ?? 1) - (idf.get(a) ?? 1),
    );
    const seedTotal = ordered.reduce((sum, t) => sum + (idf.get(t) ?? 1), 0);
    const bound = threshold * seedTotal;

    let suffix = seedTotal;
    const probeTokens: string[] = [];
    for (const token of ordered) {
      if (suffix < bound) break;
      probeTokens.push(token);
      suffix -= idf.get(token) ?? 1;
    }

    const candidates = new Set<string>();
    for (const token of probeTokens) {
      for (const id of index.get(token) ?? []) {
        if (!assigned.has(id)) candidates.add(id);
      }
    }

    const members: ClusterInputKeyword[] = [seed];
    for (const id of candidates) {
      const sim = weightedSimilarity(seedTokens, tokens.get(id) ?? new Set(), idf);
      if (sim >= threshold) {
        assigned.add(id);
        const kw = byId.get(id);
        if (kw) members.push(kw);
      }
    }

    const totalVolume = members.reduce((sum, m) => sum + (m.volume ?? 0), 0);
    const withKd = members.filter((m) => typeof m.difficulty === "number");
    const avgDifficulty =
      withKd.length === 0
        ? 0
        : Number(
            (
              withKd.reduce((sum, m) => sum + (m.difficulty ?? 0), 0) /
              withKd.length
            ).toFixed(1),
          );

    clusters.push({
      name: seed.text,
      intent: majorityIntent(members),
      primaryId: seed.id,
      keywordIds: members.map((m) => m.id),
      totalVolume,
      avgDifficulty,
    });
  }

  if (minClusterSize <= 1) {
    return clusters.sort((a, b) => b.totalVolume - a.totalVolume);
  }

  // Fold undersized clusters into one bucket rather than showing a long tail
  // of singletons the strategist has to scroll past.
  const kept = clusters.filter((c) => c.keywordIds.length >= minClusterSize);
  const orphans = clusters.filter((c) => c.keywordIds.length < minClusterSize);
  if (orphans.length > 0) {
    const ids = orphans.flatMap((c) => c.keywordIds);
    const members = ids.map((id) => byId.get(id)).filter(Boolean) as ClusterInputKeyword[];
    const withKd = members.filter((m) => typeof m.difficulty === "number");
    kept.push({
      name: "Ungrouped",
      intent: majorityIntent(members),
      primaryId: orphans[0].primaryId,
      keywordIds: ids,
      totalVolume: members.reduce((s, m) => s + (m.volume ?? 0), 0),
      avgDifficulty:
        withKd.length === 0
          ? 0
          : Number(
              (
                withKd.reduce((s, m) => s + (m.difficulty ?? 0), 0) / withKd.length
              ).toFixed(1),
            ),
    });
  }
  return kept.sort((a, b) => b.totalVolume - a.totalVolume);
}
