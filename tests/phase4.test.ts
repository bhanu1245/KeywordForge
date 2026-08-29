import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ASSUMPTIONS,
  ctrForPosition,
  describeAssumptions,
  revenuePotential,
  trafficPotential,
} from "../src/lib/seo/scoring.ts";
import {
  DEFAULT_BRANDING,
  isSafeImageUrl,
  isValidHexColor,
  parseBranding,
} from "../src/lib/agency/service.ts";

describe("revenuePotential", () => {
  const assumptions = { conversionRate: 0.02, orderValue: 100, position: 3 };

  it("multiplies sessions by conversion rate and order value", () => {
    // 10,000 searches x 11% CTR at position 3 = 1,100 sessions
    // 1,100 x 2% x $100 = $2,200
    const sessions = trafficPotential(10_000, 3);
    assert.equal(sessions, Math.round(10_000 * ctrForPosition(3)));
    assert.equal(revenuePotential(10_000, assumptions), sessions * 0.02 * 100);
  });

  it("returns 0 for missing or zero volume", () => {
    assert.equal(revenuePotential(null, assumptions), 0);
    assert.equal(revenuePotential(undefined, assumptions), 0);
    assert.equal(revenuePotential(0, assumptions), 0);
  });

  /**
   * A zero or negative assumption means "not configured", and modelling
   * revenue on it would invent a number the user never supplied.
   */
  it("returns 0 when an assumption is missing rather than inventing one", () => {
    assert.equal(revenuePotential(10_000, { ...assumptions, conversionRate: 0 }), 0);
    assert.equal(revenuePotential(10_000, { ...assumptions, orderValue: 0 }), 0);
    assert.equal(revenuePotential(10_000, { ...assumptions, orderValue: -50 }), 0);
  });

  it("scales with position — a better rank is worth more", () => {
    const first = revenuePotential(10_000, { ...assumptions, position: 1 });
    const tenth = revenuePotential(10_000, { ...assumptions, position: 10 });
    assert.ok(first > tenth, `#1 ${first} should beat #10 ${tenth}`);
  });

  it("scales linearly with order value", () => {
    const at100 = revenuePotential(5_000, { ...assumptions, orderValue: 100 });
    const at200 = revenuePotential(5_000, { ...assumptions, orderValue: 200 });
    assert.equal(at200, at100 * 2);
  });

  it("never returns a negative figure", () => {
    assert.ok(revenuePotential(-100, assumptions) >= 0);
  });
});

describe("describeAssumptions", () => {
  /** The number must never be shown without these words next to it. */
  it("states position, CTR, conversion rate and order value", () => {
    const text = describeAssumptions({ conversionRate: 0.025, orderValue: 250, position: 3 });
    assert.match(text, /position 3/);
    assert.match(text, /2\.5% conversion/);
    assert.match(text, /\$250/);
    assert.match(text, /CTR/);
  });

  it("describes the defaults without throwing", () => {
    assert.ok(describeAssumptions(DEFAULT_ASSUMPTIONS).length > 20);
  });
});

describe("agency branding", () => {
  it("accepts valid hex colours only", () => {
    for (const good of ["#fff", "#4f46e5", "#ABCDEF"]) {
      assert.equal(isValidHexColor(good), true, good);
    }
    for (const bad of ["red", "4f46e5", "#12345", "#gggggg", "", "#fff;background:url(x)"]) {
      assert.equal(isValidHexColor(bad), false, bad);
    }
  });

  /** The logo lands in an <img src>, so javascript:/data: must be refused. */
  it("accepts only absolute http(s) image URLs", () => {
    assert.equal(isSafeImageUrl("https://cdn.example.com/logo.png"), true);
    assert.equal(isSafeImageUrl("http://example.com/l.png"), true);
    for (const bad of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "/relative/logo.png",
      "not a url",
    ]) {
      assert.equal(isSafeImageUrl(bad), false, bad);
    }
  });

  it("falls back to defaults for missing or malformed JSON", () => {
    assert.deepEqual(parseBranding(null), DEFAULT_BRANDING);
    assert.deepEqual(parseBranding("not json at all"), DEFAULT_BRANDING);
    assert.deepEqual(parseBranding(""), DEFAULT_BRANDING);
  });

  /**
   * Re-validated on READ, not just on write: rows written before validation
   * existed must not be able to inject into the report's style attribute.
   */
  it("sanitises hostile values already stored in the database", () => {
    const hostile = parseBranding(
      JSON.stringify({
        primaryColor: "red;} body{display:none}",
        logoUrl: "javascript:alert(1)",
      }),
    );
    assert.equal(hostile.primaryColor, DEFAULT_BRANDING.primaryColor);
    assert.equal(hostile.logoUrl, null);
  });

  it("preserves the Phase 1 branding shape", () => {
    // The column has held { primaryColor, logoUrl } since Phase 1 — the shape
    // is extended, never replaced.
    const parsed = parseBranding(JSON.stringify({ primaryColor: "#4f46e5", logoUrl: null }));
    assert.equal(parsed.primaryColor, "#4f46e5");
    assert.equal(parsed.logoUrl, null);
    assert.equal(parsed.reportTitle, null);
  });
});
