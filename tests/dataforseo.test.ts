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
  it("throws on a top-level error with NO tasks array at all", async () => {
    stubFetch({ status_code: 40100, status_message: "Unauthorized." });
    await assert.rejects(
      () => provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 }),
      (error: unknown) => {
        assert.match(String(error), /40100/);
        assert.match(String(error), /Unauthorized/);
        return true;
      },
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
  /** keyword_ideas nests metrics under keyword_info. */
  it("reads metrics from the nested keyword_info shape", async () => {
    stubFetch({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              items: [
                {
                  keyword: "Gold Rings",
                  keyword_info: {
                    search_volume: 12100,
                    cpc: 1.42,
                    competition: 0.33,
                    monthly_searches: [
                      { year: 2026, month: 8, search_volume: 12100 },
                      { year: 2026, month: 7, search_volume: 9900 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const { data } = await provider().keywordIdeas({ ...market, seed: "gold rings", limit: 10 });
    assert.equal(data.length, 1);
    assert.equal(data[0].text, "gold rings"); // normalised
    assert.equal(data[0].volume, 12100);
    assert.equal(data[0].cpc, 1.42);
    assert.equal(data[0].competition, 0.33);
    assert.ok(data[0].trend && data[0].trend.length === 2);
  });

  /**
   * google_ads/search_volume returns the metrics FLAT on the item, with no
   * keyword_info wrapper — the `item.keyword_info ?? item` fallback.
   */
  it("reads metrics from the flat shape via the keyword_info fallback", async () => {
    stubFetch({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            { keyword: "silver necklace", search_volume: 4400, cpc: 0.88, competition: 0.51 },
          ],
        },
      ],
    });

    const { data } = await provider().searchVolume({ ...market, keywords: ["silver necklace"] });
    assert.equal(data.length, 1);
    assert.equal(data[0].volume, 4400);
    assert.equal(data[0].cpc, 0.88);
    assert.equal(data[0].competition, 0.51);
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
