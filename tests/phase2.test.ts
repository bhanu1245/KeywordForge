import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockKeywordProvider } from "../src/lib/providers/mock.ts";
import { normaliseDomain } from "../src/lib/competitors/service.ts";
import { buildHeuristicTopicMap } from "../src/lib/ai/topicMap.ts";
import { buildHeuristicSeeds } from "../src/lib/ai/keywordGenerator.ts";
import type { ClusterView } from "../src/lib/types.ts";

const market = { language: "en", location: "United States" };

describe("mock SERP supports competitor analysis", () => {
  /**
   * The regression that would silently break every gap feature: if domains do
   * not recur across a project's keywords, competitor overlap is always zero
   * and the panels look broken rather than empty.
   */
  it("returns the same domains across different keywords", async () => {
    const p = new MockKeywordProvider();
    const a = await p.serp({ ...market, keyword: "gold rings" });
    const b = await p.serp({ ...market, keyword: "silver necklace" });

    const setA = new Set(a.data.results.map((r) => r.domain));
    const setB = new Set(b.data.results.map((r) => r.domain));
    const shared = [...setA].filter((d) => setB.has(d));

    assert.ok(shared.length >= 5, `only ${shared.length} shared domains`);
  });

  it("gives a domain the same authority in every SERP it appears in", async () => {
    const p = new MockKeywordProvider();
    const a = await p.serp({ ...market, keyword: "gold rings" });
    const b = await p.serp({ ...market, keyword: "silver necklace" });

    const strengthIn = (results: typeof a.data.results, domain: string) =>
      results.find((r) => r.domain === domain)?.domainStrength;

    for (const r of a.data.results) {
      const other = strengthIn(b.data.results, r.domain);
      if (other === undefined) continue;
      assert.equal(other, r.domainStrength, `${r.domain} authority differs between SERPs`);
    }
  });

  it("never repeats a domain within one SERP", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.serp({ ...market, keyword: "gold rings", depth: 10 });
    const domains = data.results.map((r) => r.domain);
    assert.equal(domains.length, new Set(domains).size);
  });

  it("is deterministic per keyword", async () => {
    const p = new MockKeywordProvider();
    const a = await p.serp({ ...market, keyword: "gold rings" });
    const b = await p.serp({ ...market, keyword: "gold rings" });
    assert.deepEqual(a.data, b.data);
  });
});

describe("normaliseDomain", () => {
  it("strips scheme, www and path so the same site is one domain", () => {
    for (const input of [
      "https://www.Example.com/pricing",
      "http://example.com",
      "www.example.com",
      "  EXAMPLE.com  ",
    ]) {
      assert.equal(normaliseDomain(input), "example.com");
    }
  });
});

describe("buildHeuristicTopicMap", () => {
  const cluster = (id: string, name: string, volume: number): ClusterView => ({
    id,
    name,
    intent: "informational",
    totalVolume: volume,
    avgDifficulty: 30,
    keywordCount: 5,
    keywords: [],
  });

  it("returns an empty map for no clusters", () => {
    const map = buildHeuristicTopicMap([]);
    assert.deepEqual(map.pillars, []);
    assert.equal(map.generatedBy, "heuristic");
  });

  it("makes the highest-volume clusters the pillars", () => {
    const map = buildHeuristicTopicMap([
      cluster("1", "gold rings", 50_000),
      cluster("2", "gold rings for women", 900),
      cluster("3", "cheap gold rings", 800),
    ]);
    assert.equal(map.pillars[0].targetKeyword, "gold rings");
  });

  it("attaches related clusters to the pillar they share terms with", () => {
    const map = buildHeuristicTopicMap([
      cluster("1", "gold rings", 50_000),
      cluster("2", "gold rings for women", 900),
      cluster("3", "gold rings uk", 700),
    ]);
    const pillar = map.pillars[0];
    assert.ok(pillar.supporting.length >= 1);
    assert.ok(pillar.totalVolume > 50_000, "supporting volume must roll up");
  });

  it("promotes a genuinely unrelated topic to its own pillar", () => {
    const map = buildHeuristicTopicMap([
      cluster("1", "gold rings", 50_000),
      cluster("2", "gold rings uk", 900),
      cluster("3", "zebra migration patterns", 800),
    ]);
    // "gold rings uk" supports the gold pillar; the zebra topic shares nothing
    // with it, so burying it under "gold rings" would create internal links
    // between unrelated pages. It earns a pillar of its own.
    const zebra = map.pillars.find((p) => p.targetKeyword === "zebra migration patterns");
    assert.ok(zebra, `expected a zebra pillar, got ${map.pillars.map((p) => p.targetKeyword).join(", ")}`);
    const gold = map.pillars.find((p) => p.targetKeyword === "gold rings");
    assert.ok(gold?.supporting.some((s) => s.clusterId === "2"));
  });

  /**
   * Regression: pillar count used to be derived from cluster count
   * (one per five), so a project seeded from a single term produced six
   * pillars — one holding everything and five completely empty.
   */
  it("yields ONE pillar when every cluster is the same topic", () => {
    const clusters = [
      cluster("1", "emergency dentist", 40_000),
      cluster("2", "emergency dentist near me", 9_000),
      cluster("3", "emergency dentist cost", 7_000),
      cluster("4", "emergency dentist weekend", 5_000),
      cluster("5", "emergency dentist appointment", 4_000),
      cluster("6", "affordable emergency dentist", 3_000),
      cluster("7", "local emergency dentist", 2_000),
      cluster("8", "24 hour emergency dentist", 1_000),
    ];
    const map = buildHeuristicTopicMap(clusters);
    assert.equal(map.pillars.length, 1, `expected 1 pillar, got ${map.pillars.length}`);
    assert.equal(map.pillars[0].supporting.length, 7);
    assert.equal(map.orphans.length, 0);
  });

  it("yields several pillars for genuinely distinct topics", () => {
    const map = buildHeuristicTopicMap([
      cluster("1", "gold rings", 9_000),
      cluster("2", "silver necklaces", 8_000),
      cluster("3", "leather handbags", 7_000),
      cluster("4", "wedding invitations", 6_000),
    ]);
    assert.equal(map.pillars.length, 4);
  });

  it("never places a cluster under two pillars", () => {
    const clusters = Array.from({ length: 30 }, (_, i) =>
      cluster(String(i), `topic${i % 6} variant ${i}`, 1000 - i),
    );
    const map = buildHeuristicTopicMap(clusters);
    const all = map.pillars.flatMap((p) => p.clusterIds);
    assert.equal(all.length, new Set(all).size);
  });
});

describe("buildHeuristicSeeds", () => {
  it("extracts multi-word topics from headings", () => {
    const seeds = buildHeuristicSeeds(
      "Family dental practice offering dental implants and teeth whitening.",
      ["Dental implants in Bristol", "Teeth whitening prices", "Dental implants cost"],
    );
    assert.ok(seeds.length > 0);
    assert.ok(
      seeds.some((s) => s.includes("dental implants")),
      `expected a dental implants seed, got ${JSON.stringify(seeds)}`,
    );
  });

  /**
   * Regression: the n-gram window used to slide across conjunctions, emitting
   * plausible-looking nonsense like "whitening and emergency" or
   * "appointments for children" as seed keywords.
   */
  it("never produces a seed containing a connector or stopword", () => {
    const banned = [
      "and", "or", "for", "with", "in", "at", "on", "of", "to", "from", "by",
      "the", "a", "an", "is", "are", "we", "our", "your", "offering",
    ];
    const seeds = buildHeuristicSeeds(
      "Family dental practice in Bristol offering dental implants, teeth whitening and emergency dentist appointments for children and adults.",
      ["We are the best provider of the services in the region"],
    );
    assert.ok(seeds.length > 0);
    for (const s of seeds) {
      for (const word of s.split(" ")) {
        assert.ok(!banned.includes(word), `seed "${s}" contains "${word}"`);
      }
    }
  });

  it("keeps real noun phrases from a business description", () => {
    const seeds = buildHeuristicSeeds(
      "Family dental practice in Bristol offering dental implants, teeth whitening and emergency dentist appointments.",
    );
    for (const expected of ["dental implants", "teeth whitening"]) {
      assert.ok(
        seeds.includes(expected),
        `expected "${expected}" in ${JSON.stringify(seeds)}`,
      );
    }
  });

  it("returns something usable for very short input", () => {
    assert.ok(buildHeuristicSeeds("emergency plumber London").length > 0);
  });

  it("returns an empty list rather than throwing on empty input", () => {
    assert.deepEqual(buildHeuristicSeeds(""), []);
  });
});
