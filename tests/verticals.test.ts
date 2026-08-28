import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectVertical, profileForSeed } from "../src/lib/providers/verticals.ts";
import { MockKeywordProvider } from "../src/lib/providers/mock.ts";
import { tokenize } from "../src/lib/seo/normalize.ts";

const market = { language: "en", location: "United States" };

describe("detectVertical", () => {
  it("routes seeds to their vertical", () => {
    assert.equal(detectVertical("emergency dentist"), "local_service");
    assert.equal(detectVertical("project management software"), "software");
    assert.equal(detectVertical("gold rings"), "retail");
    assert.equal(detectVertical("diabetes symptoms"), "health");
    assert.equal(detectVertical("car insurance"), "finance");
    assert.equal(detectVertical("python tutorial"), "education");
    assert.equal(detectVertical("pizza delivery"), "food");
    assert.equal(detectVertical("cheap hotel"), "travel");
  });

  it("matches plurals through the stemmer", () => {
    assert.equal(detectVertical("gold ring"), "retail");
    assert.equal(detectVertical("gold rings"), "retail");
    assert.equal(detectVertical("early symptoms"), "health");
  });

  it("falls back to generic for unrecognised niches", () => {
    assert.equal(detectVertical("corporate team building"), "generic");
    assert.equal(detectVertical("zzzz qqqq"), "generic");
    assert.equal(detectVertical(""), "generic");
  });

  it("prices verticals differently — a finance click is not a recipe click", () => {
    assert.ok(
      profileForSeed("car insurance").cpcMultiplier >
        profileForSeed("pizza recipe").cpcMultiplier,
    );
  });
});

describe("mock idea generation is vertical-appropriate", () => {
  /**
   * The regression this whole module exists to prevent: one retail-flavoured
   * modifier list applied to every seed, producing "handmade python tutorial"
   * and "vintage diabetes symptoms".
   */
  it("never puts retail modifiers on a medical seed", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "diabetes symptoms", limit: 200 });
    const banned = ["handmade", "vintage", "luxury", "wholesale", "for sale", "designer"];
    for (const k of data) {
      for (const word of banned) {
        assert.ok(
          !k.text.includes(word),
          `medical seed produced retail modifier: "${k.text}"`,
        );
      }
    }
  });

  it("never puts local-intent modifiers on a software seed", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "crm software", limit: 200 });
    for (const k of data) {
      assert.ok(!k.text.includes("near me"), `software seed produced: "${k.text}"`);
      assert.ok(!k.text.includes("open now"), `software seed produced: "${k.text}"`);
    }
  });

  it("gives a local service its local modifiers", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({ ...market, seed: "emergency plumber", limit: 200 });
    assert.ok(data.some((k) => k.text.includes("near me")));
  });

  it("never repeats a word already in the seed", async () => {
    const p = new MockKeywordProvider();
    for (const seed of ["pizza delivery", "free python course", "best hotel"]) {
      const { data } = await p.keywordIdeas({ ...market, seed, limit: 200 });
      for (const k of data) {
        const tokens = tokenize(k.text);
        assert.equal(
          tokens.length,
          new Set(tokens).size,
          `duplicate word in generated keyword: "${k.text}" (seed "${seed}")`,
        );
      }
    }
  });

  it("still produces a usable idea set for a completely unknown niche", async () => {
    const p = new MockKeywordProvider();
    const { data } = await p.keywordIdeas({
      ...market,
      seed: "corporate team building",
      limit: 120,
    });
    assert.ok(data.length >= 50, `only produced ${data.length} ideas`);
    assert.ok(data.every((k) => k.text.includes("corporate team building")));
    assert.ok(data.some((k) => k.text.startsWith("what is")));
  });

  it("remains deterministic per seed after the vertical change", async () => {
    const p = new MockKeywordProvider();
    const a = await p.keywordIdeas({ ...market, seed: "car insurance", limit: 40 });
    const b = await p.keywordIdeas({ ...market, seed: "car insurance", limit: 40 });
    assert.deepEqual(a.data, b.data);
  });
});
