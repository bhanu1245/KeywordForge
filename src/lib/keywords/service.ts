/**
 * The keyword pipeline: provider data in, scored and persisted rows out.
 *
 * Everything here is written batch-first. PRD §12 requires bulk jobs up to 1M
 * keywords, so no code path may do one query per keyword — the enrichment
 * below runs a fixed number of queries per chunk regardless of input size.
 */

import { prisma } from "../db";
import { getProvider } from "../providers";
import { VOLUME_KEYWORDS_PER_CALL } from "../providers/costs";
import type { Channel, RawKeyword } from "../providers/types";
import { classifyIntent, type Intent } from "../seo/intent";
import type { KeywordFilters, KeywordRow, ProjectAssumptions } from "../types";
import { isQuestion } from "../seo/questions";
import { detectSeasonality, detectTrend } from "../seo/trends";
import { normalizeText, wordCount } from "../seo/normalize";
import {
  DEFAULT_ASSUMPTIONS,
  commercialValue,
  describeAssumptions,
  keywordDifficulty,
  opportunityScore,
  revenuePotential,
  trafficPotential,
  type RevenueAssumptions,
} from "../seo/scoring";

/**
 * SQLite binds one variable per column per row; chunking keeps us clear of
 * the parameter ceiling and keeps memory flat on very large imports.
 */
const CHUNK = 400;

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface EnrichInput {
  projectId: string;
  language: string;
  location: string;
  keywords: RawKeyword[];
  source?: "discovery" | "import" | "manual";
  seed?: string | null;
  /** Search surface these metrics belong to. Part of corpus identity. */
  channel?: Channel;
}

export interface EnrichSummary {
  received: number;
  keywordsCreated: number;
  linkedToProject: number;
}

/**
 * Upserts keywords into the shared corpus, writes a metric snapshot, and
 * links them to the project.
 *
 * NOTE ON `skipDuplicates`: Prisma does not support it on SQLite, so we read
 * the existing rows and filter before inserting. Two queries instead of one,
 * still O(1) per chunk. On Postgres this collapses to a single createMany
 * with skipDuplicates.
 */
export async function enrichAndPersist(
  input: EnrichInput,
): Promise<EnrichSummary> {
  const { projectId, language, location } = input;
  const channel: Channel = input.channel ?? "google";

  // Normalise and de-duplicate up front — providers routinely return the same
  // phrase with different casing/spacing.
  const byText = new Map<string, RawKeyword>();
  for (const raw of input.keywords) {
    const text = normalizeText(raw.text);
    if (!text) continue;
    if (!byText.has(text)) byText.set(text, { ...raw, text });
  }
  const rows = [...byText.values()];
  if (rows.length === 0) {
    return { received: 0, keywordsCreated: 0, linkedToProject: 0 };
  }

  let keywordsCreated = 0;
  let linkedToProject = 0;

  for (const batch of chunk(rows)) {
    const texts = batch.map((r) => r.text);

    const existing = await prisma.keyword.findMany({
      where: { text: { in: texts }, language, location, channel },
      select: { id: true, text: true },
    });
    const existingIds = new Map(existing.map((k) => [k.text, k.id]));
    const toCreate = batch.filter((r) => !existingIds.has(r.text));

    if (toCreate.length > 0) {
      await prisma.keyword.createMany({
        data: toCreate.map((r) => {
          const { intent, confidence } = classifyIntent(r.text);
          return {
            text: r.text,
            language,
            location,
            channel,
            intent,
            intentConfidence: confidence,
            wordCount: wordCount(r.text),
            isQuestion: isQuestion(r.text),
          };
        }),
      });
      keywordsCreated += toCreate.length;
    }

    const all = await prisma.keyword.findMany({
      where: { text: { in: texts }, language, location, channel },
      select: { id: true, text: true, intent: true },
    });
    const idByText = new Map(all.map((k) => [k.text, k.id]));
    const sourceName = getProvider().name;

    // Metric snapshot. Append-only by design (PRD §6: history has to be
    // accumulated from day one — we never overwrite a previous reading).
    await prisma.keywordMetric.createMany({
      data: batch.flatMap((r) => {
        const keywordId = idByText.get(r.text);
        if (!keywordId) return [];
        return [
          {
            keywordId,
            volume: r.volume ?? null,
            cpc: r.cpc ?? null,
            competition: r.competition ?? null,
            difficulty: keywordDifficulty({
              keyword: r.text,
              volume: r.volume,
              competition: r.competition,
            }),
            trend: r.trend ? JSON.stringify(r.trend) : null,
            source: sourceName,
          },
        ];
      }),
    });

    const keywordIds = batch
      .map((r) => idByText.get(r.text))
      .filter((id): id is string => Boolean(id));

    const alreadyLinked = await prisma.projectKeyword.findMany({
      where: { projectId, keywordId: { in: keywordIds } },
      select: { keywordId: true },
    });
    const linkedSet = new Set(alreadyLinked.map((l) => l.keywordId));
    const newLinks = keywordIds.filter((id) => !linkedSet.has(id));

    if (newLinks.length > 0) {
      await prisma.projectKeyword.createMany({
        data: newLinks.map((keywordId) => ({
          projectId,
          keywordId,
          source: input.source ?? "discovery",
          seed: input.seed ?? null,
        })),
      });
      linkedToProject += newLinks.length;
    }
  }

  return { received: rows.length, keywordsCreated, linkedToProject };
}

export interface DiscoverInput {
  projectId: string;
  agencyId: string;
  seed: string;
  limit?: number;
  language: string;
  location: string;
  channel?: Channel;
}

/** Seed -> ideas -> scored rows persisted to the project (PRD §8 flow 1). */
export async function discoverKeywords(
  input: DiscoverInput,
): Promise<EnrichSummary & { seed: string }> {
  const provider = getProvider({
    agencyId: input.agencyId,
    projectId: input.projectId,
  });
  const ideas = await provider.keywordIdeas({
    seed: input.seed,
    limit: input.limit ?? 200,
    language: input.language,
    location: input.location,
    channel: input.channel,
  });

  const summary = await enrichAndPersist({
    projectId: input.projectId,
    language: input.language,
    location: input.location,
    keywords: ideas,
    source: "discovery",
    seed: normalizeText(input.seed),
    channel: input.channel,
  });

  return { ...summary, seed: normalizeText(input.seed) };
}

/** Enrich a list of raw keyword strings — the bulk CSV import path (flow 4). */
export async function enrichKeywordList(input: {
  projectId: string;
  agencyId: string;
  keywords: string[];
  language: string;
  location: string;
  onProgress?: (done: number, total: number) => Promise<void> | void;
}): Promise<EnrichSummary> {
  const provider = getProvider({
    agencyId: input.agencyId,
    projectId: input.projectId,
  });

  const cleaned = [...new Set(input.keywords.map(normalizeText).filter(Boolean))];
  const totals: EnrichSummary = {
    received: 0,
    keywordsCreated: 0,
    linkedToProject: 0,
  };

  // Batch size comes from lib/providers/costs so the quota estimate and the
  // actual number of billable tasks can never disagree.
  for (const batch of chunk(cleaned, VOLUME_KEYWORDS_PER_CALL)) {
    const metrics = await provider.searchVolume({
      keywords: batch,
      language: input.language,
      location: input.location,
    });

    // Keywords the provider had no data for still belong in the project —
    // dropping them would silently lose rows from the user's own import.
    const returned = new Set(metrics.map((m) => m.text));
    const padded = [
      ...metrics,
      ...batch
        .filter((t) => !returned.has(t))
        .map((text) => ({
          text,
          volume: null,
          cpc: null,
          competition: null,
          trend: null,
        })),
    ];

    const summary = await enrichAndPersist({
      projectId: input.projectId,
      language: input.language,
      location: input.location,
      keywords: padded,
      source: "import",
    });

    totals.received += summary.received;
    totals.keywordsCreated += summary.keywordsCreated;
    totals.linkedToProject += summary.linkedToProject;

    await input.onProgress?.(
      Math.min(totals.received, cleaned.length),
      cleaned.length,
    );
  }

  return totals;
}

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

// Row and filter shapes live in lib/types.ts so client components can import
// them without pulling Prisma into the browser bundle.
export type { KeywordRow, KeywordFilters } from "../types";

/**
 * Loads a project's keywords with their most recent metric snapshot.
 *
 * The scores (opportunity, traffic potential, commercial value) are computed
 * on read rather than stored. They are pure functions of the stored inputs, so
 * recomputing costs microseconds and means a weighting change takes effect
 * everywhere instead of leaving stale numbers in old rows.
 */
/**
 * Resolves a project's Revenue Potential assumptions.
 *
 * Returns `configured: false` when the user has not supplied both figures, so
 * the UI can prompt instead of presenting revenue modelled on placeholder
 * numbers nobody chose.
 */
export async function getProjectAssumptions(
  projectId: string,
): Promise<ProjectAssumptions & { resolved: RevenueAssumptions }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      assumedConversionRate: true,
      assumedOrderValue: true,
      assumedPosition: true,
    },
  });

  const conversionRate = project?.assumedConversionRate ?? null;
  const orderValue = project?.assumedOrderValue ?? null;
  const position = project?.assumedPosition ?? DEFAULT_ASSUMPTIONS.position;
  const configured = conversionRate !== null && orderValue !== null && orderValue > 0;

  const resolved: RevenueAssumptions = {
    conversionRate: conversionRate ?? DEFAULT_ASSUMPTIONS.conversionRate,
    orderValue: orderValue ?? DEFAULT_ASSUMPTIONS.orderValue,
    position,
  };

  return {
    conversionRate,
    orderValue,
    position,
    configured,
    description: describeAssumptions(resolved),
    resolved,
  };
}

export async function getProjectKeywords(
  projectId: string,
  filters: KeywordFilters = {},
): Promise<KeywordRow[]> {
  const assumptions = await getProjectAssumptions(projectId);
  const links = await prisma.projectKeyword.findMany({
    where: {
      projectId,
      ...(filters.seed ? { seed: filters.seed } : {}),
      keyword: {
        // Defaults to Google: mixing channels in one table would silently
        // compare a YouTube volume against a Google one.
        channel: filters.channel ?? "google",
        ...(filters.search
          ? { text: { contains: normalizeText(filters.search) } }
          : {}),
        ...(filters.questionsOnly ? { isQuestion: true } : {}),
        ...(filters.intents?.length ? { intent: { in: filters.intents } } : {}),
        ...(filters.minWords ? { wordCount: { gte: filters.minWords } } : {}),
      },
    },
    include: {
      keyword: {
        include: {
          // Latest snapshot only — the full series is for the trend view.
          metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const rows: KeywordRow[] = [];
  for (const link of links) {
    const kw = link.keyword;
    const metric = kw.metrics[0];
    const intent = (kw.intent as Intent | null) ?? classifyIntent(kw.text).intent;
    const difficulty =
      metric?.difficulty ??
      keywordDifficulty({
        keyword: kw.text,
        volume: metric?.volume,
        competition: metric?.competition,
      });

    const volume = metric?.volume ?? null;
    const cpc = metric?.cpc ?? null;

    if (filters.minVolume !== undefined && (volume ?? 0) < filters.minVolume) continue;
    if (filters.maxVolume !== undefined && (volume ?? 0) > filters.maxVolume) continue;
    if (filters.maxDifficulty !== undefined && difficulty > filters.maxDifficulty) continue;
    if (filters.minDifficulty !== undefined && difficulty < filters.minDifficulty) continue;

    let trend: number[] | null = null;
    if (metric?.trend) {
      try {
        trend = JSON.parse(metric.trend) as number[];
      } catch {
        trend = null;
      }
    }

    const trendResult = detectTrend(trend);
    const seasonality = detectSeasonality(trend);

    if (filters.trendDirection && trendResult.direction !== filters.trendDirection) continue;
    if (filters.seasonalOnly && !seasonality.isSeasonal) continue;

    rows.push({
      projectKeywordId: link.id,
      keywordId: kw.id,
      text: kw.text,
      channel: kw.channel,
      trendDirection: trendResult.direction,
      trendChangePercent: trendResult.changePercent,
      isSeasonal: seasonality.isSeasonal,
      peakMonths: seasonality.peakLabels,
      volume,
      cpc,
      competition: metric?.competition ?? null,
      difficulty,
      intent,
      wordCount: kw.wordCount,
      isQuestion: kw.isQuestion,
      intentConfidence: kw.intentConfidence,
      opportunity: opportunityScore({ volume, difficulty, intent }),
      trafficPotential: trafficPotential(volume, assumptions.position),
      commercialValue: commercialValue(volume, cpc, assumptions.position),
      // Zero until the project supplies real assumptions — never a modelled
      // figure built on placeholder defaults.
      revenuePotential: assumptions.configured
        ? revenuePotential(volume, assumptions.resolved)
        : 0,
      trend,
      seed: link.seed,
    });
  }

  return rows.sort((a, b) => b.opportunity - a.opportunity);
}
