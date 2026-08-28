import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockKeywordProvider } from "../src/lib/providers/mock.ts";
import { buildCsv } from "../src/lib/export/index.ts";
import type { KeywordRow } from "../src/lib/keywords/service.ts";

const market = { language: "en", location: "United States" };

describe("MockKeywordProvider", () => {
  it("is deterministic for the same query", async () => {
    const p = new MockKeywordProvider();
    const a = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 50 });
    const b = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 50 });
    assert.deepEqual(a.data, b.data);
  });

  it("varies by market so location actually matters", async () => {
    const p = new MockKeywordProvider();
    const us = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 20 });
    const uk = await p.keywordIdeas({
      seed: "gold rings",
      limit: 20,
      language: "en",
      location: "United Kingdom",
    });
    assert.notDeepEqual(
      us.data.map((k) => k.volume),
      uk.data.map((k) => k.volume),
    );
  });

  it("returns ideas sorted by volume, capped at the limit", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 25 });
    assert.ok(data.length > 0 && data.length <= 25);
    for (let i = 1; i < data.length; i++) {
      assert.ok((data[i - 1].volume ?? 0) >= (data[i].volume ?? 0));
    }
  });

  it("produces plausible ranges for every field", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "gold rings", limit: 60 });
    for (const k of data) {
      assert.ok((k.volume ?? 0) >= 0, `volume ${k.volume}`);
      assert.ok((k.cpc ?? 0) >= 0, `cpc ${k.cpc}`);
      assert.ok((k.competition ?? 0) >= 0 && (k.competition ?? 0) <= 1);
      assert.equal(k.trend?.length, 12);
      assert.equal(k.text, k.text.toLowerCase());
    }
  });

  it("bills volume lookups per keyword, not per request", async () => {
    const p = new MockKeywordProvider();
    const res = await p.searchVolume({ ...market, keywords: ["gold ring", "silver ring"] });
    assert.equal(res.unitsConsumed, 2);
    assert.equal(res.data.length, 2);
  });

  it("returns a SERP with descending authority and valid positions", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.serp({ ...market, keyword: "gold rings", depth: 10 });
    assert.equal(data.results.length, 10);
    assert.deepEqual(
      data.results.map((r) => r.position),
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    const top = data.results[0].domainStrength ?? 0;
    const bottom = data.results[9].domainStrength ?? 0;
    assert.ok(top > bottom, `top=${top} bottom=${bottom}`);
    assert.equal(new Set(data.features).size, data.features.length);
  });
});

describe("buildCsv", () => {
  const row: KeywordRow = {
    projectKeywordId: "pk1",
    keywordId: "k1",
    text: 'gold "signet" rings, uk',
    volume: 1000,
    cpc: 2.5,
    competition: 0.4,
    difficulty: 35,
    intent: "commercial",
    intentConfidence: 1,
    channel: "google",
    trendDirection: "stable",
    trendChangePercent: 0,
    isSeasonal: false,
    peakMonths: [],
    wordCount: 4,
    isQuestion: false,
    opportunity: 55,
    trafficPotential: 110,
    commercialValue: 275,
    trend: null,
    seed: "gold rings",
  };

  it("escapes quotes and commas per RFC 4180", () => {
    const csv = buildCsv([row]);
    assert.ok(csv.includes('"gold ""signet"" rings, uk"'), csv.split("\r\n")[1]);
  });

  it("writes a BOM so Excel reads UTF-8 correctly", () => {
    assert.ok(buildCsv([]).startsWith("﻿"));
  });

  it("includes the cluster name when one is supplied", () => {
    const csv = buildCsv([row], new Map([["pk1", "gold rings"]]));
    const dataLine = csv.trim().split("\r\n")[1];
    assert.ok(dataLine.endsWith("gold rings"), dataLine);
  });

  it("emits a header row even with no data", () => {
    const lines = buildCsv([]).trim().split("\r\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("Keyword"));
  });
});
