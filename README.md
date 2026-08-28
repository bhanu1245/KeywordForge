# KeywordForge

Keyword research and SEO intelligence for agencies — discovery, difficulty, intent, clustering, briefs and export.

This is the **Phase 1 MVP** from [`PRD-Keyword-Research-Platform.md`](PRD-Keyword-Research-Platform.md): the core research loop, built on a multi-tenant data model so Agency Mode does not require a rebuild later.

---

## Quick start

```bash
npm install
cp .env.example .env     # defaults are fine — no API keys needed
npm run setup            # generate client, create SQLite db, seed demo tenant
npm run dev              # http://localhost:3000
```

Click **+ New project**, name a client and niche, then type a seed keyword and press **Discover**. Two demo projects are seeded so there is something to look at immediately, but you are not limited to them — any client, niche or market can be created from the home page.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Domain-logic test suite (60 tests, no database or network) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build |
| `npm run db:reset` | Wipe and re-seed the database |

---

## What is built

| # | PRD Phase 1 module | Where |
|---|---|---|
| 1 | Keyword Discovery | `POST /api/v1/keywords/discover` |
| 2 | Search Volume + trends | `KeywordMetric`, 12-month sparkline in the explorer |
| 3 | Keyword Difficulty | `src/lib/seo/scoring.ts` |
| 4 | CPC & Commercial Value | `commercialValue()` — traffic valued at Google Ads CPC |
| 5 | Search Intent | `src/lib/seo/intent.ts` |
| 6 | Related Keywords | provider `keywordIdeas` |
| 7 | Long-Tail Finder | `isLongTail()` + explorer filter |
| 8 | Question Finder | `isQuestion()` + explorer filter |
| 9 | Keyword Clustering | `src/lib/seo/cluster.ts` |
| 10 | Export CSV/Excel | `POST /api/v1/exports` (background job) |

### Phase 2 — competitive & content layer (complete)

| # | PRD Phase 2 module | Where |
|---|---|---|
| 11 | SERP Analyzer | `src/lib/serp/service.ts`, `POST /api/v1/serp` |
| 12 | Competitor Keywords | `src/lib/competitors/service.ts` |
| 13 | Keyword Gap | same — gap / behind / ahead per keyword |
| 14 | Content Gap | same — topic-level, unclaimed volume per cluster |
| 15 | AI Content Briefs | `POST /api/v1/briefs/generate` |
| 16 | AI Topic Map | `src/lib/ai/topicMap.ts` |
| 17 | AI Keyword Generator | `src/lib/ai/keywordGenerator.ts` |
| 18 | SERP Features | bundled with the SERP call, aggregated per project |
| 19 | Opportunity Score | `src/lib/seo/scoring.ts` |
| 20 | Traffic Potential | `src/lib/seo/scoring.ts` |

### Phase 3 — tracking & vertical expansion (complete)

| # | PRD Phase 3 module | Where |
|---|---|---|
| 21 | Rank Tracker | `src/lib/rank/service.ts`, `POST /api/v1/rank-tracking` |
| 22 | Local SEO | `src/lib/local/service.ts` |
| 23 | Google Maps Keywords | `channel=google_maps` |
| 24 | YouTube Keywords | `channel=youtube` |
| 25 | Amazon Keywords | `channel=amazon` |
| 26 | Keyword Cannibalization | `getCannibalisation()` |
| 27 | Trend Detection | `src/lib/seo/trends.ts` |
| 28 | Seasonality | same |
| 29 | Keyword Alerts | `src/lib/alerts/service.ts` |

**Channel is corpus identity, not a filter.** The same phrase has a genuinely different demand curve per surface — "gold rings" is a buying query on Amazon and a how-to on YouTube — so each channel is its own `Keyword` row with its own volume and CPC. Mixing them in one table would silently compare a YouTube volume against a Google one.

**Rank checks bypass the response cache.** The 30-day cache is the main cost control (PRD §12), but a daily rank check served from it would replay a month-old SERP and record the same position every day — reporting "no movement" for thirty days regardless of reality. `SerpInput.fresh` opts out; only the rank-check path sets it, because freshness costs money.

**Trend and seasonality cost nothing.** Both read the 12-month series that already arrives with every volume lookup. Trend compares quarter-over-quarter rather than first-vs-last month, because a purely seasonal keyword returns to its starting level and a naive comparison would report a permanent "decline" every year.

**Two Phase 3 modules cannot be fully demonstrated on sample data.** Mock SERPs are deterministic, so positions do not drift between rank checks — `improved`/`declined` stay at 0 and the rank-movement alerts never fire. That is honest rather than broken: fabricating movement would produce fake "your ranking dropped" events an agency might screenshot for a client. The `new_competitor` alert, which does not depend on movement, fires normally. Real movement appears once a live provider is connected.

Two things worth knowing about the Phase 2 layer:

**Competitor data is bounded, and the UI says so.** Ahrefs answers "what does X rank for" from its own web-scale index. Everything here is derived from the SERPs *this project* has actually collected, so a competitor's keyword set is only ever as complete as the SERP analysis you have run. Within the project's own keyword set it is accurate — it comes from the live SERP, not an estimate — but it is not their full organic footprint.

**The URL fetcher pins its connection (SSRF / DNS rebinding).** Module 17 fetches a user-supplied URL server-side. Checking the hostname's DNS and then handing the *hostname* to a fetch client is not enough: the client resolves again when the request goes out, and an attacker controlling the domain can answer the first lookup with a public IP and the second with `169.254.169.254`. `resolvePinnedTarget()` therefore resolves exactly once and `requestPinned()` connects to that literal IP over `node:http`/`https`, sending the original hostname as the `Host` header and TLS SNI so virtual-hosted HTTPS still validates normally. No name resolution happens at connect time. Covered by `tests/ssrf.test.ts`, including a rebinding resolver that returns public-then-private and an assertion that only one lookup occurs.

**SERP analysis is the expensive one.** One provider call per keyword, so it is always explicit, batched, capped, and run as a background job — never implicit on discovery, which would multiply the cost of every search by the number of ideas returned. The panel states the billable call count before you click.

Carried forward from later phases because retrofitting them is expensive (PRD §7 note):

- Multi-tenancy on every table, enforced at the query layer (`src/lib/tenancy.ts`)
- Async job runner with progress polling (`src/lib/jobs/runner.ts`)
- Upstream response cache + per-client cost ledger (`src/lib/providers/cache.ts`)
- Export audit log (PRD §12 security requirement)

---

## Decisions taken during the build

**Next.js + TypeScript, not Laravel.** The PRD leans Laravel on the strength of your PHP background. On this machine PHP, Composer, Docker and Postgres are all absent, while Node 24 is installed — Laravel meant building a toolchain before building a product. A single TypeScript stack also keeps the AI/embedding work in-process, removing the Python microservice the PRD proposed.

**SQLite in dev, Postgres-shaped schema.** No enums, no native JSON columns, JSON stored as TEXT. Switch `datasource.provider` to `postgresql` and the schema migrates as-is. The one SQLite-specific concession is documented in `enrichAndPersist` (no `skipDuplicates`).

**The keyword corpus is shared; everything else is tenant-scoped.** `Keyword`, `KeywordMetric` and `ProviderCache` are global. This is what makes the 30-day cache actually save money — if the cache were per-agency, every tenant would re-pay for the same lookup. Nothing in those tables is client-identifying. Tenant work (`ProjectKeyword`, `Cluster`, `Export`) hangs off `Agency` and is checked on every request.

**Lexical clustering, not embeddings.** An embedding pass over 10K keywords is a metered API call and is non-deterministic across model versions, so the same client report would re-cluster differently next quarter. Keywords are short and share literal head terms, which is the case lexical clustering handles well. `weightedSimilarity` is the seam where pgvector slots in later.

**Metrics are computed on read, not stored.** Opportunity, traffic potential and commercial value are pure functions of stored inputs, so a weighting change takes effect everywhere instead of leaving stale numbers in old rows.

**Mock keyword generation is vertical-aware.** The first version applied one retail-flavoured modifier list to every seed, which produced `handmade python tutorial`, `vintage diabetes symptoms` and `luxury dentist` — unusable for any niche outside jewellery. `src/lib/providers/verticals.ts` now detects the seed's vertical (local service, software, retail, health, finance, education, food, travel, or generic) and applies modifiers that actually belong to it, plus a per-vertical CPC multiplier — a finance click really is worth many times a recipe click, and a flat band made every niche's commercial value look identical. A modifier that reuses any word from the seed is dropped, so `pizza delivery delivery` cannot occur.

This shapes the **mock provider only**. With a live provider the real API returns real ideas and none of it is consulted; it exists so the product is demonstrable on any niche without spending API budget.

---

## Design system

Dark-first, because this is a tool people keep open all day beside Search Console. Tokens live in one `@theme` block in [`src/app/globals.css`](src/app/globals.css).

- **Type:** Inter via `next/font` — self-hosted, so no render-blocking Google request and no flash of invisible text. Tabular figures (`.nums`) on every metric column so numbers don't jitter as values change.
- **Colour:** low-chroma surfaces (`canvas` → `surface` → `elevated`) so the only saturated colour on screen is *data* — intent badges and difficulty bands.
- **Light & dark:** three states — no `data-theme` follows the OS, `light`/`dark` pin it. The toggle is System / Light / Dark rather than a binary switch, because "follow the OS" is the default and a two-state switch cannot express going back to automatic. An inline script in `<head>` applies the stored choice before first paint, so there is no flash of the wrong theme. Light is designed, not inverted: `brand-soft` is *the readable brand tone against this theme's surface*, so it goes darker on light and lighter on dark, and the difficulty bands drop from 400-level tints (invisible on white) to 700-level tones. All 26 text/background pairs across both themes are computed at ≥4.5:1.
- **Icons:** inline SVG set in [`src/components/Icon.tsx`](src/components/Icon.tsx), 24px grid / 1.75 stroke. Decorative by default (`aria-hidden`) since each sits beside a text label.
- **Accessibility:** one never-removed focus ring; `aria-sort` on sortable table headers; intent conveyed by label text as well as colour; `prefers-reduced-motion` honoured; `role="progressbar"` on the import bar; Escape-to-close plus focus return on the brief dialog.
- **States:** skeleton shimmer for loads over ~1s, and empty states that say what to do next rather than just "no data".

> ### ⚠️ Tailwind v4 gotcha — do not reintroduce this
>
> Use the generated utility (`bg-surface`) or `bg-(--token)`. The **v3 shorthand `bg-[--color-surface]` silently breaks in v4**: it compiles to `background-color: --color-surface`, an invalid value the browser drops. The first pass used that form in 29 places, so the entire UI rendered with no backgrounds, borders or colours at all — and it produced no build error, no console warning, and a passing test suite. If the app ever looks unstyled, check the compiled CSS for `\[--color` before anything else.

## Honest limitations

These are real, and they are the things to look at before this goes in front of a paying client.

**Difficulty is a proxy, not an Ahrefs KD.** Real difficulty is a backlink metric, and PRD §6 is correct that a link index is not buildable in-house at MVP. The score here is built from paid competition, volume, phrase length, and SERP composition when a SERP call was made. It ranks keywords against each other usefully; it is **not** numerically comparable to Ahrefs/Moz. The UI says so in the column tooltip and the Excel export says so on the About sheet. Modules 30–32 (backlinks, DA, historical) stay unbuildable until you license an index.

**The job runner is in-process.** Work runs on the Node process that accepted the request, with progress in the database. That is fine for a single instance and needs no Redis, which this machine does not have. It does **not** survive a restart mid-job — such jobs are marked failed on boot (`src/instrumentation.ts`) rather than spinning forever. `JOB_HANDLERS` is a plain dispatch table, so moving to BullMQ means replacing `enqueueJob` with a queue publish and running the same handlers in a worker.

**There is no authentication.** Out of Phase 1 scope. `resolveContext()` reads the active agency from a cookie and, in development only, falls back to the single seeded agency; in production it throws instead. Every route already asks it who the caller is, so adding real auth changes that one function and nothing else.

**Bulk scale is proven to ~50K per request, not 1M.** Enrichment is batch-first (a fixed number of queries per chunk regardless of input size) and clustering handles 5,000 keywords in ~180ms. Reaching PRD §12's 1M target means chunking the upload client-side into several jobs and moving off SQLite — the pipeline shape is right, but do not quote 1M until it has been run.

**Any keyword works, but non-English gets English mock modifiers.** Seeds in any script (Cyrillic, Devanagari, CJK, Arabic) are accepted, normalised and stored correctly — including combining marks, so `जूते` is not mangled to `जत`. Latin accents still fold, so `café` and `cafe` collide. What the *mock* provider cannot do is generate ideas in those languages: it will return `best восстановление данных`, mixing scripts. Real multilingual idea sets come from a live provider with the project's `language`/`location` set. The pipeline itself is language-agnostic; the intent classifier and stopword list are English-only, so non-English keywords classify at zero confidence (the honest "unknown" state) rather than being mislabelled.

**Data is synthetic until you connect a provider.** See below.

---

## Connecting real data

The app ships on a deterministic mock provider so it is fully usable with no credentials and no spend. The header shows a **"Sample data"** badge whenever the live provider is not connected.

To go live:

```bash
KEYWORD_PROVIDER="dataforseo"
DATAFORSEO_LOGIN="..."
DATAFORSEO_PASSWORD="..."
```

`src/lib/providers/dataforseo.ts` is written and defensively parsed, but **has not been run against the live API** — no credentials were available. Verify the endpoint response shapes against current DataForSEO docs on first connection. If credentials are missing the app logs a warning and falls back to mock rather than failing.

Cost estimates in that file (`COST_PER_*`) are order-of-magnitude placeholders for the ledger, not billing truth. Check them against your plan before quoting margins — PRD §14 correctly flags data cost as the main commercial risk.

Optional, for AI-written briefs instead of the rule-based ones:

```bash
ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Architecture

```
src/
  app/
    page.tsx                     client/project picker
    projects/[projectId]/        workspace shell (server-rendered with data)
    api/v1/                      versioned REST API (PRD §11)
  components/                    Workspace, KeywordTable (virtualised), Filters,
                                 ClusterPanel, ImportPanel, BriefDialog
  lib/
    seo/                         PURE domain logic — intent, difficulty,
                                 clustering, questions. No I/O, fully tested.
    providers/                   KeywordDataProvider interface, mock driver,
                                 DataForSEO driver, cache + cost ledger
    keywords/  clusters/         persistence services
    jobs/runner.ts               async job dispatch
    export/                      CSV + streaming XLSX
    tenancy.ts                   tenant isolation — every request goes through it
    ai/claude.ts                 optional Claude layer, always with a fallback
prisma/schema.prisma             data model (PRD §10)
```

The `lib/seo` layer has no database or network dependency, which is why the test suite runs in about a second and needs no fixtures.

### API

| Method | Route |
|---|---|
| `GET` | `/api/v1/projects` |
| `POST` | `/api/v1/projects` (creates the client too if `clientName` is new) |
| `GET` | `/api/v1/keywords?projectId=…` (+ filters) |
| `POST` | `/api/v1/keywords/discover` |
| `POST` | `/api/v1/keywords/bulk-analyze` → `202` + job id |
| `GET` | `/api/v1/jobs/{id}` |
| `GET`/`POST` | `/api/v1/clusters` |
| `POST` | `/api/v1/briefs/generate` |
| `GET`/`POST` | `/api/v1/serp` (coverage + features; POST runs analysis as a job) |
| `GET`/`POST`/`DELETE` | `/api/v1/competitors` (`view=landscape\|keywords\|gap`) |
| `GET`/`POST` | `/api/v1/topic-map` |
| `POST` | `/api/v1/keywords/generate` (seeds from description or URL) |
| `GET`/`POST` | `/api/v1/rank-tracking` (`view=summary\|cannibalisation`, `keywordId=` for history) |
| `GET`/`POST`/`PATCH` | `/api/v1/alerts` |
| `GET` | `/api/v1/local` |
| `POST` | `/api/v1/exports` → `202` + job id |
| `GET` | `/api/v1/exports/{id}/download` |

Routes are already shaped for the Phase 4 public API: they parse, authorise via `lib/tenancy.ts`, delegate to a service, and serialise — so adding API-key auth reuses the same services rather than creating a second authorisation path.

---

## Suggested next steps

1. **Add authentication**, replacing `resolveContext()`. Nothing ships to a client without it.
2. **Connect DataForSEO** and verify the response parsing against live data — `dataforseo.ts` has never run against the real API.
3. **Move to Postgres + Redis/BullMQ** before running more than one instance.
4. **Add a scheduler.** Rank checks are triggered manually or by an external cron hitting `POST /api/v1/rank-tracking`. PRD §5 sets the cadence as daily; there is no in-app scheduler yet.
5. Then Phase 4: Backlinks and Domain Authority (both need a licensed index — PRD §6), Revenue Potential, API-key auth for the public API, bulk at 100K–1M, and the white-label Agency Mode UI.
