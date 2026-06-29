# SEO / AEO Audit Skill

Run a full 5-section SEO, AEO, and AI-Visibility audit for any website and produce a PDF report.

**Trigger:** when the user asks to audit a URL — "audit https://...", "run a site audit for ...", "seo audit ...", etc.

---

## Instructions

Work through the four steps below in order. Think carefully at each step — you are the strategist; the MCP tools are just data collectors and a PDF renderer.

### Step 1 — Gather Data

Call `fetch_audit_data` (from the `seo-aeo-audit` MCP server) with the URL.

The response is a JSON object containing:
- `crawl` — pages crawled, on-page issues, schema coverage summary
- `ahrefs` — Domain Rating, Ahrefs Rank, organic keywords & traffic, backlinks, referring domains, top keywords, top pages, top referring domains
- `crux` — Core Web Vitals (LCP/INP/CLS, desktop + mobile) from the Chrome UX Report, or `null` if unavailable
- `brand_name` — inferred brand name (e.g. "Acme Corp")
- `industry` — hint derived from page titles and H1s (e.g. "CRM software, project management, team collaboration")

Keep the entire `crawl`, `ahrefs`, and `crux` objects — you'll pass them unchanged to Step 4.

---

### Step 2 — AI Visibility

Call `fetch_ai_visibility` (from the `seo-aeo-audit` MCP server) with:
- `url` — the audited URL
- `brand` — `brand_name` from Step 1
- `industry` — `industry` from Step 1

The server generates unbiased, brand-excluded buyer queries, runs grounded web-search rankings via OpenAI, detects the brand + competitors (with domain redirect-resolution and a denylist), and returns the complete `ai_visibility` object (`brand_visibility_pct`, `avg_position`, `ranked_in`, `total_queries`, `topic_breakdown`, `competitor_brands`, `sample_responses`). Use it as-is — do not hand-assemble it.

Requires `OPENAI_API_KEY` on the server. Takes ~10–30s (7 grounded queries).

---

### Step 3 — Write Narratives

Based on the crawl + ahrefs data, write the following narrative sections. Be specific, direct, and actionable — no filler.

The report has 5 landscape sections, each with an **insight headline** (a one-sentence finding, not a generic label). Write the narratives to this exact shape:

```
{
  // SECTION 1 — Executive Summary
  executive_readout: "1-2 short paragraphs (separate with a blank line \\n\\n): overall SEO/AEO health, strengths, critical gaps",
  highest_impact_gaps: [            // 4 items, each "Label: detail" — text before the colon renders bold
    "Metadata gap: <detail>", "Heading gap: <detail>", "AEO/schema gap: <detail>", "Indexation hygiene: <detail>"
  ],
  priority_plan: {                  // columns render under fixed labels: Technical+SERP basics / AEO foundations / Authority+growth
    days_0_30: ["action 1", "action 2", "action 3"],
    days_30_60: ["action 1", "action 2"],
    days_60_90: ["action 1", "action 2"]
  },

  // SECTION 2 — Search Demand + Content Performance
  content_headline: "One-sentence insight, e.g. 'Organic visibility is concentrated in a few generic terms'",
  content_analysis: {
    whats_working: ["bullet 1", "bullet 2", "bullet 3"],     // array of bullets (cite KD / positions from ahrefs)
    limiting_growth: ["bullet 1", "bullet 2", "bullet 3"],   // array of bullets
    content_moves: [                                         // exactly 3 titled moves
      { title: "Short title", body: "1-2 sentence action" },
      { title: "Short title", body: "1-2 sentence action" },
      { title: "Short title", body: "1-2 sentence action" }
    ]
  },

  // SECTION 3 — Technical SEO + AEO Readiness
  technical_headline: "One-sentence insight, e.g. 'Crawlable, but templates are under-optimized for search and answer engines'",
  technical_aeo_findings: [         // 3-4 findings, each "Lead sentence. detail" — first sentence renders bold
    "No structured data detected. <detail>", "No answer-first blocks. <detail>", "Entity signals are weak. <detail>"
  ],
  technical_fix_list: {
    indexation: ["fix 1", "fix 2"],
    on_page: ["fix 1", "fix 2", "fix 3"],
    aeo_schema: ["fix 1", "fix 2"]
  },

  // SECTION 4 — Authority + Roadmap
  authority_headline: "One-sentence insight, e.g. 'Authority exists, but link quality and topic architecture need cleanup'",
  authority_interpretation: "2-3 sentences on backlink profile, DR, link quality (cite spam / high-volume low-quality linkers)",
  authority_actions: ["link-strategy bullet 1", "bullet 2", "bullet 3"],
  roadmap: {                        // columns render under fixed labels: Repair foundations / Build AEO assets / Grow authority
    month_1: ["deliverable 1", "deliverable 2", "deliverable 3"],
    month_2: ["deliverable 1", "deliverable 2"],
    month_3: ["deliverable 1", "deliverable 2"]
  },
  expected_outcome: "2-3 sentences on projected traffic/ranking improvement if implemented",
  data_limitations: "One sentence on data sources/limits, e.g. 'No GSC/GA4 access; audit uses live crawl + Ahrefs API'",

  // SECTION 5 — AI Visibility (added section)
  aivisibility_headline: "One-sentence insight, e.g. 'Invisible for high-intent queries; surfaces only on brand-adjacent searches'"
}
```

---

### Step 4 — Render PDF

Call `render_audit_pdf` with:
- `ahrefs` — the object from Step 1 (pass through unchanged)
- `crawl` — the object from Step 1 (pass through unchanged)
- `crux` — the object from Step 1 (pass through unchanged; omit/null if unavailable)
- `ai_visibility` — the object returned by `fetch_ai_visibility` in Step 2
- `narratives` — written in Step 3
- `output_path` — omit unless the user specified a path (defaults to `~/Desktop/<domain>-seo-audit.pdf`)

The tool returns the PDF path. Tell the user where the file was saved.
