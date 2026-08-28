import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupQuestionsByType,
  isLongTail,
  isQuestion,
} from "../src/lib/seo/questions.ts";
import { normalizeText, stem, tokenize, wordCount } from "../src/lib/seo/normalize.ts";

describe("normalize", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    assert.equal(normalizeText("  Best   Gold-Rings, UK!  "), "best gold rings uk");
  });

  it("folds apostrophes rather than splitting the word", () => {
    assert.equal(normalizeText("women's rings"), "womens rings");
  });

  it("stems plurals and gerunds without destroying short words", () => {
    assert.equal(stem("rings"), "ring");
    assert.equal(stem("necklaces"), "necklace");
    assert.equal(stem("jewelleries"), "jewellery");
    assert.equal(stem("running"), "run");
    assert.equal(stem("gold"), "gold");
    assert.equal(stem("glass"), "glass");
  });

  it("drops stopwords from content tokens but not from word count", () => {
    assert.deepEqual(tokenize("how to clean a gold ring"), ["how", "clean", "gold", "ring"]);
    assert.equal(wordCount("how to clean a gold ring"), 6);
  });

  it("returns an empty token list for empty input", () => {
    assert.deepEqual(tokenize("   "), []);
    assert.equal(wordCount(""), 0);
  });

  /**
   * Regression: an earlier version kept only [a-z0-9], which erased non-Latin
   * keywords to "" — silently dropping every row of a non-English bulk import
   * instead of failing loudly.
   */
  it("preserves non-Latin scripts instead of erasing them", () => {
    assert.equal(normalizeText("восстановление данных"), "восстановление данных");
    assert.equal(normalizeText("美容室 予約"), "美容室 予約");
    assert.equal(normalizeText("مطعم قريب"), "مطعم قريب");
    assert.ok(normalizeText("जूते खरीदें").length > 0);
  });

  it("keeps combining marks that spell the word, not just the base letters", () => {
    // Devanagari vowel signs are combining marks; stripping them would turn
    // "जूते" into "जत". The string must survive intact.
    const hindi = "जूते";
    assert.equal(normalizeText(hindi), hindi);
  });

  it("still folds Latin accents so café and cafe collide", () => {
    assert.equal(normalizeText("Café"), "cafe");
    assert.equal(normalizeText("piñata"), "pinata");
    assert.equal(normalizeText("Zürich hotels"), "zurich hotels");
  });

  it("strips punctuation and symbols from any script", () => {
    assert.equal(normalizeText("best restaurants in NYC!!!"), "best restaurants in nyc");
    assert.equal(normalizeText("c++ tutorial"), "c tutorial");
    assert.equal(normalizeText("«кофе»"), "кофе");
  });
});

describe("isQuestion", () => {
  it("detects leading interrogatives", () => {
    assert.equal(isQuestion("how to clean gold"), true);
    assert.equal(isQuestion("does gold tarnish"), true);
    assert.equal(isQuestion("can you resize a ring"), true);
  });

  it("detects embedded question phrases", () => {
    assert.equal(isQuestion("gold vs silver"), true);
    assert.equal(isQuestion("difference between gold and vermeil"), true);
  });

  it("detects an explicit question mark", () => {
    assert.equal(isQuestion("gold ring?"), true);
  });

  it("rejects plain commercial phrases", () => {
    assert.equal(isQuestion("buy gold rings online"), false);
    assert.equal(isQuestion("cheap silver necklace"), false);
  });
});

describe("isLongTail", () => {
  it("uses a four-word default and counts stopwords", () => {
    assert.equal(isLongTail("gold rings"), false);
    assert.equal(isLongTail("how to clean gold"), true);
  });

  it("accepts a vertical-specific threshold", () => {
    assert.equal(isLongTail("gold rings uk", 3), true);
    assert.equal(isLongTail("gold rings uk", 5), false);
  });
});

describe("groupQuestionsByType", () => {
  it("buckets questions by their interrogative and skips non-questions", () => {
    const groups = groupQuestionsByType([
      "how to clean gold",
      "how long does gold last",
      "what is vermeil",
      "buy gold rings",
    ]);
    assert.deepEqual(groups.how, ["how to clean gold", "how long does gold last"]);
    assert.deepEqual(groups.what, ["what is vermeil"]);
    assert.equal(groups.buy, undefined);
  });
});
