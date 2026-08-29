/**
 * Spend quota — a hard cap on metered provider cost, checked BEFORE any
 * billable call is made.
 *
 * WHAT THIS IS NOT: pricing. The dollar figures here are internal safety caps
 * so a runaway import cannot drain the DataForSEO balance. They are not plan
 * allowances, are not shown to customers, and must not be treated as billing.
 * Customer-facing pricing is still an open decision (PRD §15).
 *
 * TWO INDEPENDENT POOLS:
 *   - the AGENCY's monthly cap, covering everything it spends;
 *   - optionally an API KEY's own cap, which can be tighter.
 * A keyed request must satisfy BOTH. Draining a key does not block the
 * agency's dashboard work, because the key's spend is measured only from
 * ledger rows carrying that key's id.
 */

import { prisma } from "../db";

/**
 * CALENDAR-MONTH WINDOW, in UTC.
 *
 * The window runs from 00:00:00 UTC on the 1st of the month containing `at`,
 * up to but NOT including 00:00:00 UTC on the 1st of the next month. So a
 * month boundary resets usage to zero instantly rather than aging out
 * gradually, and December rolls to January correctly.
 *
 * UTC deliberately, not local time: a server that changes timezone or crosses
 * DST must not move the boundary, and two instances in different regions must
 * agree on which month a call belongs to.
 */
export function monthWindow(at: Date = new Date()): { start: Date; end: Date } {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    // Month 12 rolls to January of the next year automatically.
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  };
}

export interface QuotaStatus {
  /** USD spent inside the current calendar month. */
  used: number;
  /** The cap for this pool. */
  limit: number;
  /** Never negative — a pool already over its cap reports 0 remaining. */
  remaining: number;
  windowStart: Date;
  windowEnd: Date;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Sums ledger cost for a pool over the current calendar month. */
async function spendIn(
  where: { agencyId: string } | { apiKeyId: string },
  at: Date,
): Promise<number> {
  const { start, end } = monthWindow(at);
  const result = await prisma.providerCall.aggregate({
    _sum: { costUsd: true },
    where: { ...where, createdAt: { gte: start, lt: end } },
  });
  return round(result._sum.costUsd ?? 0);
}

export async function getAgencyQuota(
  agencyId: string,
  at: Date = new Date(),
): Promise<QuotaStatus> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { monthlyQuotaUsd: true },
  });
  const limit = agency?.monthlyQuotaUsd ?? 0;
  const used = await spendIn({ agencyId }, at);
  const { start, end } = monthWindow(at);
  return {
    used,
    limit,
    remaining: round(Math.max(limit - used, 0)),
    windowStart: start,
    windowEnd: end,
  };
}

/** Null when the key has no cap of its own (agency cap still applies). */
export async function getApiKeyQuota(
  apiKeyId: string,
  at: Date = new Date(),
): Promise<QuotaStatus | null> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { monthlyQuotaUsd: true },
  });
  if (!key || key.monthlyQuotaUsd === null) return null;

  const used = await spendIn({ apiKeyId }, at);
  const { start, end } = monthWindow(at);
  return {
    used,
    limit: key.monthlyQuotaUsd,
    remaining: round(Math.max(key.monthlyQuotaUsd - used, 0)),
    windowStart: start,
    windowEnd: end,
  };
}

export class QuotaExceededError extends Error {
  readonly status = 402; // Payment Required — the closest honest HTTP code.
  readonly pool: "agency" | "api_key";
  readonly estimate: number;
  readonly quota: QuotaStatus;

  constructor(pool: "agency" | "api_key", estimate: number, quota: QuotaStatus) {
    const scope = pool === "agency" ? "agency" : "API key";
    super(
      `This would exceed the ${scope} monthly spend cap. ` +
        `Estimated cost $${estimate.toFixed(2)}; ` +
        `used $${quota.used.toFixed(2)} of $${quota.limit.toFixed(2)} this month, ` +
        `$${quota.remaining.toFixed(2)} remaining. ` +
        `The cap resets on ${quota.windowEnd.toISOString().slice(0, 10)}.`,
    );
    this.name = "QuotaExceededError";
    this.pool = pool;
    this.estimate = estimate;
    this.quota = quota;
  }
}

export interface QuotaCheckInput {
  agencyId: string;
  /** Present when the request arrived through the public API. */
  apiKeyId?: string | null;
  /** Pre-flight estimate in USD, from lib/providers/costs. */
  estimate: number;
  at?: Date;
}

/**
 * Throws QuotaExceededError if the operation would push either pool past its
 * cap. Call this BEFORE the first provider request — the whole point is that
 * a refused operation costs nothing.
 *
 * Hard cap, not overage: an operation that does not fit is refused outright
 * rather than allowed to run partway and stop mid-flight, which would spend
 * money and leave the job half-done.
 */
export async function assertWithinQuota(input: QuotaCheckInput): Promise<{
  agency: QuotaStatus;
  apiKey: QuotaStatus | null;
}> {
  const at = input.at ?? new Date();
  const estimate = Math.max(input.estimate, 0);

  // The key's cap is checked first: it is the tighter of the two by design,
  // so it produces the more specific error.
  const apiKey = input.apiKeyId ? await getApiKeyQuota(input.apiKeyId, at) : null;
  if (apiKey && estimate > apiKey.remaining) {
    throw new QuotaExceededError("api_key", estimate, apiKey);
  }

  const agency = await getAgencyQuota(input.agencyId, at);
  if (estimate > agency.remaining) {
    throw new QuotaExceededError("agency", estimate, agency);
  }

  return { agency, apiKey };
}
