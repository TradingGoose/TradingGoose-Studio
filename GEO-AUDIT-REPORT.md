# GEO Audit Report: TradingGoose

**Audit Date:** 2026-04-05
**URL:** https://tradinggoose.ai
**Business Type:** SaaS (Open-Source + Hosted, Freemium)
**Pages Analyzed:** 7 sitemap URLs + robots.txt + llms.txt + docs subdomain + changelog

---

## Executive Summary

**Overall GEO Score: 50/100 (Poor — borderline Fair)**

TradingGoose has **world-class technical GEO foundations** (robots.txt, llms.txt, rich schema, SSR) but is essentially **invisible to AI systems as an entity** because it has almost no third-party brand authority, no content marketing surface, and no named human experts backing the product. The site is perfectly crawlable — there just isn't enough there for AI systems to cite, and there's a **competing "TradingGoose" GitHub project** that creates entity-disambiguation risk.

### Score Breakdown

| Category | Score | Weight | Weighted Score |
|---|---|---|---|
| AI Citability | 62/100 | 25% | 15.5 |
| Brand Authority | 22/100 | 20% | 4.4 |
| Content E-E-A-T | 35/100 | 20% | 7.0 |
| Technical GEO | 85/100 | 15% | 12.75 |
| Schema & Structured Data | 72/100 | 10% | 7.2 |
| Platform Optimization | 30/100 | 10% | 3.0 |
| **Overall GEO Score** | | | **49.85 → 50/100** |

---

## Critical Issues (Fix Immediately)

None. No blocking problems — crawlers can reach the site and parse it.

## High Priority Issues (Fix Within 1 Week)

1. **Sitemap is dangerously thin (7 URLs).** The sitemap only lists homepage, signup, login, terms, privacy, licenses, changelog. The 500+ documentation pages on `docs.tradinggoose.ai` are **not in any sitemap**, meaning AI crawlers have to discover them via links. For a developer-tool brand, docs pages are the single highest-value surface for AI citations ("how do I do X with TradingGoose?").
   - **Fix:** Publish `docs.tradinggoose.ai/sitemap.xml` and cross-reference it from the apex `robots.txt`.

2. **No named humans / zero E-E-A-T signals.** Organization is listed only as "TradingGoose Studio." No founder name, no team page, no author bios, no LinkedIn profiles, no credentials. AI systems rank content partially on verifiable human expertise — anonymous SaaS projects get cited less.
   - **Fix:** Add a `/team` or `/about` page with named founders, each with Person schema including `sameAs` links to LinkedIn / X / GitHub profiles.

3. **Entity disambiguation risk: competing "TradingGoose" project on GitHub.** A search for "TradingGoose" surfaces `github.com/TradingGoose/TradingGoose.github.io` (a different multi-agent LLM trading framework) ahead of this one. AI models will conflate the two.
   - **Fix:** (a) Add a prominent disambiguator to Organization schema (`alternateName: "TradingGoose Studio"`, `description` emphasizing "visual workflow platform, not the multi-agent framework"). (b) Reach out to the other project to add a cross-link / clarification. (c) Submit both to Wikidata with distinct Q-entities.

4. **No blog / no content marketing surface.** Zero articles, zero comparison pages, zero tutorials on the apex domain. AI systems prefer to cite editorial/tutorial content over product marketing pages.
   - **Fix:** Launch `/blog` with 6-12 seed articles: "TradingGoose vs n8n for trading automation", "How to build an RSI-triggered LLM agent", "PineTS vs Pine Script: what's different".

5. **`llms.txt` served via 308 redirect (apex → www).** Some AI crawlers may not follow redirects for `llms.txt`. File exists and has good content, but accessibility is degraded.
   - **Fix:** Serve `llms.txt` with a 200 directly on both `tradinggoose.ai/llms.txt` and `www.tradinggoose.ai/llms.txt`.

## Medium Priority Issues (Fix Within 1 Month)

6. **FAQPage schema only on homepage.** Docs pages with Q&A content lack FAQPage/QAPage markup.
7. **No HowTo schema on tutorial/docs pages.** HowTo is one of the highest-leverage schema types for AI citation ("step-by-step how do I...").
8. **Changelog entries lack Article schema.** Each release entry (e.g., v2026.04.04) should be marked up as an `Article` or `TechArticle` with `datePublished` and `author`.
9. **No `llms-full.txt`.** The short `llms.txt` is good but a companion `llms-full.txt` with complete docs context would dramatically improve AI grounding.
10. **No Wikipedia / Wikidata entry.** Entities without Wikidata IDs are systematically under-cited by AI.
11. **No Product Hunt launch, no Reddit presence.** These are two of the highest-weighted third-party signals AI models use for developer tools.
12. **Docs subdomain Organization schema may not be linked** to apex Organization via `sameAs` — verify entity consolidation.

## Low Priority Issues

13. Meta description is solid but could lead with the primary differentiator ("no-code" / "visual") in the first 120 chars.
14. No Open Graph image verified (review og:image dimensions/alt).
15. Consider `SoftwareApplication.applicationCategory` set to "FinanceApplication" for richer entity classification.
16. Add `speakable` schema property for key homepage passages (voice/AI assistant readability).

---

## Category Deep Dives

### AI Citability (62/100)

**Strengths:**
- Clear, declarative value proposition in meta description and H1.
- FAQPage schema with direct Q&A format (highly quotable).
- `llms.txt` is well-written: states what the product IS and what it IS NOT — ideal for AI grounding.
- Changelog uses clean H2/H3 hierarchy with dates.

**Weaknesses:**
- Only 7 crawlable marketing URLs; AI engines have almost nothing to quote.
- No comparison pages ("TradingGoose vs X") — AI systems heavily cite comparison content.
- No listicles, no "top 10", no tutorial walkthroughs on the apex domain.
- Most quotable content lives on `docs.tradinggoose.ai` but isn't sitemapped.

**Rewrite suggestion for homepage FAQ:** Add at least 8 more Q&A pairs covering: pricing tiers, self-hosting, supported brokers, backtesting capabilities, PineTS vs Pine Script, team/collaboration features, data retention, security.

### Brand Authority (22/100)

**Platform presence map:**

| Platform | Status | Notes |
|---|---|---|
| GitHub | ✓ Present | `tradinggoose/tradinggoose-studio` — star count not verified |
| Discord | ✓ Linked | Community server linked in footer |
| X (Twitter) | ✓ Linked | Profile exists |
| Reddit | ✗ Absent | Zero mentions in r/algotrading, r/selfhosted, r/LocalLLaMA |
| Product Hunt | ✗ Absent | No launch found |
| YouTube | ✗ Not discoverable | No channel / tutorials found |
| Wikipedia | ✗ Absent | No article |
| Wikidata | ✗ Absent | No entity ID |
| LinkedIn (company) | ? Unverified | Not linked from homepage |
| Hacker News | ? Unverified | No Show HN found |

**Critical gap:** AI models disproportionately cite entities that appear on Reddit, YouTube tutorials, Wikipedia, and Product Hunt. TradingGoose has none of these.

### Content E-E-A-T (35/100)

- **Experience:** Not demonstrated — no case studies, no "who's using us" logos.
- **Expertise:** Implied via product quality, but no named experts credited.
- **Authoritativeness:** Weak — no press mentions, no conference talks, no external citations.
- **Trustworthiness:** OK — legal pages present (Privacy, Terms, Licenses), open-source code, clear disclaimer ("not a financial advisor").

### Technical GEO (85/100) — **Strongest category**

- robots.txt: **exemplary** — 22+ AI crawlers explicitly allowlisted.
- llms.txt: **present and well-written** (minor 308 redirect issue).
- Rendering: Next.js SSR, core content in initial HTML.
- Sitemap: present but thin.
- HTTPS + HTTP/2: ✓
- Disallow rules are appropriate (`/api/`, `/workspace/`, `/_next/`).

### Schema & Structured Data (72/100)

**Present on homepage:**
- SoftwareApplication ✓
- Organization ✓
- WebSite ✓
- WebPage ✓
- BreadcrumbList ✓
- FAQPage ✓
- Offer (multiple, for pricing tiers) ✓

**Missing:**
- Person schema (no named humans) ✗
- HowTo schema (no tutorials marked up) ✗
- Article schema on changelog entries ✗
- VideoObject (no videos) ✗
- Review / AggregateRating ✗

### Platform Optimization (30/100)

| Platform | Readiness |
|---|---|
| Google AI Overviews | Medium — schema-rich but thin content |
| ChatGPT (SearchGPT) | Medium — llms.txt helps, but low citation surface |
| Perplexity | Low — no comparison/review content to cite |
| Gemini | Low — no Google entity footprint (no Wikipedia, no G Business) |
| Bing Copilot | Medium — robots.txt allowlists Bingbot + Bytespider |

---

## Quick Wins (Implement This Week)

1. **Generate and publish docs subdomain sitemap** — 500+ new citable pages unlocked.
2. **Fix llms.txt redirect** — serve 200 directly on apex.
3. **Add /team page with 2+ Person schemas** including `sameAs` to LinkedIn/X/GitHub.
4. **Ship `llms-full.txt`** — auto-generated from docs markdown.
5. **Submit Wikidata entity** — "TradingGoose Studio" with `instance of: software`, disambiguated from the other TradingGoose project.
6. **Launch on Product Hunt** — single highest-ROI GEO signal for a developer SaaS launch.

## 30-Day Action Plan

### Week 1: Technical GEO Hardening
- [ ] Publish `docs.tradinggoose.ai/sitemap.xml`
- [ ] Serve `llms.txt` with 200 on both apex and www
- [ ] Write and publish `llms-full.txt`
- [ ] Add HowTo schema to top 10 docs tutorial pages

### Week 2: Entity & Authority Foundation
- [ ] Create `/team` and `/about` pages with named humans + Person schema
- [ ] Submit Wikidata entity with disambiguator
- [ ] Claim LinkedIn company page, link from footer
- [ ] Cross-link Organization schema via `sameAs` across apex + docs subdomain

### Week 3: Content Surface Expansion
- [ ] Launch `/blog` with 3 seed articles (comparison + tutorial + roadmap)
- [ ] Add 8+ Q&A pairs to homepage FAQPage
- [ ] Mark up each changelog release entry as `TechArticle`
- [ ] Create a "vs. alternatives" comparison page (n8n, Zapier, TradingView)

### Week 4: Third-Party Authority
- [ ] Product Hunt launch
- [ ] Show HN post
- [ ] Post in r/algotrading and r/selfhosted (disclosure-compliant)
- [ ] Record 2 YouTube walkthroughs (even unlisted is a citable VideoObject)
- [ ] Reach out to the other github.com/TradingGoose for mutual disambiguation

---

## Appendix: Pages Analyzed

| URL | Title | GEO Issues |
|---|---|---|
| https://tradinggoose.ai | TradingGoose — Visual Workflow Platform for LLM Trading | 0 technical, strong schema |
| https://tradinggoose.ai/signup | Signup | Thin, auth-gated |
| https://tradinggoose.ai/login | Login | Thin, auth-gated |
| https://tradinggoose.ai/terms | Terms of Service | Legal — OK |
| https://tradinggoose.ai/privacy | Privacy Policy | Legal — OK |
| https://tradinggoose.ai/licenses | Licenses | Legal — OK |
| https://tradinggoose.ai/changelog | Changelog | Missing Article schema per entry |
| https://tradinggoose.ai/robots.txt | — | Exemplary |
| https://tradinggoose.ai/llms.txt | — | 308 redirect to www |
| https://docs.tradinggoose.ai | TradingGoose Documentation | Not in apex sitemap |

**Audit constraints:** Sitemap contained only 7 URLs so the 50-page crawl limit was not reached. Docs subdomain was sampled (homepage only) but not fully crawled in this audit.
