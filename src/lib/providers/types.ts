/**
 * The single interface every keyword-data source implements (PRD §9,
 * "External data layer"). Nothing above this layer knows whether the numbers
 * came from DataForSEO, a competitor's API, or the mock driver.
 *
 * Two rules for implementers:
 *  1. Never cache in here. Caching and cost accounting live in `cache.ts` so
 *     they apply uniformly to every provider.
 *  2. Report `unitsConsumed` honestly — it drives the per-client cost ledger.
 */

/**
 * Search surfaces (PRD §7 modules 23-25). Each is a different demand curve for
 * the same phrase, not a filter over one dataset — PRD §6 maps each to its own
 * upstream endpoint.
 */
export const CHANNELS = ["google", "google_maps", "youtube", "amazon"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface MarketOptions {
  language: string;
  location: string;
  /** Defaults to "google" when omitted. */
  channel?: Channel;
}

/** A keyword as the upstream source describes it, before our own scoring. */
export interface RawKeyword {
  text: string;
  volume: number | null;
  cpc: number | null;
  /** Paid competition, 0..1. */
  competition: number | null;
  /** 12 months of relative volume, oldest first. Powers trend/seasonality. */
  trend?: number[] | null;
}

export interface SerpResultItem {
  position: number;
  url: string;
  domain: string;
  title: string;
  description: string;
  /**
   * Authority proxy 0..100. Real values require a licensed link index
   * (PRD §6); until then this is provider-supplied or estimated.
   */
  domainStrength?: number | null;
}

export interface SerpResponse {
  keyword: string;
  results: SerpResultItem[];
  /** e.g. ["featured_snippet", "people_also_ask", "local_pack"] */
  features: string[];
}

export interface ProviderResponse<T> {
  data: T;
  /** Billable units this call consumed upstream. */
  unitsConsumed: number;
  /** Estimated USD cost, for the per-client ledger. */
  costUsd: number;
}

export interface KeywordIdeasInput extends MarketOptions {
  seed: string;
  limit: number;
}

export interface SearchVolumeInput extends MarketOptions {
  keywords: string[];
}

export interface SerpInput extends MarketOptions {
  keyword: string;
  depth?: number;
  /**
   * Bypass the response cache and fetch a genuinely current SERP.
   *
   * Rank tracking REQUIRES this. The default 30-day cache exists to stop
   * re-paying for the same keyword (PRD §12), but a daily rank check served
   * from that cache would replay a month-old SERP and record the same
   * position every day — reporting "no movement" for thirty days no matter
   * what actually happened. Freshness costs money, so it is opt-in and only
   * the rank-check path sets it.
   */
  fresh?: boolean;
}

export interface KeywordDataProvider {
  readonly name: string;
  /** Whether this provider spends real money. Drives UI warnings. */
  readonly isLive: boolean;

  keywordIdeas(input: KeywordIdeasInput): Promise<ProviderResponse<RawKeyword[]>>;
  searchVolume(input: SearchVolumeInput): Promise<ProviderResponse<RawKeyword[]>>;
  serp(input: SerpInput): Promise<ProviderResponse<SerpResponse>>;
}
