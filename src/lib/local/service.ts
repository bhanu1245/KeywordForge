/**
 * Local SEO (PRD §7 module 22).
 *
 * Two questions an agency actually asks for a local client:
 *   1. Which of my keywords trigger a local pack? Those cannot be won with a
 *      blog post — they need a Google Business Profile, citations and reviews.
 *   2. Who owns those packs?
 *
 * Both are answered from SERP data already collected, so this module costs no
 * additional provider calls. It is a *reading* of the SERP corpus rather than
 * a separate data source.
 */

import { prisma } from "../db";
import { normaliseDomain } from "../competitors/service";
import { normalizeText } from "../seo/normalize";

/** Modifiers that signal local intent even when no pack is present. */
const LOCAL_MODIFIERS = [
  "near me", "nearby", "in my area", "open now", "closest", "nearest",
  "local", "directions", "opening hours", "phone number", "address",
  "walk in", "same day", "emergency", "24 hour",
];

export function hasLocalIntent(keyword: string): boolean {
  const text = ` ${normalizeText(keyword)} `;
  return LOCAL_MODIFIERS.some((m) => text.includes(` ${m} `));
}

export interface LocalKeywordRow {
  keywordId: string;
  text: string;
  volume: number | null;
  difficulty: number | null;
  /** Google returned a local pack for this query. */
  hasLocalPack: boolean;
  /** The phrase itself carries local intent. */
  localIntent: boolean;
  ownPosition: number | null;
}

export interface LocalSummary {
  /** Keywords with local intent OR a local pack. */
  localKeywords: number;
  withLocalPack: number;
  analyzed: number;
  /** Share of ANALYSED keywords showing a pack. */
  packShare: number;
  topLocalCompetitors: Array<{ domain: string; appearances: number }>;
  rows: LocalKeywordRow[];
}

export async function getLocalSummary(
  projectId: string,
  ownDomain: string | null,
): Promise<LocalSummary> {
  const own = ownDomain ? normaliseDomain(ownDomain) : null;

  const links = await prisma.projectKeyword.findMany({
    where: { projectId, keyword: { channel: { in: ["google", "google_maps"] } } },
    include: {
      keyword: {
        include: {
          metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
          serpSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
          serpRankings: true,
        },
      },
    },
  });

  const rows: LocalKeywordRow[] = [];
  const competitorCounts = new Map<string, number>();
  let analyzed = 0;
  let withLocalPack = 0;

  for (const link of links) {
    const kw = link.keyword;
    const snapshot = kw.serpSnapshots[0];

    let features: string[] = [];
    if (snapshot) {
      analyzed++;
      try {
        features = JSON.parse(snapshot.features) as string[];
      } catch {
        features = [];
      }
    }

    const hasLocalPack = features.includes("local_pack");
    const localIntent = hasLocalIntent(kw.text);
    if (hasLocalPack) withLocalPack++;

    // Only surface keywords that are actually local in some way.
    if (!hasLocalPack && !localIntent) continue;

    const ourBest = own
      ? kw.serpRankings.filter((r) => r.domain === own).sort((a, b) => a.position - b.position)[0]
      : undefined;

    // Who shows up on local queries — the local competitor set is usually
    // different from the national one, which is the point of the module.
    for (const r of kw.serpRankings) {
      if (r.domain === own || r.position > 5) continue;
      competitorCounts.set(r.domain, (competitorCounts.get(r.domain) ?? 0) + 1);
    }

    rows.push({
      keywordId: kw.id,
      text: kw.text,
      volume: kw.metrics[0]?.volume ?? null,
      difficulty: kw.metrics[0]?.difficulty ?? null,
      hasLocalPack,
      localIntent,
      ownPosition: ourBest?.position ?? null,
    });
  }

  return {
    localKeywords: rows.length,
    withLocalPack,
    analyzed,
    packShare: analyzed === 0 ? 0 : Math.round((withLocalPack / analyzed) * 100),
    topLocalCompetitors: [...competitorCounts.entries()]
      .map(([domain, appearances]) => ({ domain, appearances }))
      .sort((a, b) => b.appearances - a.appearances)
      .slice(0, 8),
    rows: rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)),
  };
}
