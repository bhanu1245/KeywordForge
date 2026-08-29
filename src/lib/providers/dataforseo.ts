/**
 * DataForSEO provider (PRD §6 — the recommended commercial data source).
 *
 * Wired but dormant: it only activates when KEYWORD_PROVIDER=dataforseo and
 * credentials are present. Every response is defensively parsed, because a
 * provider schema change must degrade to "no data for this row" rather than
 * throw and kill a 10,000-keyword bulk job at row 4,000.
 *
 * Costs below are order-of-magnitude estimates for the ledger, not billing
 * truth — verify against your own DataForSEO plan before quoting margins to
 * anyone. They exist so cost-per-client is directionally visible from day one.
 */

import { normalizeText } from "../seo/normalize";
import type {
  KeywordDataProvider,
  KeywordIdeasInput,
  ProviderResponse,
  RawKeyword,
  SearchVolumeInput,
  SerpInput,
  SerpResponse,
  SerpResultItem,
} from "./types";

/**
 * DataForSEO groups status codes into families: 20000-29999 success,
 * 40000-49999 client/task errors, 50000+ server errors. Anything at or above
 * 40000 is a failure at either envelope or task level.
 */
const DFS_ERROR_THRESHOLD = 40000;

const COST_PER_IDEAS_CALL = 0.01;
const COST_PER_VOLUME_KEYWORD = 0.00005;
const COST_PER_SERP_CALL = 0.002;

interface DfsEnvelope {
  /** Envelope-level status. Present even when `tasks` is absent entirely. */
  status_code?: number;
  status_message?: string;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    result?: Array<Record<string, unknown>> | null;
  }>;
}

export class DataForSeoProvider implements KeywordDataProvider {
  readonly name = "dataforseo";
  readonly isLive = true;

  private readonly auth: string;
  private readonly baseUrl: string;

  constructor(login: string, password: string, baseUrl?: string) {
    if (!login || !password) {
      throw new Error(
        "DataForSEO credentials missing — set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD, or use KEYWORD_PROVIDER=mock.",
      );
    }
    this.auth = Buffer.from(`${login}:${password}`).toString("base64");
    this.baseUrl = (baseUrl || "https://api.dataforseo.com").replace(/\/$/, "");
  }

  private async post(path: string, body: unknown): Promise<DfsEnvelope> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/json",
      },
      // DataForSEO takes an array of task objects, even for a single task.
      body: JSON.stringify([body]),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `DataForSEO ${path} failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`,
      );
    }

    const json = (await res.json()) as DfsEnvelope;

    /**
     * TOP-LEVEL status first, BEFORE touching `tasks`.
     *
     * DataForSEO signals most failures with HTTP 200 and an error code in the
     * body. Crucially, an envelope-level failure — a bad login (40100), an
     * unpaid balance (40200) — carries NO `tasks` array at all. Checking only
     * `tasks[0].status_code` meant `task` was `undefined`, nothing threw, and
     * the parsers downstream mapped an absent array to `[]`. A wrong password
     * therefore looked exactly like "this keyword has no ideas", which is the
     * worst possible way for an auth failure to present.
     */
    if (typeof json.status_code === "number" && json.status_code >= DFS_ERROR_THRESHOLD) {
      throw new Error(
        `DataForSEO ${path} error ${json.status_code}: ${json.status_message ?? "unknown"}`,
      );
    }

    // Then the per-task status: the envelope can succeed while the one task
    // inside it fails.
    const task = json.tasks?.[0];
    if (typeof task?.status_code === "number" && task.status_code >= DFS_ERROR_THRESHOLD) {
      throw new Error(
        `DataForSEO ${path} task error ${task.status_code}: ${task.status_message ?? "unknown"}`,
      );
    }

    return json;
  }

  private static num(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /** Turn DataForSEO's monthly_searches into a plain relative-volume series. */
  private static toTrend(monthly: unknown): number[] | null {
    if (!Array.isArray(monthly) || monthly.length === 0) return null;
    const volumes = monthly
      .map((m) =>
        DataForSeoProvider.num((m as Record<string, unknown>)?.search_volume),
      )
      .filter((v): v is number => v !== null);
    if (volumes.length === 0) return null;
    const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    if (mean === 0) return null;
    // Oldest-first, matching RawKeyword.trend.
    return volumes
      .slice()
      .reverse()
      .map((v) => Number((v / mean).toFixed(3)));
  }

  private static toRawKeyword(item: Record<string, unknown>): RawKeyword | null {
    const info = (item.keyword_info ?? item) as Record<string, unknown>;
    const text = typeof item.keyword === "string" ? item.keyword : null;
    if (!text) return null;
    return {
      text: normalizeText(text),
      volume: DataForSeoProvider.num(info.search_volume),
      cpc: DataForSeoProvider.num(info.cpc),
      competition: DataForSeoProvider.num(info.competition),
      trend: DataForSeoProvider.toTrend(info.monthly_searches),
    };
  }

  /**
   * Per-channel endpoints (PRD §6 maps each surface to its own source).
   * Like the rest of this class these are unverified against the live API —
   * confirm the paths and response shapes on first connection.
   */
  private static ideasEndpoint(channel: string): string {
    switch (channel) {
      case "amazon":
        return "/v3/dataforseo_labs/amazon/related_keywords/live";
      case "youtube":
        return "/v3/dataforseo_labs/youtube/related_keywords/live";
      // Maps demand is Google demand filtered to local intent; DataForSEO has
      // no separate Maps ideas endpoint, so the Google one is used and the
      // local character comes from the location parameter.
      case "google_maps":
      case "google":
      default:
        return "/v3/dataforseo_labs/google/keyword_ideas/live";
    }
  }

  async keywordIdeas(
    input: KeywordIdeasInput,
  ): Promise<ProviderResponse<RawKeyword[]>> {
    const json = await this.post(
      DataForSeoProvider.ideasEndpoint(input.channel ?? "google"),
      {
        keywords: [input.seed],
        language_code: input.language,
        location_name: input.location,
        limit: Math.min(input.limit, 1000),
        order_by: ["keyword_info.search_volume,desc"],
      },
    );

    const items = (json.tasks?.[0]?.result?.[0]?.items ?? []) as Record<
      string,
      unknown
    >[];
    const data = items
      .map((i) => DataForSeoProvider.toRawKeyword(i))
      .filter((k): k is RawKeyword => k !== null && k.text.length > 0);

    return { data, unitsConsumed: 1, costUsd: COST_PER_IDEAS_CALL };
  }

  async searchVolume(
    input: SearchVolumeInput,
  ): Promise<ProviderResponse<RawKeyword[]>> {
    // Google Ads endpoint caps at 1000 keywords per task.
    const batch = input.keywords.slice(0, 1000);
    const json = await this.post(
      "/v3/keywords_data/google_ads/search_volume/live",
      {
        keywords: batch,
        language_code: input.language,
        location_name: input.location,
      },
    );

    const result = (json.tasks?.[0]?.result ?? []) as Record<string, unknown>[];
    const data = result
      .map((i) => DataForSeoProvider.toRawKeyword(i))
      .filter((k): k is RawKeyword => k !== null && k.text.length > 0);

    return {
      data,
      unitsConsumed: batch.length,
      costUsd: Number((batch.length * COST_PER_VOLUME_KEYWORD).toFixed(6)),
    };
  }

  async serp(input: SerpInput): Promise<ProviderResponse<SerpResponse>> {
    const depth = input.depth ?? 10;
    const json = await this.post("/v3/serp/google/organic/live/advanced", {
      keyword: input.keyword,
      language_code: input.language,
      location_name: input.location,
      depth,
    });

    const items = (json.tasks?.[0]?.result?.[0]?.items ?? []) as Record<
      string,
      unknown
    >[];

    const results: SerpResultItem[] = [];
    const features = new Set<string>();

    for (const item of items) {
      const type = typeof item.type === "string" ? item.type : "";
      if (type !== "organic") {
        // Everything that is not an organic blue link is a SERP feature
        // (PRD §7 module 18) — they come bundled with the same paid call.
        if (type) features.add(type);
        continue;
      }
      if (results.length >= depth) continue;
      const url = typeof item.url === "string" ? item.url : "";
      const domain = typeof item.domain === "string" ? item.domain : "";
      if (!url || !domain) continue;
      results.push({
        position:
          DataForSeoProvider.num(item.rank_absolute) ?? results.length + 1,
        url,
        domain,
        title: typeof item.title === "string" ? item.title : "",
        description:
          typeof item.description === "string" ? item.description : "",
        // No link index at MVP (PRD §6) — left null so difficulty falls back
        // to its non-SERP weighting rather than inventing an authority score.
        domainStrength: null,
      });
    }

    return {
      data: {
        keyword: normalizeText(input.keyword),
        results,
        features: [...features],
      },
      unitsConsumed: 1,
      costUsd: COST_PER_SERP_CALL,
    };
  }
}
