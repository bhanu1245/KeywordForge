import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MONTHS,
  describeSeasonality,
  detectSeasonality,
  detectTrend,
} from "../src/lib/seo/trends.ts";
import { hasLocalIntent } from "../src/lib/local/service.ts";
import { getChannelProfile } from "../src/lib/providers/channels.ts";
import { MockKeywordProvider } from "../src/lib/providers/mock.ts";

const market = { language: "en", location: "United States" };

/** 12 flat months. */
const flat = () => new Array(12).fill(1);

describe("detectTrend", () => {
  it("treats a short or missing series as stable rather than guessing", () => {
    for (const s of [null, undefined, [], [1, 2, 3]]) {
      const r = detectTrend(s as number[] | null);
      assert.equal(r.direction, "stable");
      assert.equal(r.strength, 0);
    }
  });

  it("calls a flat series stable", () => {
    assert.equal(detectTrend(flat()).direction, "stable");
  });

  it("detects a rising quarter", () => {
    const series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2];
    const r = detectTrend(series);
    assert.equal(r.direction, "rising");
    assert.ok(r.changePercent > 50, `change was ${r.changePercent}`);
  });

  it("detects a falling quarter", () => {
    const series = [2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1];
    const r = detectTrend(series);
    assert.equal(r.direction, "falling");
    assert.ok(r.changePercent < -40);
  });

  /**
   * Movement under 10% is inside the noise floor of relative monthly volume.
   * Reporting it would fill the UI with arrows that mean nothing.
   */
  it("treats sub-10% movement as noise, not a trend", () => {
    const series = [...flat().slice(0, 9), 1.05, 1.05, 1.05];
    const r = detectTrend(series);
    assert.equal(r.direction, "stable");
  });

  /**
   * Regression guard for the naive first-vs-last comparison: a purely seasonal
   * series returns to its starting level, and must not read as a trend.
   */
  it("does not report a trend for a full seasonal cycle", () => {
    const seasonal = Array.from({ length: 12 }, (_, i) => 1 + 0.5 * Math.sin((i / 12) * Math.PI * 2));
    const r = detectTrend(seasonal);
    assert.ok(
      Math.abs(r.changePercent) < 60,
      `a seasonal cycle should not look like a strong trend, got ${r.changePercent}%`,
    );
  });

  it("caps strength at 1", () => {
    const series = [...flat().slice(0, 9), 50, 50, 50];
    assert.ok(detectTrend(series).strength <= 1);
  });
});

describe("detectSeasonality", () => {
  it("needs a full year before deciding", () => {
    assert.equal(detectSeasonality([1, 2, 3]).isSeasonal, false);
    assert.equal(detectSeasonality(null).isSeasonal, false);
  });

  it("calls a flat series evergreen", () => {
    const r = detectSeasonality(flat());
    assert.equal(r.isSeasonal, false);
    assert.deepEqual(r.peakMonths, []);
  });

  it("flags a Christmas spike and names the peak months", () => {
    // Low all year, big spike in Nov/Dec.
    const series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1.2, 3.5, 4];
    const r = detectSeasonality(series);
    assert.equal(r.isSeasonal, true);
    assert.ok(r.peakLabels.includes("Nov"), `got ${r.peakLabels.join(",")}`);
    assert.ok(r.peakLabels.includes("Dec"), `got ${r.peakLabels.join(",")}`);
    assert.ok(r.peakMultiple > 2);
  });

  it("does not flag mild variation as seasonal", () => {
    const series = [1, 1.05, 0.95, 1, 1.02, 0.98, 1, 1.03, 0.97, 1, 1.01, 0.99];
    assert.equal(detectSeasonality(series).isSeasonal, false);
  });

  it("reports at most three peak months", () => {
    const series = [3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1];
    assert.ok(detectSeasonality(series).peakMonths.length <= 3);
  });

  it("keeps peak months inside the calendar", () => {
    const series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 4];
    for (const m of detectSeasonality(series).peakMonths) {
      assert.ok(m >= 0 && m < 12, `month index ${m} out of range`);
      assert.ok(MONTHS[m]);
    }
  });

  it("summarises for the UI", () => {
    assert.equal(describeSeasonality(detectSeasonality(flat())), "Evergreen");
    const summer = detectSeasonality([1, 1, 1, 1, 1, 3, 3.5, 3, 1, 1, 1, 1]);
    assert.match(describeSeasonality(summer), /^Seasonal — peaks /);
  });
});

describe("hasLocalIntent", () => {
  it("detects local modifiers", () => {
    for (const kw of [
      "emergency dentist near me",
      "plumber open now",
      "best salon nearby",
      "locksmith in my area",
    ]) {
      assert.equal(hasLocalIntent(kw), true, kw);
    }
  });

  it("does not fire on non-local phrases", () => {
    for (const kw of ["how to clean gold rings", "project management software pricing"]) {
      assert.equal(hasLocalIntent(kw), false, kw);
    }
  });

  it("does not split multi-word modifiers", () => {
    // "near" and "me" separately must not trigger "near me".
    assert.equal(hasLocalIntent("near sighted meaning"), false);
  });
});

describe("channel-specific keyword generation", () => {
  it("scales volume and CPC per surface", () => {
    assert.ok(getChannelProfile("youtube").volumeScale < 1);
    assert.ok(getChannelProfile("amazon").cpcScale > getChannelProfile("youtube").cpcScale);
  });

  it("gives YouTube video-shaped modifiers, not retail ones", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 120, channel: "youtube" });
    const texts = data.map((k) => k.text);
    assert.ok(texts.some((t) => t.includes("tutorial") || t.includes("unboxing") || t.includes("review")));
    for (const t of texts) {
      assert.ok(!t.includes("free shipping"), `YouTube produced retail modifier: ${t}`);
      assert.ok(!t.includes("near me"), `YouTube produced local modifier: ${t}`);
    }
  });

  it("gives Amazon marketplace modifiers and no how-to queries", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 120, channel: "amazon" });
    const texts = data.map((k) => k.text);
    assert.ok(texts.some((t) => t.includes("prime") || t.includes("bestseller") || t.includes("pack")));
    for (const t of texts) {
      assert.ok(!t.startsWith("how to"), `Amazon produced a how-to query: ${t}`);
    }
  });

  it("gives Google Maps local modifiers", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "dentist", limit: 120, channel: "google_maps" });
    assert.ok(data.some((k) => k.text.includes("near me") || k.text.includes("open now")));
  });

  /**
   * Channel is part of corpus identity, not a display filter — the same phrase
   * must carry genuinely different numbers per surface.
   */
  it("returns different volumes for the same seed on different channels", async () => {
    const p = new MockKeywordProvider();
    const google = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 20 });
    const amazon = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 20, channel: "amazon" });
    assert.notDeepEqual(
      google.data.map((k) => k.volume),
      amazon.data.map((k) => k.volume),
    );
  });

  it("stays deterministic per channel", async () => {
    const p = new MockKeywordProvider();
    const a = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 20, channel: "youtube" });
    const b = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 20, channel: "youtube" });
    assert.deepEqual(a.data, b.data);
  });
});
