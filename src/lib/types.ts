/**
 * Shapes shared between the server services and the client components.
 *
 * Kept in a module with no server-only imports (no Prisma, no node:*) so that
 * client components can `import type` from here without dragging the database
 * client into the browser bundle.
 */

import type { Intent } from "./seo/intent";

export type { Intent };

export interface KeywordRow {
  projectKeywordId: string;
  keywordId: string;
  text: string;
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number;
  intent: Intent;
  /** Classifier confidence 0..1; 0 means "no signal, defaulted". */
  intentConfidence: number;
  wordCount: number;
  isQuestion: boolean;
  opportunity: number;
  trafficPotential: number;
  commercialValue: number;
  trend: number[] | null;
  seed: string | null;
  /** Search surface these metrics describe. */
  channel: string;
  /** Derived from `trend` — see lib/seo/trends.ts. */
  trendDirection: "rising" | "falling" | "stable";
  trendChangePercent: number;
  isSeasonal: boolean;
  peakMonths: string[];
}

export interface KeywordFilters {
  channel?: string;
  trendDirection?: "rising" | "falling" | "stable";
  seasonalOnly?: boolean;
  search?: string;
  minVolume?: number;
  maxVolume?: number;
  maxDifficulty?: number;
  minDifficulty?: number;
  intents?: Intent[];
  questionsOnly?: boolean;
  minWords?: number;
  seed?: string;
}

export interface KeywordSummary {
  count: number;
  totalVolume: number;
  avgDifficulty: number;
  totalValue: number;
  questions: number;
}

export interface ClusterKeywordView {
  id: string;
  text: string;
  isPrimary: boolean;
  volume: number | null;
  difficulty: number | null;
  intent: string | null;
}

export interface ClusterView {
  id: string;
  name: string;
  intent: string | null;
  totalVolume: number;
  avgDifficulty: number;
  keywordCount: number;
  keywords: ClusterKeywordView[];
}

export interface JobView {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  total: number;
  percent: number;
  result: Record<string, unknown> | null;
  error: string | null;
}

/* ---- Phase 2: SERP, competitors, topic map ---- */

export interface SerpResultView {
  position: number;
  url: string;
  domain: string;
  title: string;
  description: string;
  domainStrength?: number | null;
}

export interface SerpDetailView {
  keywordId: string;
  keyword: string;
  capturedAt: string;
  meanStrength: number | null;
  features: string[];
  results: SerpResultView[];
}

export interface SerpCoverageView {
  analyzed: number;
  total: number;
  features: Array<{ feature: string; count: number; share: number }>;
  analyzedKeywords: Array<{
    keywordId: string;
    text: string;
    volume: number | null;
    meanStrength: number | null;
    features: string[];
  }>;
}

export interface CompetitorSummaryView {
  domain: string;
  keywordCount: number;
  totalVolume: number;
  averagePosition: number;
  topThree: number;
  tracked: boolean;
}

export interface CompetitorKeywordView {
  keywordId: string;
  text: string;
  volume: number | null;
  difficulty: number | null;
  intent: Intent | null;
  competitorPosition: number;
  ownPosition: number | null;
  opportunity: "gap" | "behind" | "ahead";
}

export interface ContentGapView {
  clusterId: string;
  name: string;
  intent: string | null;
  keywordCount: number;
  totalVolume: number;
  gapKeywords: number;
  gapVolume: number;
  competitorsPresent: string[];
  gapScore: number;
}

export interface TopicMapView {
  summary: string;
  generatedBy: "claude" | "heuristic";
  pillars: Array<{
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
  }>;
  orphans: Array<{ title: string; volume: number; clusterId: string }>;
}

export interface ContentBriefView {
  title: string;
  targetKeyword: string;
  intent: Intent;
  summary: string;
  headings: Array<{ level: 2 | 3; text: string }>;
  questionsToAnswer: string[];
  secondaryKeywords: string[];
  wordCountTarget: number;
  generatedBy: "claude" | "heuristic";
}
