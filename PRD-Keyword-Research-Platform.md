# PRD — AI-Powered Keyword Research & SEO Intelligence Platform

**Working name:** KeywordForge (placeholder — rename freely)
**Owner:** Bhanu, Prime Web Media
**Prepared for:** Build with Claude Code
**Version:** 1.0 draft
**Date:** 2026-08-28

---

## 1. Overview & Vision

Build a web-based keyword research and SEO intelligence platform that lets agencies and marketers discover, prioritize, and act on keyword opportunities — covering discovery, difficulty, intent, clustering, competitor gaps, rank tracking, and reporting, with an agency/white-label mode for managing multiple client accounts.

This is functionally a competitor to Ahrefs / Semrush / Ubersuggest / Moz. That is a multi-year, well-funded engineering effort at the companies above. This PRD is written so it can actually be built incrementally, starting from a real MVP, rather than attempting all 35 modules at once.

## 2. Problem Statement

SEO tools are expensive ($99–$450+/month) and often overkill for small agencies and SMBs. Prime Web Media (and similar small agencies) need a lighter, purpose-built tool for:
- Fast keyword discovery for client niches (jewellery, restaurants, boutiques, local SMBs)
- Content planning (briefs, clusters, topical maps)
- Competitor and gap analysis to win new client pitches
- White-labeled reporting for client delivery

## 3. Target Users

| Persona | Need |
|---|---|
| Agency owner (you) | Research keywords fast across many clients, produce reports, win pitches |
| In-house content strategist | Plan content calendars from keyword clusters + briefs |
| Freelance SEO consultant | Affordable single-tool alternative to Ahrefs |
| Local business owner (via agency) | Understand local search demand |

## 4. Goals

- Ship a usable MVP within weeks, not years, by leaning on third-party data APIs instead of building a web crawler
- Cover the highest-value modules first (discovery, volume, difficulty, intent, clustering, briefs) — these alone replace 80% of daily agency workflow
- Architect from day one for bulk (10K+ keyword) processing and multi-tenant agency use
- Defer the modules that require owning a web-scale crawl index (backlinks, domain authority, historical SERP data) to a later phase or a data-partner integration

## 5. Non-Goals (for MVP)

- Building an independent web crawler / link graph (this is what makes Ahrefs Ahrefs — extremely capital intensive)
- Real-time rank tracking at massive scale (start with daily, not hourly)
- Native mobile apps
- Full white-label reseller marketplace (basic client-branding only, not a self-serve reseller program)

## 6. Critical Architectural Decision: Data Sourcing

This determines cost, legal exposure, and what's actually buildable.

| Data need | Recommended source | Notes |
|---|---|---|
| Search volume, CPC, related/long-tail keywords, SERP results, trends | **DataForSEO API** (or Semrush/Ahrefs reseller API where available) | Paid per-call, scales with usage; realistic starting point |
| Keyword ideas at scale | DataForSEO Keyword Ideas / Keyword Suggestions endpoints | Bulk-friendly |
| YouTube keywords | YouTube Data API + DataForSEO YouTube endpoints | |
| Amazon keywords | DataForSEO Amazon endpoints or Amazon Ads API (if you can get access) | |
| Google Maps / local keywords | Google Places API + DataForSEO Local Pack data | |
| SERP features (PAA, snippets, local pack, video, shopping) | DataForSEO SERP API | Comes bundled with SERP calls |
| Rank tracking | DataForSEO SERP API polled on schedule, or a rank-tracking-specific API | |
| Backlink analysis, Domain Authority | **Not buildable in-house at MVP stage.** License from DataForSEO's backlink index, Moz API, or Ahrefs API (if partner terms allow) — this is a recurring cost line, not a one-time build | |
| Historical data | Store what you fetch over time; you cannot buy someone else's history — you have to accumulate your own from day one | |

**Cost implication:** every keyword lookup, SERP check, and backlink query is a metered API cost. Bulk analysis of "1M+ keywords" (as in your table) needs to be budgeted explicitly — this is likely your single biggest recurring line item and should be modeled in the business plan before committing to unlimited bulk analysis in pricing.

## 7. Feature Roadmap (35 modules phased)

### Phase 1 — MVP (core research loop)
1. Keyword Discovery
2. Search Volume (+ trends)
3. Keyword Difficulty
4. CPC & Commercial Value
5. Search Intent AI
6. Related Keywords (semantic expansion)
7. Long-Tail Finder
8. Question Finder
9. Keyword Clustering
10. Export (CSV/Excel)

### Phase 2 — Competitive & content layer
11. SERP Analyzer
12. Competitor Keywords
13. Keyword Gap
14. Content Gap
15. AI Content Briefs
16. AI Topic Map
17. AI Keyword Generator (from business/website URL)
18. SERP Features
19. Opportunity Score
20. Traffic Potential

### Phase 3 — Tracking & vertical expansion
21. Rank Tracker
22. Local SEO
23. Google Maps Keywords
24. YouTube Keywords
25. Amazon Keywords
26. Keyword Cannibalization
27. Trend Detection
28. Seasonality
29. Keyword Alerts

### Phase 4 — Enterprise/agency & data-partner-dependent
30. Backlink Analysis
31. Domain Authority Analysis
32. Historical Data (deepens automatically over time from Phase 1 onward)
33. Revenue Potential
34. API (developer access)
35. Bulk Analysis at 100K–1M+ scale
36. Agency Mode (multi-client, white-label, reporting)

> Agency Mode is pulled forward conceptually — multi-tenancy should be in the data model from Phase 1 even though the polished white-label UI comes later. Retrofitting multi-tenancy later is expensive; not having the white-label PDF exporter yet is cheap to defer.

## 8. Core User Flows (MVP)

1. **Seed → Ideas:** User enters a seed keyword or website URL → system returns thousands of keyword ideas with volume, difficulty, CPC, intent.
2. **Filter → Cluster:** User filters (volume range, difficulty ceiling, intent type) → remaining keywords auto-cluster into topic/intent groups.
3. **Cluster → Brief:** User selects a cluster → AI generates a content brief (target keyword, related terms to include, heading structure, questions to answer, competitor content summary).
4. **Bulk Import:** User uploads a CSV of existing keywords → system enriches with volume/difficulty/intent in bulk (async job, progress bar, email on completion).
5. **Export/Report:** User exports filtered/clustered results to CSV/Excel or a branded PDF report.

## 9. Technical Architecture

**Frontend:** React (Next.js) SPA/SSR hybrid — dashboard, keyword explorer table (virtualized for 10K+ rows), cluster visualizations, report builder.

**Backend:** Given your PHP/MySQL background, either:
- **Laravel** (PHP) — fastest for you to build and maintain solo, good queue/job support (Laravel Horizon) for bulk processing, or
- **Node.js/NestJS** — better ecosystem fit if you want to lean heavily on JS-based AI/embedding libraries

Recommendation: **Laravel** for the core app + a small **Python microservice** for AI/embedding-heavy work (clustering, intent classification, brief generation via Claude API), talking over an internal API.

**Databases:**
- **PostgreSQL** — core relational data (users, projects, clients, keywords, clusters)
- **ClickHouse or TimescaleDB** — time-series data (historical rank positions, volume history) at scale
- **Redis** — caching, job queues (bulk analysis, rank tracking polling)
- **Vector store** (pgvector, or a dedicated vector DB) — semantic keyword clustering and "related keywords" via embeddings

**Job/Queue layer:** Laravel Horizon (or BullMQ if Node) — essential for:
- Bulk keyword enrichment (10K–1M+ rows)
- Scheduled rank tracking checks
- Alert evaluation jobs

**AI layer (Claude API):**
- Search Intent classification
- Content brief generation
- Topic map / topical authority structuring
- AI Keyword Generator from a business description or URL

**External data layer:** DataForSEO (or equivalent) integration service — a dedicated internal service that wraps all third-party API calls, handles caching (don't re-pay for the same keyword's volume twice in 30 days), rate limiting, and cost tracking per client/project.

**Multi-tenancy:** every core table (keywords, projects, reports) scoped by `agency_id` / `client_id` from day one, with row-level access control — required for Agency Mode later without a rebuild.

## 10. Data Model (core entities, simplified)

- `agencies` (tenant root)
- `clients` (belongs to agency)
- `projects` (belongs to client — a "site" or "campaign")
- `keywords` (text, language, location)
- `keyword_metrics` (keyword_id, date, volume, cpc, difficulty, competition) — time-series
- `serp_snapshots` (keyword_id, date, ranked results JSON, SERP features present)
- `clusters` (project_id, name, intent_type)
- `cluster_keywords` (many-to-many)
- `content_briefs` (cluster_id, generated content JSON)
- `rank_tracking_entries` (project_id, keyword_id, domain, date, position)
- `competitors` (project_id, domain)
- `alerts` (project_id, trigger condition, status)
- `api_keys` (agency_id, scopes, rate limit)
- `reports` (project_id, branding config, generated file path)

## 11. API Design (Phase 4, but design now)

RESTful, versioned (`/api/v1/...`), scoped by API key → agency/client:
- `POST /keywords/discover`
- `GET /keywords/{id}/metrics`
- `POST /keywords/bulk-analyze` (async, returns job ID)
- `GET /jobs/{id}`
- `POST /clusters/generate`
- `POST /briefs/generate`
- `GET /rank-tracking/{project_id}`
- `POST /reports/generate`

Rate limits and usage metering per API key, since every call has a real upstream data cost.

## 12. Non-Functional Requirements

- **Scale:** Support async bulk jobs up to 1M keywords without blocking the UI — this must be a background job with progress polling, not a synchronous request.
- **Cost control:** Cache all third-party API responses (e.g., 30-day TTL on volume data) — re-querying the same keyword repeatedly is the fastest way to burn budget.
- **Multi-tenancy & data isolation:** client A must never see client B's data, enforced at the query layer, not just the UI.
- **Reporting performance:** PDF/Excel export of large keyword sets must be a background job, not synchronous.
- **Security:** API keys hashed at rest, per-key rate limiting, audit log of exports (client data leaving the system).

## 13. Success Metrics

- Time-to-first-insight: seed keyword → clustered, scored keyword list in under 30 seconds for up to 10K results
- % of keyword lookups served from cache vs. fresh API call (cost efficiency)
- Number of active client projects per agency account
- Content briefs generated per week (engagement proxy)
- Report exports per month (client-facing value proxy)

## 14. Risks & Open Questions

- **Data cost risk:** Bulk analysis and backlink/DA modules can get expensive fast under real usage — needs a pricing/quota model before launch, not after.
- **Legal risk:** If any scraping (vs. licensed API data) is used for SERP or backlink data, review terms of service and legal exposure carefully.
- **Differentiation risk:** With the same underlying data provider as competitors, the differentiator has to be workflow (briefs, clustering, agency reporting), not raw data — worth deciding this positioning explicitly.
- **Build sequencing:** Confirm Phase 1 scope with you before development starts — is the MVP list above right, or should Agency Mode / white-labeling move earlier because client delivery is the immediate business need?

## 15. Open Decisions for You

- Laravel vs. Node backend — leaning Laravel given your PHP background; confirm.
- DataForSEO vs. another data provider — worth comparing actual pricing for your expected query volume before committing.
- Pricing model for end users (seat-based? credit/quota-based given the metered upstream cost?).
- MVP phase scope confirmation (Section 7).

---
*This PRD is a living document — refine Phase 1 scope with Claude Code as implementation begins, since real API pricing and rate limits from your chosen data provider will affect what's feasible in the first build.*
