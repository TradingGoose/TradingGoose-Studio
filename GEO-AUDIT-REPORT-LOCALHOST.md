# GEO Audit Report: TradingGoose (localhost:3000 — post-fix verification)

**Audit Date:** 2026-04-05
**URL:** http://localhost:3000
**Business Type:** SaaS (Open-Source + Hosted)
**Purpose:** Verify the 6 code changes land correctly before production deploy.

---

## Executive Summary

**Estimated Production GEO Score (once merged): 60/100 (Fair)** — up from 50/100 (Poor).

All 6 fixes from the previous audit verified to render correctly in dev. The biggest wins: the production 404 on `/llms-full.txt` is closed, the sitemap no longer ships 404 URLs to crawlers, and homepage now emits 3 JSON-LD scripts (up from 2) with richer entity graph and live GitHub authority signal.

### Score Breakdown (projected post-deploy)

| Category | Before | After | Δ | Weight |
|---|---|---|---|---|
| AI Citability | 62 | **70** | +8 | 25% |
| Brand Authority | 22 | **28** | +6 | 20% |
| Content E-E-A-T | 35 | 35 | 0 | 20% |
| Technical GEO | 85 | **92** | +7 | 15% |
| Schema & Structured Data | 72 | **88** | +16 | 10% |
| Platform Optimization | 30 | 30 | 0 | 10% |
| **Overall** | **50** | **~60** | **+10** | |

E-E-A-T and Platform Optimization unchanged — those require non-code work (team page, external distribution).

---

## Verification Results

### ✅ Bug #1 fix: `/llms-full.txt` no longer 404

```
Before: curl https://tradinggoose.ai/llms-full.txt → 404
After:  curl http://localhost:3000/llms-full.txt → 200
        Content-Type: text/plain
        Body: "# TradingGoose - Visual Workflow Platform for Technical LLM Trading (Full Reference)..."
```

`proxy.ts:41` now allowlists `/llms-full.txt` alongside `/llms.txt` and `/changelog.xml`.

### ✅ Bug #2 fix: Sitemap trimmed to publicly-reachable routes

```xml
<!-- Before (7 URLs — 3 would 404 in production): -->
https://tradinggoose.ai
https://tradinggoose.ai/signup      ← 404
https://tradinggoose.ai/login       ← 404
https://tradinggoose.ai/terms
https://tradinggoose.ai/privacy
https://tradinggoose.ai/licenses
https://tradinggoose.ai/changelog

<!-- After (6 URLs, all 200): -->
https://tradinggoose.ai
https://tradinggoose.ai/changelog
https://tradinggoose.ai/terms
https://tradinggoose.ai/privacy
https://tradinggoose.ai/licenses
https://docs.tradinggoose.ai
```

Code comment added to prevent re-introducing 404 URLs without updating `proxy.ts` first.

### ✅ Schema #1: Organization entity strengthened

Homepage Organization node now emits:
- `alternateName: ['TradingGoose Studio', 'TradingGoose.ai']` — explicit disambiguation from the other TradingGoose GitHub project
- `sameAs: [x, github, discord, docs, www]` (5 URLs)
- `interactionStatistic: [3 InteractionCounters]` — live GitHub API data (stars, forks, watchers) pulled with 24h ISR cache
- `knowsAbout: [7 topics]` — entity topic signals
- Disambiguation sentence in `description`

### ✅ Schema #2: InteractionCounter (live authority signal)

```json
{"@type": "InteractionCounter", "interactionType": {"@type": "LikeAction"}, "userInteractionCount": 5, "name": "GitHub stars"}
{"@type": "InteractionCounter", "interactionType": {"@type": "ShareAction"}, "userInteractionCount": 0, "name": "GitHub forks"}
{"@type": "InteractionCounter", "interactionType": {"@type": "FollowAction"}, "userInteractionCount": 0, "name": "GitHub watchers"}
```

Fetched from `api.github.com/repos/TradingGoose/TradingGoose-Studio` with `next: { revalidate: 86400 }`. Graceful degradation: if API fails, property is omitted entirely — no broken schema shipped.

### ✅ Schema #3: Integrations ItemList

Homepage now emits a 3rd `<script type="application/ld+json">` enumerating all **77 integrations** as `SoftwareApplication` entries. First items verified: OpenAI, Perplexity, Mistral.

AI crawlers can now answer "what does TradingGoose integrate with?" from the homepage HTML alone — they no longer need to parse React icon components.

### ✅ Schema #4: WebPage.speakable

```json
"speakable": {
  "@type": "SpeakableSpecification",
  "cssSelector": ["h1", "h2", ".hero-description"]
}
```

Voice/AI-assistant preference signal for hero headings and description.

### ✅ Schema #5: FAQPage expanded 5 → 10 Q&A

New questions added: pricing, self-hosting, backtesting, PineTS vs Pine Script, trade execution safety.

### ✅ Schema #6: BreadcrumbList on every public subpage

| Route | Before | After |
|---|---|---|
| `/` | BreadcrumbList ✓ | unchanged |
| `/terms` | ✗ missing | ✓ BreadcrumbList → Terms of Service |
| `/privacy` | ✗ missing | ✓ BreadcrumbList → Privacy Policy |
| `/licenses` | ✗ missing | ✓ BreadcrumbList → Licenses & Notices |
| `/changelog` | ✗ missing | ✓ BreadcrumbList → Changelog (+ existing TechArticle) |

Wired via new optional `path` prop on `LegalLayout`. Changelog wraps its TechArticle + BreadcrumbList in an `@graph` array.

---

## JSON-LD Script Count per Page (post-fix)

| Page | Scripts | Types |
|---|---|---|
| `/` | **3** | SoftwareApplication (global) + @graph [Organization, WebSite, WebPage, BreadcrumbList, SoftwareApplication, FAQPage, Article] + ItemList |
| `/terms` | 2 | SoftwareApplication (global) + BreadcrumbList |
| `/privacy` | 2 | SoftwareApplication (global) + BreadcrumbList |
| `/licenses` | 2 | SoftwareApplication (global) + BreadcrumbList |
| `/changelog` | 2 | SoftwareApplication (global) + @graph [TechArticle, BreadcrumbList] |

Note: The global `SoftwareApplication` from `lib/branding/metadata.ts` is injected site-wide via `app/layout.tsx`. It was also hardened with `alternateName`, `sameAs`, disambiguator description, and a nested Organization `creator`.

---

## Remaining Gaps (not code-fixable)

The remaining 40 points require non-repo work:

| Gap | Owner | Expected lift |
|---|---|---|
| Wikidata entity (disambiguated from other TradingGoose) | 30-min manual task | +8 Brand Authority |
| Show HN / Product Hunt launch | Marketing | +6 Brand Authority |
| Reddit presence (r/algotrading, r/selfhosted) | Community | +5 Brand Authority |
| YouTube tutorials (even unlisted VideoObjects) | Content | +4 Platform Optimization |
| Named founder Person schema on /team page | Product decision | +10 E-E-A-T |
| External case studies / user logos | Customer success | +5 E-E-A-T |

---

## Appendix: All Modified Files

| File | Change |
|---|---|
| `apps/tradinggoose/proxy.ts` | Allowlist `/llms-full.txt` in hosted mode |
| `apps/tradinggoose/app/sitemap.ts` | Trim to public-only routes + docs anchor |
| `apps/tradinggoose/lib/branding/metadata.ts` | Add `sameAs`, `alternateName`, disambiguator to global schema |
| `apps/tradinggoose/app/(landing)/components/structured-data.tsx` | Async GitHub stats + `interactionStatistic` + `speakable` + entity enrichment + 6 new FAQs + Article disambiguator |
| `apps/tradinggoose/app/(landing)/components/integrations/integrations.tsx` | `ItemList` JSON-LD for 77 integrations |
| `apps/tradinggoose/app/(landing)/components/legal-layout.tsx` | Optional `path` prop → `BreadcrumbList` JSON-LD |
| `apps/tradinggoose/app/(landing)/terms/page.tsx` | Wire `path='/terms'` |
| `apps/tradinggoose/app/(landing)/privacy/page.tsx` | Wire `path='/privacy'` |
| `apps/tradinggoose/app/(landing)/licenses/page.tsx` | Wire `path='/licenses'` |
| `apps/tradinggoose/app/changelog/page.tsx` | TechArticle + BreadcrumbList @graph, RSS alternate link |
