import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIdf,
  clusterKeywords,
  weightedSimilarity,
  type ClusterInputKeyword,
} from "../src/lib/seo/cluster.ts";
import { tokenSet } from "../src/lib/seo/normalize.ts";

/**
 * Regression cover for the confidence-weighted intent vote. A plain headcount
 * labelled clusters "informational" purely because unsignalled keywords
 * default there, which demotes money clusters in the content plan.
 *
 * These use identical keyword text on purpose: the subject under test is the
 * voting rule, not the similarity threshold, so every row must land in one
 * cluster regardless of how tightness is tuned.
 */
describe("cluster intent voting", () => {
  const row = (
    id: string,
    intent: ClusterInputKeyword["intent"],
    intentConfidence: number,
  ): ClusterInputKeyword => ({
    id,
    text: "gold rings",
    volume: 100,
    difficulty: 30,
    intent,
    intentConfidence,
  });

  it("lets confident signals outvote defaulted informational labels", () => {
    const input = [
      row("1", "transactional", 1),
      row("2", "transactional", 1),
      // Four defaulted rows that a plain headcount would let win.
      row("3", "informational", 0),
      row("4", "informational", 0),
      row("5", "informational", 0),
      row("6", "informational", 0),
    ];
    const clusters = clusterKeywords(input);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].keywordIds.length, 6);
    assert.equal(clusters[0].intent, "transactional");
  });

  it("falls back to a headcount when nothing carries a signal", () => {
    const clusters = clusterKeywords([
      row("1", "informational", 0),
      row("2", "informational", 0),
      row("3", "commercial", 0),
    ]);
    assert.equal(clusters[0].intent, "informational");
  });

  it("still returns null when no member has any intent at all", () => {
    const clusters = clusterKeywords([
      { id: "1", text: "gold rings", volume: 300, difficulty: 30 },
      { id: "2", text: "gold rings", volume: 200, difficulty: 30 },
    ]);
    assert.equal(clusters[0].intent, null);
  });
});

describe("candidate prefix filter", () => {
  it("still reaches relatives when the seed's only rare token is unique", () => {
    // The exact case a naive 'probe only rare tokens' prune got wrong:
    // "buy" is unique, so probing rare tokens alone stranded this seed.
    const clusters = clusterKeywords([
      { id: "1", text: "buy gold rings", volume: 500, difficulty: 30 },
      { id: "2", text: "gold rings", volume: 300, difficulty: 30 },
      { id: "3", text: "gold ring", volume: 200, difficulty: 30 },
    ]);
    const withSeed = clusters.find((c) => c.keywordIds.includes("1"));
    assert.ok(withSeed);
    assert.ok(
      withSeed.keywordIds.includes("2"),
      `"buy gold rings" must cluster with "gold rings", got ${JSON.stringify(clusters)}`,
    );
  });

  /**
   * The filter is an optimisation, so it must produce byte-identical output to
   * the unpruned algorithm. This runs a brute-force leader clustering over the
   * same input and asserts the groupings match exactly.
   */
  it("produces identical clusters to an unpruned brute-force pass", () => {
    const vocab = ["gold", "silver", "ring", "rings", "necklace", "cheap", "buy", "best", "uk", "womens"];
    // Deterministic pseudo-random corpus — no dependence on Math.random.
    let s = 12345;
    const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;

    const input: ClusterInputKeyword[] = Array.from({ length: 300 }, (_, i) => {
      const len = 2 + Math.floor(rand() * 3);
      const words = Array.from(
        { length: len },
        () => vocab[Math.floor(rand() * vocab.length)],
      );
      return { id: String(i), text: words.join(" "), volume: Math.floor(rand() * 5000) };
    });

    const threshold = 0.34;
    const idf = buildIdf(input.map((k) => k.text));
    const sets = new Map(input.map((k) => [k.id, tokenSet(k.text)]));
    const order = [...input].sort(
      (a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.text.localeCompare(b.text),
    );

    const assigned = new Set<string>();
    const expected: string[][] = [];
    for (const seed of order) {
      if (assigned.has(seed.id)) continue;
      assigned.add(seed.id);
      const members = [seed.id];
      for (const other of order) {
        if (assigned.has(other.id)) continue;
        const sim = weightedSimilarity(
          sets.get(seed.id)!,
          sets.get(other.id)!,
          idf,
        );
        if (sim >= threshold) {
          assigned.add(other.id);
          members.push(other.id);
        }
      }
      expected.push(members);
    }

    const actual = clusterKeywords(input, { threshold });
    const norm = (groups: string[][]) =>
      groups.map((g) => [...g].sort()).sort((a, b) => a[0].localeCompare(b[0]));

    assert.deepEqual(
      norm(actual.map((c) => c.keywordIds)),
      norm(expected),
      "prefix filter changed clustering results",
    );
  });
});
