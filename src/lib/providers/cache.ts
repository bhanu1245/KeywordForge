/**
 * Response cache + cost ledger for every upstream call.
 *
 * PRD §12 names this as the primary cost control: "re-querying the same
 * keyword repeatedly is the fastest way to burn budget." It is implemented as
 * a decorator around any KeywordDataProvider so it applies uniformly and
 * cannot be forgotten at a call site.
 *
 * The cache is intentionally keyed on the *query*, not on the tenant — see
 * the header of prisma/schema.prisma for why sharing is both safe and the
 * entire point.
 */

import { createHash } from "node:crypto";
import { prisma } from "../db";
import type {
  KeywordDataProvider,
  KeywordIdeasInput,
  ProviderResponse,
  RawKeyword,
  SearchVolumeInput,
  SerpInput,
  SerpResponse,
} from "./types";

export interface UsageContext {
  agencyId?: string | null;
  projectId?: string | null;
}

function ttlDays(): number {
  const raw = Number(process.env.PROVIDER_CACHE_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

function cacheKey(provider: string, endpoint: string, params: unknown): string {
  // Sorted-key serialisation so {a,b} and {b,a} hit the same entry.
  const canonical = JSON.stringify(params, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
  return createHash("sha256")
    .update(`${provider}|${endpoint}|${canonical}`)
    .digest("hex");
}

async function recordCall(
  provider: string,
  endpoint: string,
  units: number,
  costUsd: number,
  cacheHit: boolean,
  ctx: UsageContext,
): Promise<void> {
  try {
    await prisma.providerCall.create({
      data: {
        agencyId: ctx.agencyId ?? null,
        projectId: ctx.projectId ?? null,
        provider,
        endpoint,
        units,
        costUsd,
        cacheHit,
      },
    });
  } catch {
    // The ledger is for reporting, not correctness. Never let a failed
    // bookkeeping write take down a user's keyword research.
  }
}

async function throughCache<T>(
  provider: string,
  endpoint: string,
  params: unknown,
  ctx: UsageContext,
  fetcher: () => Promise<ProviderResponse<T>>,
): Promise<T> {
  const key = cacheKey(provider, endpoint, params);
  const now = new Date();

  const hit = await prisma.providerCache
    .findFirst({ where: { cacheKey: key, expiresAt: { gt: now } } })
    .catch(() => null);

  if (hit) {
    await recordCall(provider, endpoint, 0, 0, true, ctx);
    return JSON.parse(hit.payload) as T;
  }

  const response = await fetcher();
  const expiresAt = new Date(now.getTime() + ttlDays() * 24 * 60 * 60 * 1000);

  await prisma.providerCache
    .upsert({
      where: { cacheKey: key },
      create: {
        cacheKey: key,
        provider,
        endpoint,
        payload: JSON.stringify(response.data),
        fetchedAt: now,
        expiresAt,
      },
      update: {
        payload: JSON.stringify(response.data),
        fetchedAt: now,
        expiresAt,
      },
    })
    .catch(() => null);

  await recordCall(
    provider,
    endpoint,
    response.unitsConsumed,
    response.costUsd,
    false,
    ctx,
  );
  return response.data;
}

/**
 * Wraps a provider so every call is cache-checked and cost-logged. The return
 * value is deliberately the plain data, not a ProviderResponse — callers above
 * this layer have no business knowing about billable units.
 */
export interface CachedProvider {
  readonly name: string;
  readonly isLive: boolean;
  keywordIdeas(input: KeywordIdeasInput): Promise<RawKeyword[]>;
  searchVolume(input: SearchVolumeInput): Promise<RawKeyword[]>;
  serp(input: SerpInput): Promise<SerpResponse>;
}

export function withCaching(
  provider: KeywordDataProvider,
  ctx: UsageContext = {},
): CachedProvider {
  return {
    name: provider.name,
    isLive: provider.isLive,

    keywordIdeas: (input) =>
      throughCache(provider.name, "keyword_ideas", input, ctx, () =>
        provider.keywordIdeas(input),
      ),

    /**
     * Volume lookups are cached per keyword, not per batch — otherwise a
     * 500-keyword request that overlaps a previous 499-keyword one would miss
     * entirely and re-bill all 500.
     */
    async searchVolume(input: SearchVolumeInput) {
      const unique = [...new Set(input.keywords)];
      const found: RawKeyword[] = [];
      const missing: string[] = [];

      for (const keyword of unique) {
        const key = cacheKey(provider.name, "search_volume", {
          keyword,
          language: input.language,
          location: input.location,
        });
        const hit = await prisma.providerCache
          .findFirst({ where: { cacheKey: key, expiresAt: { gt: new Date() } } })
          .catch(() => null);
        if (hit) found.push(JSON.parse(hit.payload) as RawKeyword);
        else missing.push(keyword);
      }

      if (found.length > 0) {
        await recordCall(provider.name, "search_volume", 0, 0, true, ctx);
      }

      if (missing.length === 0) return found;

      const response = await provider.searchVolume({ ...input, keywords: missing });
      const expiresAt = new Date(Date.now() + ttlDays() * 24 * 60 * 60 * 1000);

      for (const row of response.data) {
        const key = cacheKey(provider.name, "search_volume", {
          keyword: row.text,
          language: input.language,
          location: input.location,
        });
        await prisma.providerCache
          .upsert({
            where: { cacheKey: key },
            create: {
              cacheKey: key,
              provider: provider.name,
              endpoint: "search_volume",
              payload: JSON.stringify(row),
              expiresAt,
            },
            update: { payload: JSON.stringify(row), fetchedAt: new Date(), expiresAt },
          })
          .catch(() => null);
      }

      await recordCall(
        provider.name,
        "search_volume",
        response.unitsConsumed,
        response.costUsd,
        false,
        ctx,
      );
      return [...found, ...response.data];
    },

    serp: (input) =>
      throughCache(provider.name, "serp", input, ctx, () => provider.serp(input)),
  };
}
