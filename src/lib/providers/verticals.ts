/**
 * Vertical detection and per-vertical keyword modifiers.
 *
 * WHY THIS EXISTS: the mock generator originally applied one retail-flavoured
 * modifier list to every seed, which produced nonsense outside jewellery —
 * "handmade python tutorial", "vintage diabetes symptoms", "cheap car
 * insurance" sitting next to "luxury dentist". Any seed has to yield a
 * plausible idea set, so modifiers are chosen per vertical instead.
 *
 * This also shapes CPC. A finance or legal click really is worth 20x a recipe
 * click, and a flat CPC band made every vertical's commercial value look the
 * same — which is exactly the number an agency puts in a pitch.
 *
 * NOTE: this drives the MOCK provider only. With a live provider the real API
 * returns real ideas and none of this is consulted. It exists so the product
 * is demonstrable on any niche without spending API budget.
 */

import { stem, tokenize } from "../seo/normalize";

export type Vertical =
  | "local_service"
  | "software"
  | "retail"
  | "health"
  | "finance"
  | "education"
  | "food"
  | "travel"
  | "generic";

export interface VerticalProfile {
  id: Vertical;
  /** Tokens that signal this vertical. Stemmed at load. */
  match: string[];
  prefixes: string[];
  suffixes: string[];
  /** Question templates; {s} is replaced with the seed. */
  questions: string[];
  /** Multiplies the base CPC band. Finance clicks really are worth more. */
  cpcMultiplier: number;
}

const PROFILES: VerticalProfile[] = [
  {
    id: "local_service",
    match: [
      "dentist", "plumber", "electrician", "salon", "barber", "mechanic",
      "lawyer", "attorney", "solicitor", "clinic", "gym", "spa", "roofing",
      "roofer", "cleaning", "cleaner", "landscaping", "hvac", "locksmith",
      "photographer", "caterer", "contractor", "repair", "movers", "removals",
      "vet", "veterinarian", "chiropractor", "physiotherapist", "accountant",
      "installer", "painter", "builder", "plasterer", "tiler", "glazier",
      "childcare", "nursery", "tutor", "driving instructor",
    ],
    prefixes: [
      "best", "top", "local", "affordable", "emergency", "24 hour", "mobile",
      "licensed", "certified", "independent", "trusted", "same day",
    ],
    suffixes: [
      "near me", "in my area", "open now", "cost", "prices", "reviews",
      "appointment", "phone number", "opening hours", "services", "quotes",
      "for children", "out of hours", "recommendations", "ratings",
      "free consultation", "emergency", "weekend",
    ],
    questions: [
      "how much does a {s} cost",
      "how to choose a {s}",
      "what does a {s} do",
      "when should you see a {s}",
      "how to find a good {s}",
      "do you need a {s}",
    ],
    cpcMultiplier: 1.6,
  },
  {
    id: "software",
    match: [
      "software", "app", "tool", "platform", "crm", "saas", "system", "api",
      "plugin", "extension", "suite", "erp", "cms", "dashboard", "integration",
      "automation", "database", "hosting", "vpn", "antivirus", "editor",
      "tracker", "scheduler", "helpdesk", "chatbot",
    ],
    prefixes: [
      "best", "top", "free", "open source", "cloud", "enterprise", "simple",
      "lightweight", "self hosted", "affordable", "modern", "no code",
    ],
    suffixes: [
      "pricing", "free trial", "alternatives", "reviews", "for small business",
      "for teams", "for startups", "integrations", "api", "demo", "comparison",
      "features", "login", "vs competitors", "for freelancers", "free version",
      "case studies", "onboarding",
    ],
    questions: [
      "what is {s}",
      "how much does {s} cost",
      "is {s} free",
      "how to use {s}",
      "what is the best {s}",
      "is {s} worth it",
    ],
    cpcMultiplier: 2.4,
  },
  {
    id: "retail",
    match: [
      "ring", "necklace", "jewellery", "jewelry", "earring", "bracelet",
      "shoe", "dress", "furniture", "sofa", "watch", "bag", "handbag",
      "clothing", "shirt", "laptop", "phone", "mattress", "toy", "gift",
      "sunglasses", "perfume", "rug", "curtain", "bike", "camera", "headphone",
      "pendant", "bangle", "charm",
    ],
    prefixes: [
      "best", "cheap", "affordable", "luxury", "handmade", "custom", "vintage",
      "designer", "wholesale", "personalised", "second hand", "discount",
    ],
    suffixes: [
      "for sale", "online", "near me", "for women", "for men", "uk", "prices",
      "reviews", "brands", "sale", "ideas", "gift ideas", "under 100",
      "free delivery", "returns", "size guide", "sets", "collection",
    ],
    questions: [
      "how to choose {s}",
      "what is the best {s}",
      "how much do {s} cost",
      "where to buy {s}",
      "how to clean {s}",
      "how to store {s}",
    ],
    cpcMultiplier: 1.0,
  },
  {
    id: "health",
    match: [
      "symptom", "treatment", "disease", "pain", "therapy", "syndrome",
      "infection", "diagnosis", "cure", "remedy", "medication", "cancer",
      "diabetes", "anxiety", "depression", "allergy", "injury", "vaccine",
      "surgery", "rash", "migraine", "arthritis", "asthma", "fracture",
      "nutrition", "deficiency", "insomnia", "fatigue",
    ],
    // Deliberately no "cheap"/"handmade"/"luxury" — commercial retail
    // modifiers on a medical query are the exact nonsense this fixes.
    prefixes: [
      "early", "chronic", "common", "natural", "severe", "mild", "acute",
      "persistent", "unexplained", "sudden",
    ],
    suffixes: [
      "causes", "treatment", "symptoms", "home remedies", "in adults",
      "in children", "in women", "in men", "diagnosis", "prevention",
      "medication", "when to see a doctor", "recovery time", "side effects",
      "risk factors", "stages", "tests", "specialist",
    ],
    questions: [
      "what causes {s}",
      "how to treat {s}",
      "what are the signs of {s}",
      "is {s} serious",
      "how long does {s} last",
      "can {s} be prevented",
    ],
    cpcMultiplier: 1.4,
  },
  {
    id: "finance",
    match: [
      "insurance", "loan", "mortgage", "tax", "bank", "credit", "investment",
      "pension", "saving", "refinance", "annuity", "broker", "trading",
      "crypto", "isa", "invoice", "payroll", "accounting", "bookkeeping",
      "overdraft", "interest", "bond", "fund", "premium",
    ],
    prefixes: [
      "best", "cheap", "affordable", "compare", "instant", "low interest",
      "no deposit", "short term", "guaranteed", "online",
    ],
    suffixes: [
      "quotes", "rates", "calculator", "companies", "comparison",
      "for young drivers", "for bad credit", "near me", "reviews",
      "requirements", "eligibility", "explained", "providers", "fees",
      "for self employed", "for first time buyers", "deals", "brokers",
    ],
    questions: [
      "how much is {s}",
      "how does {s} work",
      "what is the best {s}",
      "how to get {s}",
      "is {s} worth it",
      "do i need {s}",
    ],
    // The most expensive clicks on the open web.
    cpcMultiplier: 4.0,
  },
  {
    id: "education",
    match: [
      "tutorial", "course", "learn", "class", "certification", "training",
      "bootcamp", "lesson", "exam", "degree", "curriculum", "syllabus",
      "revision", "homework", "study", "workshop", "diploma", "apprenticeship",
      "python", "javascript", "excel", "sql", "spanish", "guitar",
    ],
    prefixes: [
      "free", "best", "online", "beginner", "advanced", "complete",
      "intensive", "part time", "accredited", "self paced",
    ],
    suffixes: [
      "for beginners", "pdf", "free", "online", "certification", "examples",
      "exercises", "cheat sheet", "projects", "roadmap", "2026",
      "with certificate", "syllabus", "vs bootcamp", "for kids",
      "career paths", "prerequisites", "practice questions",
    ],
    questions: [
      "how to learn {s}",
      "how long does it take to learn {s}",
      "is {s} hard",
      "what is {s} used for",
      "where to start with {s}",
      "is {s} worth learning",
    ],
    cpcMultiplier: 1.3,
  },
  {
    id: "food",
    match: [
      "pizza", "recipe", "restaurant", "delivery", "takeaway", "cafe",
      "coffee", "burger", "sushi", "bakery", "catering", "menu", "vegan",
      "cake", "pasta", "curry", "brunch", "cocktail", "sandwich", "dessert",
      "barbecue", "steak", "noodle",
    ],
    prefixes: [
      "best", "cheap", "healthy", "easy", "homemade", "authentic", "quick",
      "traditional", "gluten free", "vegan",
    ],
    suffixes: [
      "near me", "delivery", "recipe", "menu", "calories", "reviews",
      "open now", "order online", "ingredients", "for two", "under 30 minutes",
      "for parties", "prices", "booking", "opening times", "offers",
      "nutrition", "leftovers",
    ],
    questions: [
      "how to make {s}",
      "what goes with {s}",
      "how many calories in {s}",
      "where to get {s}",
      "is {s} healthy",
      "how long to cook {s}",
    ],
    cpcMultiplier: 0.7,
  },
  {
    id: "travel",
    match: [
      "hotel", "flight", "holiday", "vacation", "tour", "resort", "hostel",
      "cruise", "trip", "itinerary", "visa", "airport", "airline", "backpacking",
      "campsite", "excursion", "sightseeing", "beach",
    ],
    prefixes: [
      "best", "cheap", "luxury", "all inclusive", "last minute", "family",
      "budget", "boutique", "adults only", "direct",
    ],
    suffixes: [
      "near me", "deals", "packages", "reviews", "for families", "for couples",
      "in winter", "in summer", "prices", "booking", "with kids", "on a budget",
      "itinerary", "tips", "what to pack", "best time to visit",
      "travel insurance", "airport transfers",
    ],
    questions: [
      "when to visit {s}",
      "how much does {s} cost",
      "is {s} safe",
      "what to do in {s}",
      "how to get to {s}",
      "how many days in {s}",
    ],
    cpcMultiplier: 1.5,
  },
  {
    // Fallback. Everything here has to read sensibly against ANY noun phrase,
    // which rules out both retail modifiers ("handmade") and local ones
    // ("near me", "open now").
    id: "generic",
    match: [],
    prefixes: [
      "best", "top", "free", "professional", "online", "affordable", "simple",
      "modern", "popular", "essential",
    ],
    suffixes: [
      "guide", "tips", "examples", "reviews", "comparison", "alternatives",
      "cost", "benefits", "checklist", "2026", "explained", "ideas",
      "for beginners", "templates", "mistakes", "statistics", "trends",
      "best practices",
    ],
    questions: [
      "what is {s}",
      "how does {s} work",
      "how much does {s} cost",
      "why is {s} important",
      "how to get started with {s}",
      "what are the benefits of {s}",
    ],
    cpcMultiplier: 1.0,
  },
];

/** Stemmed lookup so "rings" matches "ring" and "symptoms" matches "symptom". */
const MATCH_INDEX = new Map<string, Vertical>();
for (const profile of PROFILES) {
  for (const term of profile.match) {
    // Multi-word signals are indexed by each of their stemmed tokens.
    for (const token of tokenize(term)) {
      if (!MATCH_INDEX.has(token)) MATCH_INDEX.set(token, profile.id);
    }
  }
}

const BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/**
 * Picks the vertical a seed belongs to by majority vote over its tokens.
 * Ties and no-match both fall back to `generic`, which is the safe choice:
 * generic modifiers read sensibly against anything.
 */
export function detectVertical(seed: string): Vertical {
  const counts = new Map<Vertical, number>();
  for (const token of tokenize(seed)) {
    const vertical = MATCH_INDEX.get(token) ?? MATCH_INDEX.get(stem(token));
    if (!vertical) continue;
    counts.set(vertical, (counts.get(vertical) ?? 0) + 1);
  }

  let best: Vertical = "generic";
  let bestCount = 0;
  for (const [vertical, count] of counts) {
    if (count > bestCount) {
      best = vertical;
      bestCount = count;
    }
  }
  return best;
}

export function getVerticalProfile(vertical: Vertical): VerticalProfile {
  return BY_ID.get(vertical) ?? BY_ID.get("generic")!;
}

export function profileForSeed(seed: string): VerticalProfile {
  return getVerticalProfile(detectVertical(seed));
}
