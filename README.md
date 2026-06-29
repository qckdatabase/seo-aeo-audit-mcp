# SEO / AEO Audit MCP

An MCP server + skill that produces a **5-section landscape PDF audit** for any website:

1. **Executive Summary** — health score, key metrics, top gaps, priority plan
2. **Search Demand + Content Performance** — Ahrefs keywords/pages, what's working / limiting growth
3. **Technical SEO + AEO Readiness** — crawl findings, Core Web Vitals (CrUX), structured-data gaps
4. **Authority + Roadmap** — backlink profile (with spam flags), 90-day roadmap
5. **AI Visibility** — how often the brand surfaces in AI answer-engine results, vs. competitors

It exposes three tools — `fetch_audit_data` (crawl + Ahrefs + Core Web Vitals), `fetch_ai_visibility` (grounded OpenAI brand-visibility), and `render_audit_pdf` — and a skill that orchestrates them into one `audit <url>` command.

## Setup

- **Have an AI assistant (Claude Code, etc.)?** Tell it: *"Set up this tool by following AGENT_SETUP.md."* → [AGENT_SETUP.md](AGENT_SETUP.md)
- **Doing it yourself?** → [SETUP.md](SETUP.md)

## Requirements
- Node.js 18+
- `AHREFS_API_KEY` (paid) — **required** (the core SEO data)
- `OPENAI_API_KEY` (paid) — optional; enables the AI Visibility section (omitted/"not measured" without it)
- `CRUX_API_KEY` (free, Google Chrome UX Report API) — optional; adds Core Web Vitals

The audit runs with only the Ahrefs key; the other two just add sections.

Keys go in a local `.env` (copy `.env.example`); never commit it.

## Use
After setup, in your assistant: `audit https://example.com` → PDF saved to your Desktop.

Each audit makes ~10 OpenAI calls plus Ahrefs API usage — small but metered cost per run.
