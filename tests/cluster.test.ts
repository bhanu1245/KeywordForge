import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIdf,
  clusterKeywords,
  weightedSimilarity,
  type ClusterInputKeyword,
} from "../src/lib/seo/cluster.ts";
import { tokenSet } from "../src/lib/seo/normalize.ts";

function kw(id: string, text: string, volume = 100): ClusterInputKeyword {
  return { id, text, volume, difficulty: 30, intent: "informational" };
}

describe("weightedSimilarity", () => {
  it("scores identical token sets as 1", () => {
    const idf = buildIdf(["gold ring", "gold ring"]);
    const sim = weightedSimilarity(tokenSet("gold ring"), tokenSet("gold rings"), idf);
    assert.equal(sim, 1);
  });

  it("scores disjoint sets as 0", () => {
    const idf = buildIdf(["gold ring", "silver necklace"]);
    const sim = weightedSimilarity(tokenSet("gold ring"), tokenSet("silver necklace"), idf);
    assert.equal(sim, 0);
  });

  it("discounts tokens shared by the whole corpus", () => {
    // "jewellery" is in every phrase, so agreeing on it should count for
    // almost nothing compared with agreeing on "gold".
    const corpus = [
      "gold jewellery",
      "silver jewellery",
      "vintage jewellery",
      "gold jewellery uk",
    ];
    const idf = buildIdf(corpus);
    const sharedFiller = weightedSimilarity(
      tokenSet("silver jewellery"),
      tokenSet("vintage jewellery"),
      idf,
    );
    const sharedSignal = weightedSimilarity(
      tokenSet("gold jewellery"),
      tokenSet("gold jewellery uk"),
      idf,
    );
    assert.ok(sharedSignal > sharedFiller, `signal=${sharedSignal} filler=${sharedFiller}`);
  });
});

describe("clusterKeywords", () => {
  it("returns nothing for an empty set", () => {
    assert.deepEqual(clusterKeywords([]), []);
  });

  it("groups morphological variants together", () => {
    const input = [
      kw("1", "gold ring", 5000),
      kw("2", "gold rings", 3000),
      kw("3", "buying gold rings", 900),
    ];
    const clusters = clusterKeywords(input);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].keywordIds.length, 3);
  });

  it("separates genuinely different topics", () => {
    const input = [
      kw("1", "gold ring", 5000),
      kw("2", "gold rings for women", 2000),
      kw("3", "silver necklace", 4000),
      kw("4", "silver necklaces for men", 1500),
    ];
    const clusters = clusterKeywords(input);
    assert.equal(clusters.length, 2);
    const names = clusters.map((c) => c.name).sort();
    assert.deepEqual(names, ["gold ring", "silver necklace"]);
  });

  it("names each cluster after its highest-volume member", () => {
    const input = [
      kw("1", "cheap gold rings", 100),
      kw("2", "gold rings", 9000),
      kw("3", "gold rings uk", 400),
    ];
    const [cluster] = clusterKeywords(input);
    assert.equal(cluster.name, "gold rings");
    assert.equal(cluster.primaryId, "2");
  });

  it("assigns every keyword exactly once", () => {
    const input = Array.from({ length: 60 }, (_, i) =>
      kw(String(i), `${i % 5 === 0 ? "gold" : "silver"} item ${i % 7} variant`, i * 10),
    );
    const clusters = clusterKeywords(input);
    const seen = clusters.flatMap((c) => c.keywordIds);
    assert.equal(seen.length, new Set(seen).size, "a keyword appeared in two clusters");
    assert.equal(seen.length, input.length, "a keyword was dropped");
  });

  it("rolls up volume and average difficulty per cluster", () => {
    const input = [
      { id: "1", text: "gold ring", volume: 1000, difficulty: 40, intent: "commercial" as const },
      { id: "2", text: "gold rings", volume: 500, difficulty: 20, intent: "commercial" as const },
    ];
    const [cluster] = clusterKeywords(input);
    assert.equal(cluster.totalVolume, 1500);
    assert.equal(cluster.avgDifficulty, 30);
    assert.equal(cluster.intent, "commercial");
  });

  it("folds singletons into an Ungrouped bucket when asked", () => {
    const input = [
      kw("1", "gold ring", 5000),
      kw("2", "gold rings", 3000),
      kw("3", "completely unrelated topic", 10),
    ];
    const clusters = clusterKeywords(input, { minClusterSize: 2 });
    const ungrouped = clusters.find((c) => c.name === "Ungrouped");
    assert.ok(ungrouped, "expected an Ungrouped bucket");
    assert.deepEqual(ungrouped.keywordIds, ["3"]);
  });

  it("is deterministic across runs", () => {
    const input = [
      kw("1", "gold ring", 100),
      kw("2", "silver ring", 100),
      kw("3", "gold necklace", 100),
    ];
    const a = JSON.stringify(clusterKeywords(input));
    const b = JSON.stringify(clusterKeywords(input));
    assert.equal(a, b);
  });

  it("handles 5000 keywords without quadratic blow-up", () => {
    const input = Array.from({ length: 5000 }, (_, i) =>
      kw(String(i), `topic${i % 250} keyword variant ${i}`, i),
    );
    const started = Date.now();
    const clusters = clusterKeywords(input);
    const elapsed = Date.now() - started;
    assert.ok(clusters.length > 0);
    // Generous ceiling — the point is to catch an accidental O(n^2) rewrite.
    assert.ok(elapsed < 10_000, `clustering 5000 keywords took ${elapsed}ms`);
  });
});
