/**
 * Historical Data (PRD §7 module 32).
 *
 * No new collection: `keyword_metrics` has been append-only by `capturedAt`
 * since Phase 1, `serp_snapshots` since Phase 2, and `rank_tracking_entries`
 * since Phase 3. PRD §6 is the reason — "you cannot buy someone else's
 * history, you have to accumulate your own from day one" — so the accrual was
 * built first and this is the read side arriving later.
 *
 * Consequence worth stating: a project created today has one data point.
 * Every function here reports how much history actually exists so the UI can
 * say "history builds over time" instead of drawing a one-pixel chart that
 * looks broken.
 */

import { prisma } from "../db";

export interface SeriesPoint {
  date: string;
  value: number | null;
}

export interface KeywordHistory {
  keywordId: string;
  text: string;
  /** Distinct days on record. 0 or 1 means "not enough to plot yet". */
  dataPoints: number;
  firstSeen: string | null;
  lastSeen: string | null;
  volume: SeriesPoint[];
  difficulty: SeriesPoint[];
  /** Null entries mean "checked, not ranking" — a real observation. */
  position: SeriesPoint[];
  serpChecks: number;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Collapses several readings on the same day to the last one.
 *
 * Discovery re-runs and rank checks can both write on one day; plotting every
 * write would show vertical noise rather than a trend.
 */
function byDay(rows: Array<{ at: Date; value: number | null }>): SeriesPoint[] {
  const map = new Map<string, number | null>();
  for (const r of rows) map.set(day(r.at), r.value);
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

export async function getKeywordHistory(
  projectId: string,
  keywordId: string,
): Promise<KeywordHistory | null> {
  // Scoped through the project link, so a keyword from the shared corpus that
  // this project never adopted is not readable here.
  const link = await prisma.projectKeyword.findFirst({
    where: { projectId, keywordId },
    include: { keyword: true },
  });
  if (!link) return null;

  const [metrics, ranks, serpCount] = await Promise.all([
    prisma.keywordMetric.findMany({
      where: { keywordId },
      orderBy: { capturedAt: "asc" },
      select: { capturedAt: true, volume: true, difficulty: true },
    }),
    prisma.rankTrackingEntry.findMany({
      where: { projectId, keywordId },
      orderBy: { checkedAt: "asc" },
      select: { checkedAt: true, position: true },
    }),
    prisma.serpSnapshot.count({ where: { keywordId } }),
  ]);

  const volume = byDay(metrics.map((m) => ({ at: m.capturedAt, value: m.volume })));
  const difficulty = byDay(metrics.map((m) => ({ at: m.capturedAt, value: m.difficulty })));
  const position = byDay(ranks.map((r) => ({ at: r.checkedAt, value: r.position })));

  const days = new Set([...volume, ...position].map((p) => p.date));

  return {
    keywordId,
    text: link.keyword.text,
    dataPoints: days.size,
    firstSeen: metrics[0] ? day(metrics[0].capturedAt) : null,
    lastSeen: metrics.at(-1) ? day(metrics.at(-1)!.capturedAt) : null,
    volume,
    difficulty,
    position,
    serpChecks: serpCount,
  };
}

export interface ProjectHistory {
  /** Distinct days with any reading. Drives the "not enough yet" state. */
  dataPoints: number;
  firstSeen: string | null;
  trackedKeywords: number;
  serpChecks: number;
  rankChecks: number;
  /** Combined monthly search volume across the project, over time. */
  totalVolume: SeriesPoint[];
  /** Mean difficulty across the project, over time. */
  avgDifficulty: SeriesPoint[];
  /** Mean position of ranking keywords, over time. Lower is better. */
  avgPosition: SeriesPoint[];
  /** Keywords in the top 10, over time. */
  topTen: SeriesPoint[];
  /** Keywords with enough history to chart individually. */
  keywords: Array<{ keywordId: string; text: string; dataPoints: number }>;
}

export async function getProjectHistory(projectId: string): Promise<ProjectHistory> {
  const links = await prisma.projectKeyword.findMany({
    where: { projectId },
    select: { keywordId: true, keyword: { select: { text: true } } },
  });
  const keywordIds = links.map((l) => l.keywordId);

  if (keywordIds.length === 0) {
    return {
      dataPoints: 0,
      firstSeen: null,
      trackedKeywords: 0,
      serpChecks: 0,
      rankChecks: 0,
      totalVolume: [],
      avgDifficulty: [],
      avgPosition: [],
      topTen: [],
      keywords: [],
    };
  }

  const [metrics, ranks, serpChecks] = await Promise.all([
    prisma.keywordMetric.findMany({
      where: { keywordId: { in: keywordIds } },
      orderBy: { capturedAt: "asc" },
      select: { keywordId: true, capturedAt: true, volume: true, difficulty: true },
    }),
    prisma.rankTrackingEntry.findMany({
      where: { projectId },
      orderBy: { checkedAt: "asc" },
      select: { keywordId: true, checkedAt: true, position: true },
    }),
    prisma.serpSnapshot.count({ where: { keywordId: { in: keywordIds } } }),
  ]);

  /**
   * Per day, take each keyword's LATEST reading, then aggregate across
   * keywords. Summing raw rows would double-count a keyword measured twice in
   * one day and make total volume jump for no real reason.
   */
  const perDay = new Map<string, Map<string, { volume: number | null; difficulty: number | null }>>();
  for (const m of metrics) {
    const d = day(m.capturedAt);
    const bucket = perDay.get(d) ?? new Map();
    bucket.set(m.keywordId, { volume: m.volume, difficulty: m.difficulty });
    perDay.set(d, bucket);
  }

  const rankPerDay = new Map<string, Map<string, number | null>>();
  for (const r of ranks) {
    const d = day(r.checkedAt);
    const bucket = rankPerDay.get(d) ?? new Map();
    bucket.set(r.keywordId, r.position);
    rankPerDay.set(d, bucket);
  }

  const totalVolume: SeriesPoint[] = [];
  const avgDifficulty: SeriesPoint[] = [];
  for (const [date, bucket] of [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rows = [...bucket.values()];
    totalVolume.push({ date, value: rows.reduce((n, r) => n + (r.volume ?? 0), 0) });
    const withKd = rows.filter((r) => typeof r.difficulty === "number");
    avgDifficulty.push({
      date,
      value:
        withKd.length === 0
          ? null
          : Number(
              (withKd.reduce((n, r) => n + (r.difficulty ?? 0), 0) / withKd.length).toFixed(1),
            ),
    });
  }

  const avgPosition: SeriesPoint[] = [];
  const topTen: SeriesPoint[] = [];
  for (const [date, bucket] of [...rankPerDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Only keywords that actually rank contribute to the average; counting
    // "not ranking" as a number would need an arbitrary stand-in value.
    const ranking = [...bucket.values()].filter((p): p is number => p !== null);
    avgPosition.push({
      date,
      value:
        ranking.length === 0
          ? null
          : Number((ranking.reduce((a, b) => a + b, 0) / ranking.length).toFixed(1)),
    });
    topTen.push({ date, value: ranking.filter((p) => p <= 10).length });
  }

  const allDays = new Set([...perDay.keys(), ...rankPerDay.keys()]);
  const pointsPerKeyword = new Map<string, Set<string>>();
  for (const m of metrics) {
    const set = pointsPerKeyword.get(m.keywordId) ?? new Set();
    set.add(day(m.capturedAt));
    pointsPerKeyword.set(m.keywordId, set);
  }

  return {
    dataPoints: allDays.size,
    firstSeen: [...allDays].sort()[0] ?? null,
    trackedKeywords: keywordIds.length,
    serpChecks,
    rankChecks: ranks.length,
    totalVolume,
    avgDifficulty,
    avgPosition,
    topTen,
    keywords: links
      .map((l) => ({
        keywordId: l.keywordId,
        text: l.keyword.text,
        dataPoints: pointsPerKeyword.get(l.keywordId)?.size ?? 0,
      }))
      .sort((a, b) => b.dataPoints - a.dataPoints)
      .slice(0, 200),
  };
}
