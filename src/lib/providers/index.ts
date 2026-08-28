/**
 * Provider selection. One place decides which data source is live, so
 * switching from mock to paid data is a config change and nothing else
 * (the decision recorded when this build started).
 */

import { DataForSeoProvider } from "./dataforseo";
import { MockKeywordProvider } from "./mock";
import { type CachedProvider, type UsageContext, withCaching } from "./cache";
import type { KeywordDataProvider } from "./types";

let warned = false;

export function getRawProvider(): KeywordDataProvider {
  const requested = (process.env.KEYWORD_PROVIDER ?? "mock").toLowerCase();

  if (requested === "dataforseo") {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (login && password) {
      return new DataForSeoProvider(
        login,
        password,
        process.env.DATAFORSEO_BASE_URL,
      );
    }
    // Falling back rather than throwing: a missing credential should not take
    // the whole app down, but it must be loud, since the numbers on screen
    // are then synthetic.
    if (!warned) {
      warned = true;
      console.warn(
        "[providers] KEYWORD_PROVIDER=dataforseo but credentials are missing — falling back to the mock provider. Data shown is synthetic.",
      );
    }
  }

  return new MockKeywordProvider();
}

/** The provider every caller should use: cached and cost-logged. */
export function getProvider(ctx: UsageContext = {}): CachedProvider {
  return withCaching(getRawProvider(), ctx);
}

export type { CachedProvider, UsageContext };
export * from "./types";
