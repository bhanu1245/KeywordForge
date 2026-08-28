import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commercialValue,
  ctrForPosition,
  difficultyBand,
  keywordDifficulty,
  opportunityScore,
  trafficPotential,
  volumeScore,
} from "../src/lib/seo/scoring.ts";

describe("keywordDifficulty", () => {
  it("stays within 0..100 for extreme inputs", () => {
    const high = keywordDifficulty({
      keyword: "insurance",
      volume: 5_000_000,
      competition: 1,
      serpStrength: 100,
    });
    const low = keywordDifficulty({
      keyword: "how to clean a vintage silver charm bracelet at home",
      volume: 0,
      competition: 0,
      serpStrength: 0,
    });
    assert.ok(high >= 0 && high <= 100, `high=${high}`);
    assert.ok(low >= 0 && low <= 100, `low=${low}`);
    assert.ok(high > low);
  });

  it("rates long-tail phrases easier than head terms at equal competition", () => {
    const head = keywordDifficulty({ keyword: "jewellery", volume: 1000, competition: 0.5 });
    const tail = keywordDifficulty({
      keyword: "handmade silver jewellery for sensitive skin",
      volume: 1000,
      competition: 0.5,
    });
    assert.ok(tail < head, `tail=${tail} head=${head}`);
  });

  it("treats a strong SERP as harder than a weak one", () => {
    const base = { keyword: "gold rings", volume: 5000, competition: 0.4 };
    const weak = keywordDifficulty({ ...base, serpStrength: 10 });
    const strong = keywordDifficulty({ ...base, serpStrength: 90 });
    assert.ok(strong > weak, `strong=${strong} weak=${weak}`);
  });

  it("handles missing volume and competition without producing NaN", () => {
    const kd = keywordDifficulty({ keyword: "gold rings", volume: null, competition: null });
    assert.ok(Number.isFinite(kd));
    assert.ok(kd >= 0 && kd <= 100);
  });

  it("bands scores for the UI", () => {
    assert.equal(difficultyBand(5), "easy");
    assert.equal(difficultyBand(30), "medium");
    assert.equal(difficultyBand(55), "hard");
    assert.equal(difficultyBand(85), "very hard");
  });
});

describe("volumeScore", () => {
  it("is log-scaled and clamped to 0..1", () => {
    assert.equal(volumeScore(0), 0);
    assert.equal(volumeScore(null), 0);
    assert.equal(volumeScore(100_000), 1);
    assert.equal(volumeScore(10_000_000), 1);
    assert.ok(volumeScore(1000) > volumeScore(100));
  });
});

describe("traffic and value", () => {
  it("uses a decaying CTR curve", () => {
    assert.ok(ctrForPosition(1) > ctrForPosition(2));
    assert.ok(ctrForPosition(2) > ctrForPosition(10));
    assert.equal(ctrForPosition(0), 0);
    assert.ok(ctrForPosition(50) > 0);
  });

  it("derives traffic potential from volume and position", () => {
    assert.equal(trafficPotential(0), 0);
    assert.ok(trafficPotential(10_000, 1) > trafficPotential(10_000, 5));
  });

  it("values traffic at the CPC that would have been paid for it", () => {
    assert.equal(commercialValue(1000, 0), 0);
    assert.equal(commercialValue(0, 5), 0);
    const value = commercialValue(10_000, 2.5, 1);
    // 10000 * 0.28 CTR * $2.50
    assert.equal(value, 7000);
  });
});

describe("opportunityScore", () => {
  it("prefers a bigger, winnable, commercial keyword", () => {
    const good = opportunityScore({ volume: 8000, difficulty: 20, intent: "transactional" });
    const bad = opportunityScore({ volume: 40, difficulty: 85, intent: "navigational" });
    assert.ok(good > bad, `good=${good} bad=${bad}`);
  });

  it("does not let a zero-volume keyword beat a high-volume one on ease alone", () => {
    const tiny = opportunityScore({ volume: 10, difficulty: 0, intent: "informational" });
    const real = opportunityScore({ volume: 10_000, difficulty: 30, intent: "informational" });
    assert.ok(real > tiny, `real=${real} tiny=${tiny}`);
  });

  it("stays within 0..100", () => {
    const max = opportunityScore({ volume: 10_000_000, difficulty: 0, intent: "transactional" });
    const min = opportunityScore({ volume: 0, difficulty: 100, intent: "navigational" });
    assert.ok(max <= 100 && min >= 0);
  });
});
