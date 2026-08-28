/**
 * AI Keyword Generator (PRD §7 module 17) — seed keywords from a business
 * description or a website URL.
 *
 * This is the "I don't know where to start" entry point: an agency onboarding
 * a new client has a URL and a sentence, not a seed keyword list.
 *
 * SECURITY — the URL path fetches a user-supplied address from the server,
 * which is a textbook SSRF vector. Left unguarded it would let anyone use this
 * app to probe the private network it runs in, or read a cloud metadata
 * endpoint (169.254.169.254) and exfiltrate credentials.
 *
 * Guards: scheme allow-list, no redirect following, a hard timeout, a response
 * size cap, and — most importantly — CONNECTION PINNING.
 *
 * On DNS rebinding: it is not enough to resolve the hostname, check the IP,
 * and then hand the hostname to a fetch client. The client performs its OWN
 * resolution when the request goes out, and an attacker who controls the
 * domain's DNS can answer the first lookup with a public IP (passing the
 * check) and the second with 169.254.169.254 (used for the real connection).
 * The check and the connection must target the same address, so this module
 * resolves exactly ONCE and then connects to that literal IP over
 * node:http/https — sending the original hostname in the Host header and as
 * the TLS SNI name so virtual-hosted HTTPS still works. No name resolution
 * happens at connect time, which is what closes the window.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import Anthropic from "@anthropic-ai/sdk";
import { STOPWORDS, normalizeText, tokenize } from "../seo/normalize";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;

export class UnsafeUrlError extends Error {
  readonly status = 400;
}

/** Injectable so the rebinding scenario can be simulated in tests. */
export type LookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

/** RFC1918, loopback, link-local (incl. cloud metadata), and IPv6 equivalents. */
function isPrivateAddress(ip: string, family: number): boolean {
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    // IPv4-mapped IPv6, e.g. ::ffff:10.0.0.1
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    return false;
  }

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * The single address the request is allowed to touch. Everything downstream
 * connects to `address` literally — never to `url.hostname`.
 */
export interface PinnedTarget {
  url: URL;
  address: string;
  family: number;
}

/**
 * Final gate, called again immediately before the socket is opened.
 *
 * Belt and braces: the address is already validated by `resolvePinnedTarget`,
 * and no second resolution happens in between. Re-checking here means that if
 * a future refactor ever reintroduces a resolution step, the connection is
 * still verified rather than silently trusted.
 */
export function assertConnectAllowed(address: string, family: number): void {
  if (isPrivateAddress(address, family)) {
    throw new UnsafeUrlError("That host is not reachable from here.");
  }
}

/**
 * Parses, validates and resolves the URL EXACTLY ONCE, returning the address
 * the caller must connect to.
 *
 * Resolving here and connecting to the returned literal is what defeats DNS
 * rebinding: there is no second lookup for an attacker's TTL-0 record to
 * answer differently.
 */
export async function resolvePinnedTarget(
  raw: string,
  lookupFn: LookupFn = defaultLookup,
): Promise<PinnedTarget> {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new UnsafeUrlError("That does not look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are supported.");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("That host is not reachable from here.");
  }

  // A bare IP in the URL needs no DNS at all — validate it directly. Without
  // this branch, http://169.254.169.254/ would depend on the resolver's
  // behaviour for an IP literal rather than being checked outright.
  const literal = isIP(host.replace(/^\[|\]$/g, ""));
  if (literal !== 0) {
    const address = host.replace(/^\[|\]$/g, "");
    assertConnectAllowed(address, literal);
    return { url, address, family: literal };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookupFn(host);
  } catch {
    throw new UnsafeUrlError("Could not resolve that domain.");
  }
  if (resolved.length === 0) {
    throw new UnsafeUrlError("Could not resolve that domain.");
  }

  // Reject if ANY answer is private. A rebinding attacker may return a mixed
  // record set hoping the client picks the private one.
  for (const r of resolved) assertConnectAllowed(r.address, r.family);

  return { url, address: resolved[0].address, family: resolved[0].family };
}

export interface SiteContext {
  url: string;
  title: string;
  description: string;
  headings: string[];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

interface RawResponse {
  status: number;
  contentType: string;
  body: string;
}

/**
 * Issues the GET against the PINNED IP.
 *
 * `host` is the literal address, so the socket layer performs no name
 * resolution. `servername` supplies TLS SNI and drives certificate validation,
 * and the explicit Host header keeps virtual-hosted sites working — together
 * these preserve normal HTTPS behaviour while removing the second DNS lookup
 * that made rebinding possible.
 */
function requestPinned(target: PinnedTarget): Promise<RawResponse> {
  const { url, address, family } = target;
  // Re-validate immediately before the socket opens.
  assertConnectAllowed(address, family);

  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise<RawResponse>((resolve, reject) => {
    const req = transport.request(
      {
        host: address,
        family,
        port: Number(url.port) || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        // Host header keeps virtual hosting correct; SNI keeps TLS correct.
        servername: isHttps ? url.hostname : undefined,
        headers: {
          Host: url.host,
          "User-Agent": "KeywordForge/0.1 (+keyword research)",
          Accept: "text/html",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");

        // Never follow redirects — the target could point at a private
        // address that never went through the guard.
        if (status >= 300 && status < 400) {
          res.destroy();
          reject(new UnsafeUrlError("That URL redirects; enter the final address instead."));
          return;
        }

        let received = 0;
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          received += Buffer.byteLength(chunk);
          body += chunk;
          // Cap the read rather than trusting content-length.
          if (received >= MAX_BYTES) res.destroy();
        });
        res.on("end", () => resolve({ status, contentType, body }));
        res.on("close", () => resolve({ status, contentType, body }));
        res.on("error", () => reject(new UnsafeUrlError("Could not read that page.")));
      },
    );

    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy();
      reject(new UnsafeUrlError("That site took too long to respond."));
    });
    req.on("error", () => reject(new UnsafeUrlError("Could not read that page.")));
    req.end();
  });
}

/** Pulls title, meta description and headings. No DOM parser needed for this. */
export async function fetchSiteContext(
  rawUrl: string,
  lookupFn?: LookupFn,
): Promise<SiteContext> {
  const target = await resolvePinnedTarget(rawUrl, lookupFn);
  const url = target.url;

  try {
    const res = await requestPinned(target);

    if (res.status < 200 || res.status >= 300) {
      throw new UnsafeUrlError(`The site responded with ${res.status}.`);
    }
    if (!res.contentType.includes("html")) {
      throw new UnsafeUrlError("That URL did not return an HTML page.");
    }

    const html = res.body;
    const strip = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

    const title = strip(html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? "");
    const description = decodeEntities(
      html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})["']/i,
      )?.[1] ?? "",
    ).trim();

    const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]{0,200}?)<\/h[1-3]>/gi)]
      .map((m) => strip(m[1]))
      .filter((h) => h.length > 2 && h.length < 120)
      .slice(0, 25);

    return { url: url.toString(), title, description, headings };
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    throw new UnsafeUrlError("Could not read that page.");
  }
}

export interface GeneratedSeeds {
  seeds: string[];
  source: "claude" | "heuristic";
  context?: SiteContext;
}

/**
 * Fallback generator: mines repeated multi-word phrases out of the supplied
 * text. Crude next to an LLM, but it produces genuinely usable seeds because
 * page titles and headings are already written around the terms a business
 * cares about.
 */
export function buildHeuristicSeeds(text: string, extra: string[] = []): string[] {
  const lines = [text, ...extra].filter(Boolean);
  const counts = new Map<string, number>();

  /**
   * Words that join two separate ideas. Phrases are split ON these rather than
   * merely filtered, because an n-gram window that slides across one produces
   * garbage that reads plausible — "whitening and emergency", "appointments
   * for children", "bristol offering". Splitting first means a gram can only
   * ever come from within a single noun phrase.
   */
  const CONNECTORS = new Set([
    "and", "or", "for", "with", "in", "at", "on", "of", "to", "from", "by",
    "offering", "including", "plus", "featuring", "serving", "providing",
    "specialising", "specializing", "we", "our", "your", "is", "are",
  ]);

  for (const line of lines) {
    // Split on punctuation FIRST. normalizeText turns commas into spaces, so
    // without this a gram slides straight across a list boundary —
    // "dental implants, teeth whitening" yielded the phantom "implants teeth".
    const clauses = line.split(/[,.;:!?()–—/|]+/);

    const segments: string[][] = [];
    for (const clause of clauses) {
      const words = normalizeText(clause).split(" ").filter(Boolean);
      // Cut again at every connector or stopword boundary.
      let current: string[] = [];
      for (const word of words) {
        if (CONNECTORS.has(word) || STOPWORDS.has(word)) {
          if (current.length > 0) segments.push(current);
          current = [];
          continue;
        }
        current.push(word);
      }
      if (current.length > 0) segments.push(current);
    }

    for (const segment of segments) {
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= segment.length; i++) {
          const gram = segment.slice(i, i + n);
          if (gram.some((w) => w.length < 3)) continue;
          const phrase = gram.join(" ");
          counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
        }
      }
      // A two-word segment standing alone is itself a good seed.
      if (segment.length === 2 && segment.every((w) => w.length >= 3)) {
        const phrase = segment.join(" ");
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
    }
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([phrase]) => phrase);

  // Drop a phrase already contained in one we kept, to avoid near-duplicates.
  const seeds: string[] = [];
  for (const phrase of ranked) {
    if (seeds.some((s) => s.includes(phrase) || phrase.includes(s))) continue;
    seeds.push(phrase);
    if (seeds.length >= 12) break;
  }

  if (seeds.length === 0) {
    const fallback = tokenize(text).slice(0, 3).join(" ");
    if (fallback) seeds.push(fallback);
  }
  return seeds;
}

const SYSTEM_PROMPT = `You are an SEO strategist choosing seed keywords for keyword research.
Return ONLY valid JSON, no markdown fence, no commentary: {"seeds": string[]}
Rules:
- 8 to 12 seeds.
- Each seed is 1-4 words, lowercase, no punctuation.
- Seeds are BROAD head terms to expand from, not long-tail queries.
- Base them strictly on the supplied business; do not invent unrelated topics.
- No brand names unless the brand is the business itself.`;

export async function generateSeedKeywords(input: {
  description?: string;
  url?: string;
}): Promise<GeneratedSeeds> {
  let context: SiteContext | undefined;
  if (input.url) context = await fetchSiteContext(input.url);

  const corpus = [
    input.description ?? "",
    context?.title ?? "",
    context?.description ?? "",
    ...(context?.headings ?? []),
  ]
    .filter(Boolean)
    .join(". ");

  if (!corpus.trim()) {
    throw new UnsafeUrlError("Nothing to work from — add a description or a URL.");
  }

  const fallback: GeneratedSeeds = {
    seeds: buildHeuristicSeeds(input.description ?? "", context?.headings ?? []),
    source: "heuristic",
    context,
  };

  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: corpus.slice(0, 6000) }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    const parsed = JSON.parse(text) as { seeds?: unknown };
    if (!Array.isArray(parsed.seeds)) return fallback;

    const seeds = parsed.seeds
      .filter((s): s is string => typeof s === "string")
      .map((s) => normalizeText(s))
      .filter((s) => s.length > 1 && s.split(" ").length <= 4);

    if (seeds.length === 0) return fallback;
    return { seeds: [...new Set(seeds)].slice(0, 12), source: "claude", context };
  } catch (error) {
    console.warn("[ai] seed generation failed, using heuristic seeds:", error);
    return fallback;
  }
}
