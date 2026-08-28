/**
 * Channel-specific keyword shapes for the mock provider
 * (PRD §7 modules 22-25: Local SEO, Google Maps, YouTube, Amazon).
 *
 * The same phrase behaves very differently per surface, and a single modifier
 * list applied to all of them would produce nonsense — "gold rings unboxing"
 * on Amazon, "gold rings free shipping" on YouTube. Each channel gets its own
 * modifiers, its own volume scaling relative to Google, and its own CPC
 * character.
 *
 * MOCK ONLY: with a live provider each channel maps to a real endpoint
 * (DataForSEO YouTube/Amazon, Google Places for Maps) and none of this is
 * consulted.
 */

import type { Channel } from "./types";

export interface ChannelProfile {
  id: Channel;
  label: string;
  prefixes: string[];
  suffixes: string[];
  /** Multiplies Google volume — YouTube and Amazon are smaller surfaces. */
  volumeScale: number;
  /** Multiplies CPC. Amazon clicks convert; YouTube informational ones do not. */
  cpcScale: number;
}

const PROFILES: Record<Channel, ChannelProfile> = {
  google: {
    id: "google",
    label: "Google",
    prefixes: [],
    suffixes: [],
    volumeScale: 1,
    cpcScale: 1,
  },

  google_maps: {
    id: "google_maps",
    label: "Google Maps",
    // Maps demand is overwhelmingly local-intent and navigational.
    prefixes: ["best", "top rated", "nearest", "24 hour", "open", "cheap", "local"],
    suffixes: [
      "near me", "open now", "nearby", "in my area", "directions",
      "phone number", "opening hours", "reviews", "address", "appointment",
      "walk in", "with parking", "ratings", "closest",
    ],
    volumeScale: 0.35,
    cpcScale: 1.3,
  },

  youtube: {
    id: "youtube",
    label: "YouTube",
    // Video demand skews to demonstration and explanation.
    prefixes: ["how to", "best", "diy", "beginner", "full", "quick", "honest"],
    suffixes: [
      "tutorial", "review", "unboxing", "explained", "for beginners",
      "step by step", "vs", "guide", "tips and tricks", "before and after",
      "reaction", "walkthrough", "in 5 minutes", "mistakes",
    ],
    volumeScale: 0.45,
    // Informational video views monetise far worse than a search click.
    cpcScale: 0.35,
  },

  amazon: {
    id: "amazon",
    label: "Amazon",
    // Marketplace demand is product-attribute driven and almost purely
    // transactional — no "how to" here.
    prefixes: ["best", "cheap", "premium", "mens", "womens", "small", "large"],
    suffixes: [
      "for women", "for men", "set", "pack", "with case", "under 50",
      "prime", "bestseller", "gift set", "reviews", "size guide",
      "replacement", "bundle", "refurbished",
    ],
    volumeScale: 0.3,
    // Retail-media clicks are expensive and convert.
    cpcScale: 1.8,
  },
};

export function getChannelProfile(channel: Channel = "google"): ChannelProfile {
  return PROFILES[channel] ?? PROFILES.google;
}

export function channelLabel(channel: string): string {
  return PROFILES[channel as Channel]?.label ?? channel;
}
