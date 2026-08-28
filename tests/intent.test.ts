import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyIntent, intentValueWeight } from "../src/lib/seo/intent.ts";

describe("classifyIntent", () => {
  it("reads leading question words as informational", () => {
    assert.equal(classifyIntent("how to clean silver jewellery").intent, "informational");
    assert.equal(classifyIntent("what is keyword difficulty").intent, "informational");
    assert.equal(classifyIntent("does gold tarnish").intent, "informational");
  });

  it("reads purchase modifiers as transactional", () => {
    assert.equal(classifyIntent("buy gold ring online").intent, "transactional");
    assert.equal(classifyIntent("engagement rings for sale").intent, "transactional");
    assert.equal(classifyIntent("cheap wedding bands").intent, "transactional");
  });

  it("reads comparison modifiers as commercial", () => {
    assert.equal(classifyIntent("ahrefs vs semrush").intent, "commercial");
    assert.equal(classifyIntent("best crm alternatives").intent, "commercial");
    assert.equal(classifyIntent("moz review").intent, "commercial");
  });

  it("reads account and brand-destination terms as navigational", () => {
    assert.equal(classifyIntent("semrush login").intent, "navigational");
    assert.equal(classifyIntent("shopify official site").intent, "navigational");
  });

  it("prefers the money intent when local and commercial signals collide", () => {
    // "best ... near me" carries both. Getting this wrong costs a money page,
    // so the tie-break must land on transactional.
    assert.equal(classifyIntent("best jewellery shop near me").intent, "transactional");
  });

  it("reports zero confidence for unsignalled head terms instead of guessing", () => {
    const result = classifyIntent("jewellery");
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.signals, []);
    // Must not be silently labelled navigational — see the note in intent.ts.
    assert.equal(result.intent, "informational");
  });

  it("is deterministic and case/punctuation insensitive", () => {
    const a = classifyIntent("Best Jewellery Shop Near Me!");
    const b = classifyIntent("best jewellery shop near me");
    assert.equal(a.intent, b.intent);
    assert.equal(a.confidence, b.confidence);
  });

  it("does not split multi-word signals into unigrams", () => {
    // "near" and "me" alone must not fire the "near me" signal.
    const result = classifyIntent("near sighted meaning");
    assert.equal(result.intent, "informational");
  });

  it("weights money intents above informational ones", () => {
    assert.ok(intentValueWeight("transactional") > intentValueWeight("commercial"));
    assert.ok(intentValueWeight("commercial") > intentValueWeight("informational"));
    assert.ok(intentValueWeight("informational") > intentValueWeight("navigational"));
  });
});
