/**
 * Rank Tracker (PRD §7 module 21) and Keyword Cannibalisation (module 26).
 *
 * Rank tracking reuses the SERP job rather than adding a second fetch path:
 * one SERP call already contains our position, so tracking is a matter of
 * recording it on a schedule. PRD §5 sets the cadence expectation — daily, not
 * hourly — which keeps the cost proportionate.
 *
 * PRD §6 note: history cannot be bought. Every check appends a row, and a
 * keyword that has dropped out of the top 100 records `position: null` rather
 * than nothing — otherwise a fall out of the rankings is indistinguishable
 * from never having checked.
 */

import { prisma } from "../db";
import { normaliseDomain } from "../competitors/service";

export interface RankSnapshotRow {
  keywordId: string;
  text: string;
  volume: number | null;
  position: number | null;
  previousPosition: number | null;
  /** Positive = improved (moved toward #1). */
  change: number | null;
  url: string | null;
  checkedAt: Date | null;
}

export interface RankSummary {
  tracked: number;
  ranking: number;
  topThree: number;
  topTen: number;
  improved: number;
  declined: number;
  averagePosition: number | null;
  rows: RankSnapshotRow[];
}

/**
 * Records current positions for the project's domain from the SERP rankings
 * already collected. Returns how many entries were written.
 */
export async function recordRankSnapshot(
  projectId: string,
  ownDomain: string,
): Promise<number> {
  const domain = normaliseDomain(ownDomain);

  const links = await prisma.projectKeyword.findMany({
    where: { projectId, keyword: { channel: "google" } },
    include: { keyword: { include: { serpRankings: true } } },
  });

  const rows = links.flatMap((link) => {
    const rankings = link.keyword.serpRankings;
    // No SERP on record means "not checked", which is not the same as "not
    // ranking" — skip rather than writing a false null.
    if (rankings.length === 0) return [];

    const ours = rankings
      .filter((r) => r.domain === domain)
      .sort((a, b) => a.position - b.position)[0];

    return [
      {
        projectId,
        keywordId: link.keywordId,
        domain,
        position: ours?.position ?? null,
        url: ours?.url ?? null,
      },
    ];
  });

  if (rows.length === 0) return 0;
  await prisma.rankTrackingEntry.createMany({ data: rows });
  return rows.length;
}

/** Latest position per keyword, with movement against the previous check. */
export async function getRankSummary(
  projectId: string,
  ownDomain: string | null,
): Promise<RankSummary> {
  const empty: RankSummary = {
    tracked: 0,
    ranking: 0,
    topThree: 0,
    topTen: 0,
    improved: 0,
    declined: 0,
    averagePosition: null,
    rows: [],
  };
  if (!ownDomain) return empty;

  const entries = await prisma.rankTrackingEntry.findMany({
    where: { projectId, domain: normaliseDomain(ownDomain) },
    orderBy: { checkedAt: "desc" },
    include: {
      keyword: { include: { metrics: { orderBy: { capturedAt: "desc" }, take: 1 } } },
    },
  });
  if (entries.length === 0) return empty;

  // Newest first, so the first two per keyword are current and previous.
  const byKeyword = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byKeyword.get(e.keywordId);
    if (list) list.push(e);
    else byKeyword.set(e.keywordId, [e]);
  }

  const rows: RankSnapshotRow[] = [];
  for (const [keywordId, list] of byKeyword) {
    const current = list[0];
    const previous = list[1];
    const change =
      current.position !== null && previous?.position != null
        ? previous.position - current.position // positive = improved
        : null;

    rows.push({
      keywordId,
      text: current.keyword.text,
      volume: current.keyword.metrics[0]?.volume ?? null,
      position: current.position,
      previousPosition: previous?.position ?? null,
      change,
      url: current.url,
      checkedAt: current.checkedAt,
    });
  }

  const ranked = rows.filter((r) => r.position !== null);
  return {
    tracked: rows.length,
    ranking: ranked.length,
    topThree: ranked.filter((r) => (r.position ?? 99) <= 3).length,
    topTen: ranked.filter((r) => (r.position ?? 99) <= 10).length,
    improved: rows.filter((r) => (r.change ?? 0) > 0).length,
    declined: rows.filter((r) => (r.change ?? 0) < 0).length,
    averagePosition:
      ranked.length === 0
        ? null
        : Number(
            (ranked.reduce((n, r) => n + (r.position ?? 0), 0) / ranked.length).toFixed(1),
          ),
    // Best positions first; unranked keywords last.
    rows: rows.sort(
      (a, b) => (a.position ?? 999) - (b.position ?? 999) || (b.volume ?? 0) - (a.volume ?? 0),
    ),
  };
}

/** Position history for one keyword, oldest first — for the sparkline. */
export async function getRankHistory(projectId: string, keywordId: string) {
  const entries = await prisma.rankTrackingEntry.findMany({
    where: { projectId, keywordId },
    orderBy: { checkedAt: "asc" },
    select: { position: true, checkedAt: true },
  });
  return entries.map((e) => ({
    position: e.position,
    checkedAt: e.checkedAt.toISOString(),
  }));
}

export interface CannibalisationRow {
  keywordId: string;
  text: string;
  volume: number | null;
  /** Two or more of OUR pages competing for the same keyword. */
  urls: Array<{ url: string; position: number }>;
  bestPosition: number;
  /** Positions lost to the split, roughly: worst minus best. */
  spread: number;
}

/**
 * Keyword Cannibalisation (module 26).
 *
 * Detects the same site holding multiple positions for one keyword with
 * DIFFERENT URLs — two pages competing, splitting link equity and click share.
 *
 * This is why `SerpRanking` is keyed on URL rather than domain: an earlier
 * shape kept only each domain's best position, which discarded precisely the
 * duplicate rows this reads.
 */
export async function getCannibalisation(
  projectId: string,
  ownDomain: string | null,
): Promise<CannibalisationRow[]> {
  if (!ownDomain) return [];
  const domain = normaliseDomain(ownDomain);

  const links = await prisma.projectKeyword.findMany({
    where: { projectId },
    include: {
      keyword: {
        include: {
          metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
          serpRankings: { where: { domain } },
        },
      },
    },
  });

  const rows: CannibalisationRow[] = [];
  for (const link of links) {
    const ours = link.keyword.serpRankings;
    // Distinct URLs only — the same page at two positions is not cannibalism.
    const byUrl = new Map<string, number>();
    for (const r of ours) {
      const existing = byUrl.get(r.url);
      if (existing === undefined || r.position < existing) byUrl.set(r.url, r.position);
    }
    if (byUrl.size < 2) continue;

    const urls = [...byUrl.entries()]
      .map(([url, position]) => ({ url, position }))
      .sort((a, b) => a.position - b.position);

    rows.push({
      keywordId: link.keywordId,
      text: link.keyword.text,
      volume: link.keyword.metrics[0]?.volume ?? null,
      urls,
      bestPosition: urls[0].position,
      spread: urls[urls.length - 1].position - urls[0].position,
    });
  }

  // Highest volume first — that is where the split costs most.
  return rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
}
