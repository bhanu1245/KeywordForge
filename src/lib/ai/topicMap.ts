/**
 * AI Topic Map (PRD §7 module 16).
 *
 * Turns a flat cluster list into a topical-authority structure: a small number
 * of pillar pages, each with the supporting pages that should link to it. That
 * hierarchy is the actual deliverable of a content plan — clusters alone tell
 * you what exists, not what to build first or how it links together.
 *
 * Like content briefs, this has a deterministic fallback so it works with no
 * ANTHROPIC_API_KEY. The fallback is not a stub: pillar selection is a real
 * decision made from volume and cluster size, and Claude is used to improve
 * the naming and grouping rather than to invent the structure.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ClusterView } from "../types";

export interface TopicMapPillar {
  title: string;
  targetKeyword: string;
  intent: string | null;
  totalVolume: number;
  clusterIds: string[];
  supporting: Array<{
    title: string;
    targetKeyword: string;
    volume: number;
    intent: string | null;
    clusterId: string;
  }>;
}

export interface TopicMapPayload {
  pillars: TopicMapPillar[];
  orphans: Array<{ title: string; volume: number; clusterId: string }>;
  generatedBy: "claude" | "heuristic";
  summary: string;
}

export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Content tokens, used to decide which clusters belong under which pillar. */
function keyTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * IDF-weighted overlap between two clusters, computed against the whole set.
 *
 * The plain token count is useless here for the same reason it is in
 * clustering: in a project seeded from "emergency dentist", every cluster
 * contains "emergency" and "dentist", so every pair scores identically and
 * ties resolve to whichever pillar happens to be first — which dumped every
 * cluster onto pillar one and left the rest empty. Weighting by rarity means
 * only the *distinguishing* words count.
 */
function weightedOverlap(
  a: Set<string>,
  b: Set<string>,
  idf: Map<string, number>,
): number {
  let shared = 0;
  let union = 0;
  for (const t of a) {
    const w = idf.get(t) ?? 1;
    union += w;
    if (b.has(t)) shared += w;
  }
  for (const t of b) if (!a.has(t)) union += idf.get(t) ?? 1;
  return union === 0 ? 0 : shared / union;
}

/**
 * Plain, UNWEIGHTED token overlap — used only to decide "is this a new topic?"
 *
 * IDF weighting is exactly wrong for that question. In a project seeded from
 * one term, the shared core ("emergency", "dentist") carries almost no IDF, so
 * "affordable emergency dentist" and "best emergency dentist" score as
 * distinct and each became its own pillar — six pillars for what is plainly
 * one topic. Sharing most of your words means the same topic, however common
 * those words are. IDF still governs which pillar a cluster attaches to, where
 * the distinguishing words genuinely are the signal.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

function buildIdfOver(names: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const name of names) {
    for (const t of keyTokens(name)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(names.length, 1);
  const idf = new Map<string, number>();
  for (const [t, count] of df) idf.set(t, Math.log(1 + n / count));
  return idf;
}

/**
 * Heuristic map: the largest clusters by volume become pillars, and every
 * remaining cluster attaches to whichever pillar it shares the most
 * significant terms with. Clusters that match nothing stay orphans rather than
 * being forced under an unrelated pillar — a wrong parent is worse than none,
 * because it produces internal links that confuse topical signals.
 */
export function buildHeuristicTopicMap(clusters: ClusterView[]): TopicMapPayload {
  if (clusters.length === 0) {
    return {
      pillars: [],
      orphans: [],
      generatedBy: "heuristic",
      summary: "No clusters yet — generate clusters first.",
    };
  }

  const sorted = [...clusters].sort((a, b) => b.totalVolume - a.totalVolume);
  const idf = buildIdfOver(sorted.map((c) => c.name));
  const tokensOf = new Map(sorted.map((c) => [c.id, keyTokens(c.name)]));

  /**
   * Pillars are chosen by DISTINCTIVENESS, not by a cluster-count formula.
   *
   * Deriving the pillar count from the number of clusters (one per five, say)
   * is wrong whenever a project is seeded from a single term: 31 clusters
   * about "emergency dentist" are one topic, not six, and forcing six pillars
   * produced one real pillar and five empty ones. Here a cluster is only
   * promoted if it is genuinely unlike the pillars already chosen — so a
   * single-seed project correctly yields one pillar with many supporting
   * pages, and a broad project yields several.
   */
  // Share a third of your words with an existing pillar and you are a variant
  // of it, not a new topic.
  const NEW_PILLAR_THRESHOLD = 0.34;
  const MAX_PILLARS = 6;

  const pillarSeeds: typeof sorted = [];
  for (const cluster of sorted) {
    if (pillarSeeds.length >= MAX_PILLARS) break;
    const tokens = tokensOf.get(cluster.id)!;
    const closest = pillarSeeds.reduce(
      (max, p) => Math.max(max, jaccard(tokens, tokensOf.get(p.id)!)),
      0,
    );
    if (pillarSeeds.length === 0 || closest < NEW_PILLAR_THRESHOLD) {
      pillarSeeds.push(cluster);
    }
  }

  const pillarIds = new Set(pillarSeeds.map((c) => c.id));
  const rest = sorted.filter((c) => !pillarIds.has(c.id));

  const pillars: TopicMapPillar[] = pillarSeeds.map((c) => ({
    title: titleCase(c.name),
    targetKeyword: c.name,
    intent: c.intent,
    totalVolume: c.totalVolume,
    clusterIds: [c.id],
    supporting: [],
  }));

  const orphans: TopicMapPayload["orphans"] = [];

  for (const cluster of rest) {
    const tokens = tokensOf.get(cluster.id)!;
    let bestIndex = -1;
    let bestOverlap = 0;

    pillarSeeds.forEach((p, i) => {
      const overlap = weightedOverlap(tokens, tokensOf.get(p.id)!, idf);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = i;
      }
    });

    if (bestIndex === -1) {
      orphans.push({ title: titleCase(cluster.name), volume: cluster.totalVolume, clusterId: cluster.id });
      continue;
    }

    pillars[bestIndex].supporting.push({
      title: titleCase(cluster.name),
      targetKeyword: cluster.name,
      volume: cluster.totalVolume,
      intent: cluster.intent,
      clusterId: cluster.id,
    });
    pillars[bestIndex].clusterIds.push(cluster.id);
    pillars[bestIndex].totalVolume += cluster.totalVolume;
  }

  for (const p of pillars) p.supporting.sort((a, b) => b.volume - a.volume);
  pillars.sort((a, b) => b.totalVolume - a.totalVolume);

  const covered = pillars.reduce((n, p) => n + p.clusterIds.length, 0);
  return {
    pillars,
    orphans,
    generatedBy: "heuristic",
    summary: `${pillars.length} pillar page${pillars.length === 1 ? "" : "s"} covering ${covered} of ${clusters.length} clusters. Build the pillars first, then link each supporting page up to its pillar.`,
  };
}

const SYSTEM_PROMPT = `You are an SEO content strategist building a topical authority map.
Given a list of keyword clusters, group them into pillar pages and supporting pages.
Return ONLY valid JSON, no markdown fence, no commentary:
{
  "summary": string,
  "pillars": [{
    "title": string,
    "targetKeyword": string,
    "clusterIds": string[],
    "supportingClusterIds": string[]
  }]
}
Rules:
- 2 to 6 pillars. Each pillar is ONE page that owns a broad topic.
- targetKeyword MUST be one of the supplied cluster names.
- Every clusterId you use MUST come from the input. Never invent ids.
- A cluster belongs to at most one pillar.
- Titles are human page titles, not search queries.`;

export async function generateTopicMap(
  clusters: ClusterView[],
): Promise<TopicMapPayload> {
  const fallback = buildHeuristicTopicMap(clusters);
  if (!isAiEnabled() || clusters.length < 2) return fallback;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            clusters.slice(0, 80).map((c) => ({
              id: c.id,
              name: c.name,
              volume: c.totalVolume,
              intent: c.intent,
              keywords: c.keywordCount,
            })),
          ),
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    const parsed = JSON.parse(text) as {
      summary?: string;
      pillars?: Array<{
        title?: string;
        targetKeyword?: string;
        clusterIds?: string[];
        supportingClusterIds?: string[];
      }>;
    };
    if (!Array.isArray(parsed.pillars) || parsed.pillars.length === 0) return fallback;

    const byId = new Map(clusters.map((c) => [c.id, c]));
    const used = new Set<string>();
    const pillars: TopicMapPillar[] = [];

    for (const p of parsed.pillars) {
      // Trust nothing from the model about ids — a hallucinated cluster id
      // would render an empty pillar the user cannot act on.
      const ownIds = (p.clusterIds ?? []).filter((id) => byId.has(id) && !used.has(id));
      const supportIds = (p.supportingClusterIds ?? []).filter(
        (id) => byId.has(id) && !used.has(id) && !ownIds.includes(id),
      );
      if (ownIds.length === 0 && supportIds.length === 0) continue;

      for (const id of [...ownIds, ...supportIds]) used.add(id);
      const head = byId.get(ownIds[0] ?? supportIds[0])!;

      pillars.push({
        title: p.title || titleCase(head.name),
        targetKeyword: p.targetKeyword || head.name,
        intent: head.intent,
        totalVolume: [...ownIds, ...supportIds].reduce(
          (n, id) => n + (byId.get(id)?.totalVolume ?? 0),
          0,
        ),
        clusterIds: [...ownIds, ...supportIds],
        supporting: supportIds.map((id) => {
          const c = byId.get(id)!;
          return {
            title: titleCase(c.name),
            targetKeyword: c.name,
            volume: c.totalVolume,
            intent: c.intent,
            clusterId: c.id,
          };
        }),
      });
    }

    if (pillars.length === 0) return fallback;

    return {
      pillars: pillars.sort((a, b) => b.totalVolume - a.totalVolume),
      orphans: clusters
        .filter((c) => !used.has(c.id))
        .map((c) => ({ title: titleCase(c.name), volume: c.totalVolume, clusterId: c.id })),
      generatedBy: "claude",
      summary: parsed.summary || fallback.summary,
    };
  } catch (error) {
    console.warn("[ai] topic map generation failed, using heuristic map:", error);
    return fallback;
  }
}
