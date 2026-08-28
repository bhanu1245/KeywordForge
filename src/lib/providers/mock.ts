/**
 * Deterministic mock keyword data.
 *
 * This is not throwaway scaffolding — it is how the whole app stays runnable
 * and testable without spending metered API budget (PRD §6/§12). Everything
 * is seeded from a hash of the query, so the same seed keyword always returns
 * the same ideas with the same volumes. That determinism is what lets the
 * cache, the clustering output and the test suite be meaningful.
 *
 * The generated distributions are shaped to look like real keyword data:
 * volume decays with phrase length, CPC tracks commercial intent, and
 * competition correlates with CPC.
 */

import { classifyIntent } from "../seo/intent";
import { normalizeText, tokenize, wordCount } from "../seo/normalize";
import { profileForSeed } from "./verticals";
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

/** cyrb53 — fast, well-distributed string hash. */
function hash(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32 PRNG — deterministic stream from a numeric seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A FIXED pool of domains, not generated per keyword.
 *
 * This matters for more than realism. Competitor Keywords, Keyword Gap and
 * Content Gap all answer "which keywords does domain X rank for", which is
 * only meaningful if the same domains recur across a project's keywords. An
 * earlier version composed domains per result (`brand + index + random tld`),
 * producing dozens of near-unique hostnames and making every gap analysis
 * come back empty.
 */
const DOMAIN_POOL = [
  "marketleader.com",
  "thehub.io",
  "sparkstudio.co",
  "primesource.com",
  "everydayguide.net",
  "thecollective.com",
  "northsideco.com",
  "cityreview.org",
  "trustedchoice.com",
  "artisanhouse.shop",
  "buyersguide.net",
  "thedailyedit.com",
];

/**
 * Authority is a property of the DOMAIN, not of the position it happens to
 * occupy for one keyword. Deriving it from the domain name keeps a strong site
 * strong across every SERP it appears in, which is what makes the difficulty
 * signal and competitor comparison coherent.
 */
function domainAuthority(domain: string): number {
  const r = rng(hash(`authority:${domain}`));
  return Math.round(25 + r() * 70);
}

const SERP_FEATURE_POOL = [
  "featured_snippet", "people_also_ask", "local_pack", "image_pack",
  "video", "shopping", "top_stories", "sitelinks", "reviews",
];

/**
 * Builds the idea set from the seed's own vertical, so a medical seed never
 * picks up retail modifiers and a software seed never gets "near me".
 */
function buildCandidates(seed: string, limit: number): string[] {
  const s = normalizeText(seed);
  if (!s) return [];

  const profile = profileForSeed(s);
  const out = new Set<string>([s]);

  // A modifier that reuses ANY word from the seed produces junk like "pizza
  // delivery delivery" or "family best hotel best time to visit". Real
  // keyword tools never return those, so neither should this. The check is
  // per-token, not whole-phrase: "best time to visit" has to be rejected for
  // the seed "best hotel" even though only one of its words collides.
  const seedTokens = new Set(tokenize(s));
  const usable = (modifier: string) => {
    const tokens = tokenize(modifier);
    return tokens.length > 0 && !tokens.some((t) => seedTokens.has(t));
  };

  const prefixes = profile.prefixes.filter(usable);
  const suffixes = profile.suffixes.filter(usable);

  for (const p of prefixes) out.add(`${p} ${s}`);
  for (const suf of suffixes) out.add(`${s} ${suf}`);
  for (const t of profile.questions) out.add(t.replace("{s}", s));

  // Two-part combinations fill out the long tail the way real idea sets do.
  // The pair must also not collide with itself — "online" as both prefix and
  // suffix would yield "online free python course online".
  const tokensOf = new Map<string, string[]>();
  for (const m of [...prefixes, ...suffixes]) tokensOf.set(m, tokenize(m));

  for (const p of prefixes) {
    const pTokens = tokensOf.get(p) ?? [];
    for (const suf of suffixes) {
      if (out.size >= limit * 3) break;
      const sufTokens = tokensOf.get(suf) ?? [];
      if (sufTokens.some((t) => pTokens.includes(t))) continue;
      out.add(`${p} ${s} ${suf}`);
    }
  }
  return [...out].slice(0, Math.max(limit, 1));
}

/**
 * Volume model: a head-term base scaled down by phrase length, jittered
 * deterministically. Rounded to the "nice" numbers real tools report.
 */
function synthVolume(keyword: string, market: string): number {
  const r = rng(hash(`vol:${keyword}:${market}`));
  const n = wordCount(keyword);
  const base = 40000 / Math.pow(n <= 1 ? 1.2 : n, 2.1);
  const jitter = 0.25 + r() * 1.75;
  const raw = base * jitter;
  if (raw < 10) return Math.max(0, Math.round(raw));
  if (raw < 100) return Math.round(raw / 10) * 10;
  if (raw < 1000) return Math.round(raw / 50) * 50;
  return Math.round(raw / 100) * 100;
}

function synthCpc(keyword: string, market: string, cpcMultiplier: number): number {
  const r = rng(hash(`cpc:${keyword}:${market}`));
  const { intent } = classifyIntent(keyword);
  // Money queries carry money CPCs; informational ones rarely clear $1.
  const band =
    intent === "transactional" ? 3.2
    : intent === "commercial" ? 2.1
    : intent === "navigational" ? 0.6
    : 0.75;
  // Vertical matters as much as intent: an insurance click genuinely costs
  // many times a recipe click, and a flat band made every niche's commercial
  // value look identical.
  return Number((band * cpcMultiplier * (0.35 + r() * 1.5)).toFixed(2));
}

function synthCompetition(keyword: string, cpc: number, market: string): number {
  const r = rng(hash(`comp:${keyword}:${market}`));
  // Advertisers bid up what converts, so competition tracks CPC with noise.
  const fromCpc = Math.min(cpc / 5, 1);
  return Number(Math.min(1, Math.max(0, fromCpc * 0.7 + r() * 0.35)).toFixed(2));
}

/** 12 months of relative volume with a mild seasonal wave. */
function synthTrend(keyword: string, market: string): number[] {
  const r = rng(hash(`trend:${keyword}:${market}`));
  const phase = r() * Math.PI * 2;
  const amplitude = 0.15 + r() * 0.35;
  return Array.from({ length: 12 }, (_, i) => {
    const seasonal = 1 + amplitude * Math.sin(phase + (i / 12) * Math.PI * 2);
    const noise = 0.9 + r() * 0.2;
    return Number((seasonal * noise).toFixed(3));
  });
}

function toRawKeyword(text: string, market: string, cpcMultiplier = 1): RawKeyword {
  const volume = synthVolume(text, market);
  const cpc = synthCpc(text, market, cpcMultiplier);
  return {
    text,
    volume,
    cpc,
    competition: synthCompetition(text, cpc, market),
    trend: synthTrend(text, market),
  };
}

export class MockKeywordProvider implements KeywordDataProvider {
  readonly name = "mock";
  readonly isLive = false;

  async keywordIdeas(
    input: KeywordIdeasInput,
  ): Promise<ProviderResponse<RawKeyword[]>> {
    const market = `${input.language}:${input.location}`;
    const { cpcMultiplier } = profileForSeed(input.seed);
    const candidates = buildCandidates(input.seed, input.limit);
    const data = candidates
      .map((text) => toRawKeyword(text, market, cpcMultiplier))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    return { data, unitsConsumed: 1, costUsd: 0 };
  }

  async searchVolume(
    input: SearchVolumeInput,
  ): Promise<ProviderResponse<RawKeyword[]>> {
    const market = `${input.language}:${input.location}`;
    // Each keyword is priced by its own vertical — a bulk import is usually a
    // mixed bag, not one niche.
    const data = input.keywords
      .map((k) => normalizeText(k))
      .filter(Boolean)
      .map((text) => toRawKeyword(text, market, profileForSeed(text).cpcMultiplier));
    // Real providers bill per keyword on volume lookups, not per request.
    return { data, unitsConsumed: data.length, costUsd: 0 };
  }

  async serp(input: SerpInput): Promise<ProviderResponse<SerpResponse>> {
    const depth = input.depth ?? 10;
    const market = `${input.language}:${input.location}`;
    const r = rng(hash(`serp:${input.keyword}:${market}`));
    const kw = normalizeText(input.keyword);
    const slug = kw.replace(/\s+/g, "-");

    // Rank the fixed pool by authority plus per-keyword relevance noise, so a
    // strong domain usually outranks a weak one but not always — and the same
    // domains recur across keywords with shifting positions.
    const ranked = DOMAIN_POOL.map((domain) => ({
      domain,
      strength: domainAuthority(domain),
      score: domainAuthority(domain) + (r() * 60 - 30),
    }))
      .sort((a, b) => b.score - a.score)
      .slice(0, depth);

    const results: SerpResultItem[] = ranked.map((entry, i) => {
      const brand = entry.domain.split(".")[0];
      return {
        position: i + 1,
        url: `https://${entry.domain}/${slug}`,
        domain: entry.domain,
        title: `${kw.charAt(0).toUpperCase()}${kw.slice(1)} — ${brand}`,
        description: `A page about ${kw}. Ranked at position ${i + 1} in the mock SERP.`,
        domainStrength: entry.strength,
      };
    });

    const featureCount = Math.floor(r() * 4);
    const features: string[] = [];
    for (let i = 0; i < featureCount; i++) {
      const f = SERP_FEATURE_POOL[Math.floor(r() * SERP_FEATURE_POOL.length)];
      if (!features.includes(f)) features.push(f);
    }

    return {
      data: { keyword: kw, results, features },
      unitsConsumed: 1,
      costUsd: 0,
    };
  }
}
