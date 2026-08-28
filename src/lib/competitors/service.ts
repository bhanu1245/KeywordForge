/**
 * Competitor Keywords, Keyword Gap and Content Gap
 * (PRD §7 modules 12, 13 and 14).
 *
 * HOW THIS WORKS WITHOUT A CRAWL INDEX — read before trusting the numbers:
 * Ahrefs answers "what does competitor X rank for" from its own web-scale
 * index. PRD §6 rules that out at MVP. So everything here is derived from the
 * SERPs *we* have actually collected for *this project's* keywords.
 *
 * The practical consequence: a competitor's keyword set is only ever as
 * complete as the SERP analysis you have run. It cannot surface a keyword you
 * have never analysed, and it is not a full picture of their organic
 * footprint. Within the project's own keyword set — which is the set an
 * agency is actually planning against — it is accurate, because it comes from
 * the live SERP rather than an estimate. The UI states this explicitly rather
 * than implying Ahrefs-like coverage.
 */

import { prisma } from "../db";
import type { Intent } from "../seo/intent";

export function normaliseDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export interface CompetitorSummary {
  domain: string;
  /** Keywords (in this project) where the domain appears in the top 10. */
  keywordCount: number;
  /** Combined monthly volume of those keywords. */
  totalVolume: number;
  averagePosition: number;
  /** Positions 1–3, the ones actually taking the clicks. */
  topThree: number;
  /** True for a competitor row the user explicitly tracks. */
  tracked: boolean;
}

/**
 * Every domain seen across the project's analysed SERPs, ranked by the volume
 * it commands. This doubles as competitor DISCOVERY — the agency often does
 * not know who they are competing with until they see this list.
 */
export async function getCompetitorLandscape(
  projectId: string,
): Promise<CompetitorSummary[]> {
  const links = await prisma.projectKeyword.findMany({
    where: { projectId },
    select: { keywordId: true },
  });
  const keywordIds = links.map((l) => l.keywordId);
  if (keywordIds.length === 0) return [];

  const [rankings, volumes, tracked] = await Promise.all([
    prisma.serpRanking.findMany({ where: { keywordId: { in: keywordIds } } }),
    prisma.keywordMetric.findMany({
      where: { keywordId: { in: keywordIds } },
      orderBy: { capturedAt: "desc" },
      select: { keywordId: true, volume: true },
    }),
    prisma.competitor.findMany({ where: { projectId }, select: { domain: true } }),
  ]);

  // Latest metric wins; the list is already newest-first.
  const volumeByKeyword = new Map<string, number>();
  for (const m of volumes) {
    if (!volumeByKeyword.has(m.keywordId)) volumeByKeyword.set(m.keywordId, m.volume ?? 0);
  }

  const trackedSet = new Set(tracked.map((t) => normaliseDomain(t.domain)));
  const acc = new Map<
    string,
    { count: number; volume: number; positions: number[]; topThree: number }
  >();

  for (const r of rankings) {
    const entry = acc.get(r.domain) ?? { count: 0, volume: 0, positions: [], topThree: 0 };
    entry.count++;
    entry.volume += volumeByKeyword.get(r.keywordId) ?? 0;
    entry.positions.push(r.position);
    if (r.position <= 3) entry.topThree++;
    acc.set(r.domain, entry);
  }

  return [...acc.entries()]
    .map(([domain, v]) => ({
      domain,
      keywordCount: v.count,
      totalVolume: v.volume,
      averagePosition: Number(
        (v.positions.reduce((a, b) => a + b, 0) / v.positions.length).toFixed(1),
      ),
      topThree: v.topThree,
      tracked: trackedSet.has(domain),
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

export interface CompetitorKeyword {
  keywordId: string;
  text: string;
  volume: number | null;
  difficulty: number | null;
  intent: Intent | null;
  competitorPosition: number;
  /** null when the project's own domain does not rank in the top 10. */
  ownPosition: number | null;
  opportunity: "gap" | "behind" | "ahead";
}

/**
 * Module 12 + 13. Every project keyword the competitor ranks for, annotated
 * with where we rank:
 *   gap    — they rank, we do not (the pitch slide)
 *   behind — both rank, they are higher
 *   ahead  — we are higher
 */
export async function getCompetitorKeywords(
  projectId: string,
  competitorDomain: string,
  ownDomain: string | null,
): Promise<CompetitorKeyword[]> {
  const competitor = normaliseDomain(competitorDomain);
  const own = ownDomain ? normaliseDomain(ownDomain) : null;

  const links = await prisma.projectKeyword.findMany({
    where: { projectId },
    include: {
      keyword: {
        include: {
          metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
          serpRankings: {
            where: own ? { domain: { in: [competitor, own] } } : { domain: competitor },
          },
        },
      },
    },
  });

  const rows: CompetitorKeyword[] = [];
  for (const link of links) {
    const kw = link.keyword;
    const theirs = kw.serpRankings.find((r) => r.domain === competitor);
    if (!theirs) continue;

    const ours = own ? kw.serpRankings.find((r) => r.domain === own) : undefined;
    const ownPosition = ours?.position ?? null;

    rows.push({
      keywordId: kw.id,
      text: kw.text,
      volume: kw.metrics[0]?.volume ?? null,
      difficulty: kw.metrics[0]?.difficulty ?? null,
      intent: (kw.intent as Intent | null) ?? null,
      competitorPosition: theirs.position,
      ownPosition,
      opportunity:
        ownPosition === null
          ? "gap"
          : ownPosition > theirs.position
            ? "behind"
            : "ahead",
    });
  }

  // Gaps first, then the biggest volume — that is the order you present in.
  const rank = { gap: 0, behind: 1, ahead: 2 };
  return rows.sort(
    (a, b) =>
      rank[a.opportunity] - rank[b.opportunity] || (b.volume ?? 0) - (a.volume ?? 0),
  );
}

export interface ContentGapCluster {
  clusterId: string;
  name: string;
  intent: string | null;
  keywordCount: number;
  totalVolume: number;
  /** Keywords in this cluster where at least one competitor ranks and we don't. */
  gapKeywords: number;
  /** Volume sitting behind those gaps. */
  gapVolume: number;
  competitorsPresent: string[];
  /** 0–100: share of the cluster's volume we are absent from. */
  gapScore: number;
}

/**
 * Module 14 — Content Gap, at TOPIC level rather than keyword level.
 *
 * Keyword gap gives a list; content gap tells you what to *build*. A cluster
 * where competitors rank across most keywords and we rank on none is a
 * missing page, not fifty missing keywords — which is the unit a content plan
 * is actually written in.
 */
export async function getContentGap(
  projectId: string,
  ownDomain: string | null,
  competitorDomains?: string[],
): Promise<ContentGapCluster[]> {
  const own = ownDomain ? normaliseDomain(ownDomain) : null;
  const filterSet = competitorDomains?.length
    ? new Set(competitorDomains.map(normaliseDomain))
    : null;

  const clusters = await prisma.cluster.findMany({
    where: { projectId },
    include: {
      keywords: {
        include: {
          projectKeyword: {
            include: {
              keyword: {
                include: {
                  metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
                  serpRankings: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const out: ContentGapCluster[] = [];

  for (const cluster of clusters) {
    let gapKeywords = 0;
    let gapVolume = 0;
    let totalVolume = 0;
    const competitorsPresent = new Set<string>();

    for (const ck of cluster.keywords) {
      const kw = ck.projectKeyword.keyword;
      const volume = kw.metrics[0]?.volume ?? 0;
      totalVolume += volume;

      const rankings = kw.serpRankings;
      // Only count keywords we have actually analysed — an unanalysed keyword
      // is unknown, not a gap.
      if (rankings.length === 0) continue;

      const rivals = rankings.filter(
        (r) => r.domain !== own && (!filterSet || filterSet.has(r.domain)),
      );
      if (rivals.length === 0) continue;

      const weRank = own ? rankings.some((r) => r.domain === own) : false;
      if (!weRank) {
        gapKeywords++;
        gapVolume += volume;
        for (const r of rivals.slice(0, 3)) competitorsPresent.add(r.domain);
      }
    }

    if (gapKeywords === 0) continue;

    out.push({
      clusterId: cluster.id,
      name: cluster.name,
      intent: cluster.intent,
      keywordCount: cluster.keywordCount,
      totalVolume,
      gapKeywords,
      gapVolume,
      competitorsPresent: [...competitorsPresent],
      gapScore: totalVolume === 0 ? 0 : Math.round((gapVolume / totalVolume) * 100),
    });
  }

  // Biggest addressable volume first.
  return out.sort((a, b) => b.gapVolume - a.gapVolume);
}

export async function addCompetitor(projectId: string, domain: string) {
  const clean = normaliseDomain(domain);
  const existing = await prisma.competitor.findFirst({
    where: { projectId, domain: clean },
  });
  if (existing) return existing;
  return prisma.competitor.create({ data: { projectId, domain: clean } });
}

export async function removeCompetitor(projectId: string, domain: string) {
  await prisma.competitor.deleteMany({
    where: { projectId, domain: normaliseDomain(domain) },
  });
}
