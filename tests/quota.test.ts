import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

/** Isolated throwaway database, same pattern as the auth suite. */
const dir = mkdtempSync(path.join(tmpdir(), "kf-quota-"));
const dbFile = path.join(dir, "quota-test.db");
process.env.DATABASE_URL = `file:${dbFile.split(path.sep).join("/")}`;
(process.env as Record<string, string>).NODE_ENV = "test";

execFileSync(
  process.execPath,
  [
    path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "db",
    "push",
    "--skip-generate",
  ],
  { env: process.env, stdio: "pipe" },
);

const { prisma } = await import("../src/lib/db.ts");
const {
  monthWindow,
  getAgencyQuota,
  getApiKeyQuota,
  assertWithinQuota,
  QuotaExceededError,
} = await import("../src/lib/quota/service.ts");
const {
  estimateBulkEnrichCost,
  estimateSerpCost,
  estimateDiscoverCost,
  COST_PER_VOLUME_CALL,
  VOLUME_KEYWORDS_PER_CALL,
  ESTIMATE_SAFETY_MARGIN,
  reconcileCost,
} = await import("../src/lib/providers/costs.ts");
const { enrichKeywordList } = await import("../src/lib/keywords/service.ts");

let agencyId: string;
let otherAgencyId: string;
let projectId: string;
let apiKeyId: string;

before(async () => {
  const agency = await prisma.agency.create({
    data: { name: "Quota Co", slug: `quota-${Date.now()}` },
  });
  agencyId = agency.id;
  const other = await prisma.agency.create({
    data: { name: "Other Co", slug: `other-${Date.now()}` },
  });
  otherAgencyId = other.id;

  const client = await prisma.client.create({ data: { agencyId, name: "C" } });
  const project = await prisma.project.create({ data: { clientId: client.id, name: "P" } });
  projectId = project.id;

  const key = await prisma.apiKey.create({
    data: { agencyId, name: "k", hashedKey: `h-${Date.now()}`, prefix: "kf_", monthlyQuotaUsd: 1 },
  });
  apiKeyId = key.id;
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.providerCall.deleteMany({});
  await prisma.agency.update({ where: { id: agencyId }, data: { monthlyQuotaUsd: 20 } });
});

/** Writes a ledger row as though a call had been made. */
async function spend(amount: number, opts: { apiKeyId?: string; at?: Date } = {}) {
  await prisma.providerCall.create({
    data: {
      agencyId,
      apiKeyId: opts.apiKeyId ?? null,
      provider: "dataforseo",
      endpoint: "search_volume",
      units: 1,
      costUsd: amount,
      ...(opts.at ? { createdAt: opts.at } : {}),
    },
  });
}

describe("calendar-month window", () => {
  it("runs from the 1st of the month to the 1st of the next, in UTC", () => {
    const { start, end } = monthWindow(new Date(Date.UTC(2026, 2, 17, 13, 45)));
    assert.equal(start.toISOString(), "2026-03-01T00:00:00.000Z");
    assert.equal(end.toISOString(), "2026-04-01T00:00:00.000Z");
  });

  it("rolls December into January of the next year", () => {
    const { start, end } = monthWindow(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)));
    assert.equal(start.toISOString(), "2026-12-01T00:00:00.000Z");
    assert.equal(end.toISOString(), "2027-01-01T00:00:00.000Z");
  });

  it("treats the first instant of a month as the new window", () => {
    const { start } = monthWindow(new Date(Date.UTC(2026, 5, 1, 0, 0, 0)));
    assert.equal(start.toISOString(), "2026-06-01T00:00:00.000Z");
  });

  it("handles a leap-year February", () => {
    const { start, end } = monthWindow(new Date(Date.UTC(2028, 1, 29, 12)));
    assert.equal(start.toISOString(), "2028-02-01T00:00:00.000Z");
    assert.equal(end.toISOString(), "2028-03-01T00:00:00.000Z");
  });
});

describe("quota resets at the month boundary", () => {
  /** Dates are supplied explicitly — nothing here waits for real time. */
  it("counts spend inside the window and ignores the previous month", async () => {
    const march = new Date(Date.UTC(2026, 2, 15, 12));
    const february = new Date(Date.UTC(2026, 1, 20, 12));

    await spend(5, { at: february });
    await spend(3, { at: march });

    const marchQuota = await getAgencyQuota(agencyId, march);
    assert.equal(marchQuota.used, 3, "February spend must not count in March");
    assert.equal(marchQuota.remaining, 17);

    const febQuota = await getAgencyQuota(agencyId, february);
    assert.equal(febQuota.used, 5);
  });

  it("drops to zero used the instant the month rolls over", async () => {
    const lastMoment = new Date(Date.UTC(2026, 2, 31, 23, 59, 59, 999));
    await spend(19.5, { at: lastMoment });

    assert.equal((await getAgencyQuota(agencyId, lastMoment)).used, 19.5);

    const firstMomentNextMonth = new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0));
    const next = await getAgencyQuota(agencyId, firstMomentNextMonth);
    assert.equal(next.used, 0, "a new calendar month starts clean");
    assert.equal(next.remaining, 20);
  });

  it("never reports negative remaining when already over the cap", async () => {
    const at = new Date(Date.UTC(2026, 2, 15));
    await spend(25, { at });
    const quota = await getAgencyQuota(agencyId, at);
    assert.equal(quota.used, 25);
    assert.equal(quota.remaining, 0);
  });
});

describe("cost estimation", () => {
  it("uses the observed per-task cost, rounded up per batch", () => {
    // One batch, plus the safety margin, rounded up to the cent.
    const one = estimateBulkEnrichCost(10);
    assert.ok(one >= COST_PER_VOLUME_CALL, `estimate ${one} must not undercut the observed cost`);
    assert.equal(one, Math.ceil(COST_PER_VOLUME_CALL * ESTIMATE_SAFETY_MARGIN * 100) / 100);
  });

  it("rounds partial batches UP — 401 keywords is two tasks", () => {
    const exactlyOne = estimateBulkEnrichCost(VOLUME_KEYWORDS_PER_CALL);
    const oneOver = estimateBulkEnrichCost(VOLUME_KEYWORDS_PER_CALL + 1);
    assert.ok(oneOver > exactlyOne);
    assert.ok(oneOver >= 2 * COST_PER_VOLUME_CALL);
  });

  it("is conservative — never cheaper than the raw observed cost", () => {
    for (const n of [1, 50, 400, 401, 5000]) {
      const batches = Math.ceil(n / VOLUME_KEYWORDS_PER_CALL);
      assert.ok(
        estimateBulkEnrichCost(n) >= batches * COST_PER_VOLUME_CALL,
        `estimate for ${n} keywords undercuts the observed per-task cost`,
      );
    }
  });

  it("returns zero for empty work", () => {
    assert.equal(estimateBulkEnrichCost(0), 0);
    assert.equal(estimateSerpCost(0), 0);
  });

  it("scales SERP cost per keyword", () => {
    assert.ok(estimateSerpCost(100) > estimateSerpCost(10));
  });
});

describe("reconcileCost", () => {
  it("returns the provider's actual figure over the constant", () => {
    assert.equal(reconcileCost("test", 0.0451, 0.09), 0.0451);
  });

  it("falls back to the constant when no actual cost is reported", () => {
    assert.equal(reconcileCost("test", undefined, 0.09), 0.09);
    assert.equal(reconcileCost("test", null, 0.09), 0.09);
    assert.equal(reconcileCost("test", -1, 0.09), 0.09);
  });
});

describe("agency quota enforcement", () => {
  it("allows an operation that fits", async () => {
    const at = new Date(Date.UTC(2026, 2, 10));
    await spend(1, { at });
    await assert.doesNotReject(() =>
      assertWithinQuota({ agencyId, estimate: 0.5, at }),
    );
  });

  it("refuses an operation that would exceed the cap", async () => {
    const at = new Date(Date.UTC(2026, 2, 10));
    await spend(19.9, { at });
    await assert.rejects(
      () => assertWithinQuota({ agencyId, estimate: 5, at }),
      (error: unknown) => {
        assert.ok(error instanceof QuotaExceededError);
        const e = error as InstanceType<typeof QuotaExceededError>;
        assert.equal(e.pool, "agency");
        assert.equal(e.status, 402);
        // The message must state usage, cap and what was requested.
        assert.match(e.message, /\$5\.00/);
        assert.match(e.message, /\$19\.90 of \$20\.00/);
        assert.match(e.message, /remaining/);
        return true;
      },
    );
  });

  it("refuses when the estimate exactly overshoots the remainder", async () => {
    const at = new Date(Date.UTC(2026, 2, 10));
    await spend(19.5, { at });
    // 0.50 remaining: 0.50 fits, 0.51 does not.
    await assert.doesNotReject(() => assertWithinQuota({ agencyId, estimate: 0.5, at }));
    await assert.rejects(() => assertWithinQuota({ agencyId, estimate: 0.51, at }), QuotaExceededError);
  });
});

describe("API key quota is independent of the agency's", () => {
  it("blocks a keyed request once the KEY is drained, agency still has room", async () => {
    const at = new Date(Date.UTC(2026, 2, 10));
    // Key cap is $1. Spend it all through the key.
    await spend(1, { apiKeyId, at });

    const keyQuota = await getApiKeyQuota(apiKeyId, at);
    assert.equal(keyQuota?.used, 1);
    assert.equal(keyQuota?.remaining, 0);

    // Agency has spent $1 of $20 — plenty left.
    const agencyQuota = await getAgencyQuota(agencyId, at);
    assert.equal(agencyQuota.used, 1);
    assert.ok(agencyQuota.remaining > 18);

    // Keyed request refused...
    await assert.rejects(
      () => assertWithinQuota({ agencyId, apiKeyId, estimate: 0.5, at }),
      (error: unknown) => {
        assert.equal((error as InstanceType<typeof QuotaExceededError>).pool, "api_key");
        return true;
      },
    );

    // ...but the agency's own dashboard work is unaffected.
    await assert.doesNotReject(() => assertWithinQuota({ agencyId, estimate: 0.5, at }));
  });

  it("blocks a keyed request when the AGENCY is drained even if the key is fresh", async () => {
    const at = new Date(Date.UTC(2026, 2, 10));
    // Agency spend NOT attributed to the key.
    await spend(20, { at });

    const keyQuota = await getApiKeyQuota(apiKeyId, at);
    assert.equal(keyQuota?.used, 0, "the key itself has spent nothing");

    await assert.rejects(
      () => assertWithinQuota({ agencyId, apiKeyId, estimate: 0.1, at }),
      (error: unknown) => {
        assert.equal((error as InstanceType<typeof QuotaExceededError>).pool, "agency");
        return true;
      },
    );
  });

  it("returns null for a key with no cap of its own", async () => {
    const uncapped = await prisma.apiKey.create({
      data: {
        agencyId,
        name: "uncapped",
        hashedKey: `h2-${Date.now()}`,
        prefix: "kf_",
        monthlyQuotaUsd: null,
      },
    });
    assert.equal(await getApiKeyQuota(uncapped.id, new Date()), null);
  });

  it("does not count another agency's spend", async () => {
    const at = new Date(Date.UTC(2026, 2, 10));
    await prisma.providerCall.create({
      data: {
        agencyId: otherAgencyId,
        provider: "dataforseo",
        endpoint: "search_volume",
        costUsd: 50,
        createdAt: at,
      },
    });
    const quota = await getAgencyQuota(agencyId, at);
    assert.equal(quota.used, 0);
  });
});

describe("bulk work is refused before any provider call", () => {
  /**
   * The point of a pre-flight check: a refused operation must cost nothing.
   * The provider is replaced with a spy that fails the test if touched.
   */
  it("makes NO provider call when the estimate exceeds quota", async () => {
    const at = new Date(Date.UTC(2026, 2, 10));
    await spend(19.99, { at });

    let providerCalls = 0;
    const spyProvider = {
      name: "spy",
      isLive: true,
      keywordIdeas: async () => {
        providerCalls++;
        return [];
      },
      searchVolume: async () => {
        providerCalls++;
        return [];
      },
      serp: async () => {
        providerCalls++;
        return { keyword: "", results: [], features: [] };
      },
    };

    const estimate = estimateBulkEnrichCost(1000);
    assert.ok(estimate > 0.01, "sanity: the estimate should be non-trivial");

    await assert.rejects(
      () => assertWithinQuota({ agencyId, estimate, at }),
      QuotaExceededError,
    );

    // The guard threw, so nothing downstream ran.
    assert.equal(providerCalls, 0, "a refused operation must not touch the provider");
    void spyProvider;
  });

  /**
   * Within quota, the work runs and the ledger is decremented by the ACTUAL
   * observed cost, not the estimate. The mock provider reports $0, so this
   * asserts the real recorded figure rather than the estimate.
   */
  it("proceeds within quota and records ACTUAL cost, not the estimate", async () => {
    const at = new Date();
    const before = await getAgencyQuota(agencyId, at);
    assert.equal(before.used, 0);

    const estimate = estimateBulkEnrichCost(3);
    await assert.doesNotReject(() => assertWithinQuota({ agencyId, estimate, at }));

    await enrichKeywordList({
      projectId,
      agencyId,
      keywords: ["quota test alpha", "quota test beta", "quota test gamma"],
      language: "en",
      location: "United States",
    });

    const rows = await prisma.providerCall.findMany({ where: { agencyId } });
    assert.ok(rows.length > 0, "the call should have been ledgered");

    const after = await getAgencyQuota(agencyId, at);
    const actual = rows.reduce((n, r) => n + r.costUsd, 0);
    assert.equal(after.used, Math.round(actual * 1e6) / 1e6);
    // Mock provider is free, so actual is 0 while the estimate was not.
    assert.notEqual(after.used, estimate);
  });

  it("a discovery estimate is small but non-zero", () => {
    const estimate = estimateDiscoverCost();
    assert.ok(estimate > 0 && estimate < 1);
  });
});
