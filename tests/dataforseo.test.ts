import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DataForSeoProvider } from "../src/lib/providers/dataforseo.ts";

/**
 * Response-shape tests for the live provider, with `fetch` stubbed.
 *
 * These need no credentials: the thing under test is how the parser reacts to
 * DataForSEO's envelope, and the shapes below are transcribed from its
 * documented format. This is not a substitute for a real call — the parser has
 * still never met a real response — but it does pin the failure mode that a
 * bad credential would otherwise hide.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stubs fetch with an HTTP 200 carrying the given JSON body. */
function stubFetch(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

const provider = () => new DataForSeoProvider("login", "password");
const market = { language: "en", location: "United States" };

describe("DataForSEO envelope errors", () => {
  /**
   * The regression this fixes: an auth failure returns HTTP 200, an
   * envelope-level error code, and NO tasks array. Checking only
   * tasks[0].status_code let it fall through and parse as zero results — so a
   * wrong password looked exactly like "this keyword has no ideas".
   */
  /**
   * VERBATIM body from a real DataForSEO auth failure, captured live.
   *
   * Two things here differ from what the code originally assumed, which is
   * exactly why this was worth observing rather than imagining:
   *   - the HTTP status is 401, not 200;
   *   - `tasks` is explicitly `null`, not absent and not `[]`.
   * `cost: 0` on the same response is how we know a rejected request is free.
   */
  const REAL_AUTH_FAILURE = {
    version: "0.1.20260826",
    status_code: 40100,
    status_message:
      "You are not authorized to access this resource. See your login details here: https://app.dataforseo.com/api-access .",
    time: "0 sec.",
    cost: 0,
    tasks_count: 0,
    tasks_error: 0,
    tasks: null,
  };

  it("throws on the REAL auth-failure envelope (HTTP 401, tasks: null)", async () => {
    stubFetch(REAL_AUTH_FAILURE, 401);
    await assert.rejects(
      () => provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 }),
      (error: unknown) => {
        assert.match(String(error), /401/);
        return true;
      },
    );
  });

  /**
   * The same body served with HTTP 200 — which some DataForSEO error families
   * do. Here `!res.ok` does not fire, so the top-level status_code check is
   * the only thing standing between an auth failure and it parsing as
   * "zero results".
   */
  it("throws on the real error body even when served with HTTP 200", async () => {
    stubFetch(REAL_AUTH_FAILURE, 200);
    await assert.rejects(
      () => provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 }),
      (error: unknown) => {
        assert.match(String(error), /40100/);
        assert.match(String(error), /not authorized/i);
        return true;
      },
    );
  });

  it("throws on a top-level error with NO tasks key at all", async () => {
    stubFetch({ status_code: 40100, status_message: "Unauthorized." });
    await assert.rejects(
      () => provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 }),
      /40100/,
    );
  });

  it("throws on a top-level error with an EMPTY tasks array", async () => {
    stubFetch({ status_code: 40200, status_message: "Payment Required.", tasks: [] });
    await assert.rejects(
      () => provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 }),
      /40200/,
    );
  });

  it("throws on a server-family error code", async () => {
    stubFetch({ status_code: 50000, status_message: "Internal Error.", tasks: [] });
    await assert.rejects(
      () => provider().searchVolume({ ...market, keywords: ["gold rings"] }),
      /50000/,
    );
  });

  it("still throws on a per-task error when the envelope succeeded", async () => {
    stubFetch({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{ status_code: 40501, status_message: "Invalid Field.", result: null }],
    });
    await assert.rejects(
      () => provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 }),
      /40501/,
    );
  });

  it("does NOT throw on a success envelope with no results", async () => {
    // 20000 with an empty result is a legitimate "nothing found", not an error.
    stubFetch({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{ status_code: 20000, result: [{ items: [] }] }],
    });
    const { data } = await provider().keywordIdeas({ ...market, seed: "zzz", limit: 10 });
    assert.deepEqual(data, []);
  });

  it("surfaces a non-200 HTTP response as an error", async () => {
    stubFetch({ error: "nope" }, 500);
    await assert.rejects(
      () => provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 }),
      /500/,
    );
  });
});

describe("DataForSEO response parsing", () => {
  /**
   * VERBATIM item from a live keyword_ideas response. Metrics are nested under
   * `keyword_info` and `competition` is a NUMBER already on a 0..1 scale.
   */
  it("reads the REAL nested keyword_info shape from keyword_ideas", async () => {
    stubFetch({
      version: "0.1.20260826",
      status_code: 20000,
      status_message: "Ok.",
      cost: 0.0126,
      tasks: [
        {
          status_code: 20000,
          status_message: "Ok.",
          result: [
            {
              se_type: "google",
              seed_keywords: ["stainless steel dog bowl holder"],
              location_code: 2840,
              language_code: "en",
              total_count: 204416,
              items_count: 1,
              items: [
                {
                  se_type: "google",
                  keyword: "cotton bowl",
                  location_code: 2840,
                  language_code: "en",
                  keyword_info: {
                    se_type: "google",
                    last_updated_time: "2026-08-28 16:12:30 +00:00",
                    competition: 0.02,
                    competition_level: "LOW",
                    cpc: 1.63,
                    search_volume: 301000,
                    low_top_of_page_bid: 0.57,
                    high_top_of_page_bid: 2.93,
                    categories: [10005, 10060, 10354],
                    monthly_searches: [
                      { year: 2026, month: 7, search_volume: 12100 },
                      { year: 2026, month: 6, search_volume: 9900 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const { data } = await provider().keywordIdeas({ ...market, seed: "dog bowl", limit: 5 });
    assert.equal(data.length, 1);
    assert.equal(data[0].text, "cotton bowl");
    assert.equal(data[0].volume, 301000);
    assert.equal(data[0].cpc, 1.63);
    assert.equal(data[0].competition, 0.02, "numeric competition is already 0..1");
    assert.equal(data[0].trend?.length, 2);
  });

  /**
   * VERBATIM item from a live google_ads/search_volume response.
   *
   * Two things this pins, both of which broke the original parser:
   *   - metrics are FLAT on the result item (no keyword_info wrapper), which
   *     is what the `item.keyword_info ?? item` fallback exists for;
   *   - `competition` is the STRING "HIGH", with the number in
   *     `competition_index` on a 0..100 scale.
   */
  it("reads the REAL flat shape from search_volume, including string competition", async () => {
    stubFetch({
      version: "0.1.20260826",
      status_code: 20000,
      status_message: "Ok.",
      cost: 0.09,
      tasks: [
        {
          status_code: 20000,
          status_message: "Ok.",
          result_count: 1,
          result: [
            {
              keyword: "stainless steel dog bowl holder",
              spell: null,
              location_code: 2840,
              language_code: "en",
              search_partners: false,
              competition: "HIGH",
              competition_index: 100,
              search_volume: 20,
              low_top_of_page_bid: null,
              high_top_of_page_bid: null,
              cpc: 1.39,
              monthly_searches: [
                { year: 2026, month: 7, search_volume: 10 },
                { year: 2026, month: 6, search_volume: 10 },
              ],
            },
          ],
        },
      ],
    });

    const { data } = await provider().searchVolume({
      ...market,
      keywords: ["stainless steel dog bowl holder"],
    });
    assert.equal(data.length, 1);
    assert.equal(data[0].volume, 20);
    assert.equal(data[0].cpc, 1.39);
    // Was null before the fix — competition_index/100, not the string.
    assert.equal(data[0].competition, 1, "competition_index 100 must normalise to 1.0");
    assert.equal(data[0].trend?.length, 2);
  });

  it("falls back to the verbal level when no numeric competition exists", async () => {
    stubFetch({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [{ keyword: "some keyword", search_volume: 100, competition: "LOW" }],
        },
      ],
    });
    const { data } = await provider().searchVolume({ ...market, keywords: ["some keyword"] });
    assert.ok(
      data[0].competition !== null && data[0].competition > 0 && data[0].competition < 0.5,
      `LOW should map into the low band, got ${data[0].competition}`,
    );
  });

  it("clamps competition into 0..1", async () => {
    stubFetch({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [{ keyword: "weird", search_volume: 10, competition_index: 250 }],
        },
      ],
    });
    const { data } = await provider().searchVolume({ ...market, keywords: ["weird"] });
    assert.equal(data[0].competition, 1);
  });

  it("survives nulls and missing fields without throwing", async () => {
    stubFetch({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                { keyword: "no metrics", keyword_info: {} },
                { keyword: "null volume", keyword_info: { search_volume: null, cpc: null } },
                { keyword_info: { search_volume: 10 } }, // no keyword at all
              ],
            },
          ],
        },
      ],
    });

    const { data } = await provider().keywordIdeas({ ...market, seed: "x", limit: 10 });
    // The row with no keyword is dropped; the other two survive with nulls.
    assert.equal(data.length, 2);
    assert.equal(data[0].volume, null);
    assert.equal(data[1].volume, null);
  });

  it("bills volume lookups per keyword", async () => {
    stubFetch({ status_code: 20000, tasks: [{ status_code: 20000, result: [] }] });
    const res = await provider().searchVolume({ ...market, keywords: ["a", "b", "c"] });
    assert.equal(res.unitsConsumed, 3);
  });

  it("refuses to construct without credentials", () => {
    assert.throws(() => new DataForSeoProvider("", ""), /credentials missing/i);
  });
});
