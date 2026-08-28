/**
 * SERP Analyzer + SERP Features (PRD §7 modules 11 and 18).
 *
 * One paid SERP call per keyword yields three things at once, which is why
 * these are a single module in practice rather than three:
 *   1. the ranked results (SERP Analyzer)
 *   2. the features present — featured snippet, PAA, local pack (module 18)
 *   3. a real `serpStrength` for the difficulty score, which until now always
 *      fell back to its weaker non-SERP weighting
 *
 * SERP calls are the expensive ones (PRD §6), so this is always explicit and
 * batched — never implicit on discovery, which would multiply the cost of
 * every search by the number of ideas returned.
 */

import { prisma } from "../db";
import { getProvider } from "../providers";
import type { SerpResultItem } from "../providers/types";
import { keywordDifficulty } from "../seo/scoring";

export interface AnalyzeSerpInput {
  projectId: string;
  agencyId: string;
  /** Analyse only these project keywords; omit to take the top N by volume. */
  keywordIds?: string[];
  limit?: number;
  language: string;
  location: string;
  /** The project's own domain, so its rankings are recorded too. */
  ownDomain?: string | null;
  onProgress?: (done: number, total: number) => Promise<void> | void;
}

export interface AnalyzeSerpResult {
  analyzed: number;
  featuresFound: Record<string, number>;
  ownRankings: number;
}

/**
 * MOCK-ONLY: seeds the project's own domain into a deterministic subset of
 * SERPs.
 *
 * Without this, gap analysis on mock data reports that the project ranks for
 * nothing, so every keyword is a "gap" and the feature looks broken rather
 * than merely empty. It fabricates rankings, so it is strictly limited to the
 * mock provider and skipped entirely when a live source is connected — real
 * rankings must only ever come from real data.
 */
function seedOwnDomain(
  results: SerpResultItem[],
  ownDomain: string,
  keyword: string,
): SerpResultItem[] {
  let h = 0;
  for (let i = 0; i < keyword.length; i++) h = (h * 31 + keyword.charCodeAt(i)) >>> 0;
  // Rank for roughly 40% of keywords, biased to mid positions.
  if (h % 100 >= 40) return results;

  const slot = 2 + (h % 7); // positions 3–9
  if (slot >= results.length) return results;

  const clone = [...results];
  clone[slot] = {
    ...clone[slot],
    domain: ownDomain,
    url: `https://${ownDomain}/${keyword.replace(/\s+/g, "-")}`,
    title: `${keyword} — ${ownDomain.split(".")[0]}`,
  };
  return clone;
}

function normaliseDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "");
}

export async function analyzeSerps(
  input: AnalyzeSerpInput,
): Promise<AnalyzeSerpResult> {
  const provider = getProvider({
    agencyId: input.agencyId,
    projectId: input.projectId,
  });

  const links = await prisma.projectKeyword.findMany({
    where: {
      projectId: input.projectId,
      ...(input.keywordIds?.length ? { keywordId: { in: input.keywordIds } } : {}),
    },
    include: {
      keyword: {
        include: { metrics: { orderBy: { capturedAt: "desc" }, take: 1 } },
      },
    },
  });

  // Highest volume first: if a budget-capped run only covers part of the set,
  // it should cover the keywords that matter.
  const ordered = links
    .sort((a, b) => (b.keyword.metrics[0]?.volume ?? 0) - (a.keyword.metrics[0]?.volume ?? 0))
    .slice(0, input.limit ?? 50);

  const featuresFound: Record<string, number> = {};
  const ownDomain = input.ownDomain ? normaliseDomain(input.ownDomain) : null;
  let analyzed = 0;
  let ownRankings = 0;

  for (const link of ordered) {
    const kw = link.keyword;
    const serp = await provider.serp({
      keyword: kw.text,
      language: input.language,
      location: input.location,
      depth: 10,
    });

    let results = serp.results;
    if (ownDomain && !provider.isLive) {
      results = seedOwnDomain(results, ownDomain, kw.text);
    }

    const strengths = results
      .map((r) => r.domainStrength)
      .filter((s): s is number => typeof s === "number");
    const meanStrength =
      strengths.length > 0
        ? Number((strengths.reduce((a, b) => a + b, 0) / strengths.length).toFixed(1))
        : null;

    await prisma.serpSnapshot.create({
      data: {
        keywordId: kw.id,
        results: JSON.stringify(results),
        features: JSON.stringify(serp.features),
        meanStrength,
        source: provider.name,
      },
    });

    // Replace current rankings wholesale — this table is "where things stand
    // now"; history lives in SerpSnapshot.
    await prisma.serpRanking.deleteMany({ where: { keywordId: kw.id } });
    const seen = new Set<string>();
    const rows = results.flatMap((r) => {
      const domain = normaliseDomain(r.domain);
      // A domain can hold several positions for one keyword; keep its best.
      if (!domain || seen.has(domain)) return [];
      seen.add(domain);
      return [{ keywordId: kw.id, domain, position: r.position, url: r.url }];
    });
    if (rows.length > 0) await prisma.serpRanking.createMany({ data: rows });
    if (ownDomain && seen.has(ownDomain)) ownRankings++;

    for (const feature of serp.features) {
      featuresFound[feature] = (featuresFound[feature] ?? 0) + 1;
    }

    // Now that a real SERP sample exists, difficulty can use its strongest
    // signal instead of the volume/competition/length fallback.
    const metric = kw.metrics[0];
    if (meanStrength !== null) {
      await prisma.keywordMetric.create({
        data: {
          keywordId: kw.id,
          volume: metric?.volume ?? null,
          cpc: metric?.cpc ?? null,
          competition: metric?.competition ?? null,
          trend: metric?.trend ?? null,
          source: provider.name,
          difficulty: keywordDifficulty({
            keyword: kw.text,
            volume: metric?.volume,
            competition: metric?.competition,
            serpStrength: meanStrength,
          }),
        },
      });
    }

    analyzed++;
    await input.onProgress?.(analyzed, ordered.length);
  }

  return { analyzed, featuresFound, ownRankings };
}

export interface SerpView {
  keywordId: string;
  keyword: string;
  capturedAt: Date;
  meanStrength: number | null;
  features: string[];
  results: SerpResultItem[];
}

/** Most recent SERP for one keyword, for the analyzer panel. */
export async function getSerpForKeyword(
  keywordId: string,
): Promise<SerpView | null> {
  const snapshot = await prisma.serpSnapshot.findFirst({
    where: { keywordId },
    orderBy: { capturedAt: "desc" },
    include: { keyword: true },
  });
  if (!snapshot) return null;

  const parse = <T,>(raw: string, fallback: T): T => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  return {
    keywordId,
    keyword: snapshot.keyword.text,
    capturedAt: snapshot.capturedAt,
    meanStrength: snapshot.meanStrength,
    features: parse<string[]>(snapshot.features, []),
    results: parse<SerpResultItem[]>(snapshot.results, []),
  };
}

export interface SerpCoverage {
  analyzed: number;
  total: number;
  features: Array<{ feature: string; count: number; share: number }>;
  /** Keywords with a SERP on record, for the analyzer picker. */
  analyzedKeywords: Array<{
    keywordId: string;
    text: string;
    volume: number | null;
    meanStrength: number | null;
    features: string[];
  }>;
}

/**
 * Project-level SERP feature summary (module 18). The share figure is what a
 * strategist acts on: "62% of these keywords show a featured snippet" changes
 * how the content is written.
 */
export async function getSerpCoverage(projectId: string): Promise<SerpCoverage> {
  const links = await prisma.projectKeyword.findMany({
    where: { projectId },
    include: {
      keyword: {
        include: {
          metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
          serpSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const counts: Record<string, number> = {};
  const analyzedKeywords: SerpCoverage["analyzedKeywords"] = [];

  for (const link of links) {
    const snapshot = link.keyword.serpSnapshots[0];
    if (!snapshot) continue;
    let features: string[] = [];
    try {
      features = JSON.parse(snapshot.features) as string[];
    } catch {
      features = [];
    }
    for (const f of features) counts[f] = (counts[f] ?? 0) + 1;
    analyzedKeywords.push({
      keywordId: link.keywordId,
      text: link.keyword.text,
      volume: link.keyword.metrics[0]?.volume ?? null,
      meanStrength: snapshot.meanStrength,
      features,
    });
  }

  const analyzed = analyzedKeywords.length;
  return {
    analyzed,
    total: links.length,
    features: Object.entries(counts)
      .map(([feature, count]) => ({
        feature,
        count,
        share: analyzed === 0 ? 0 : Math.round((count / analyzed) * 100),
      }))
      .sort((a, b) => b.count - a.count),
    analyzedKeywords: analyzedKeywords.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)),
  };
}
