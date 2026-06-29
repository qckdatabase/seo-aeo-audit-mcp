# Design — Server-side AI-Visibility Engine + Core Web Vitals + Health Score

Date: 2026-06-29
Branch: `ai-visibility`
Status: approved (design), pending spec review

## Context

`seo-aeo-audit-mcp` currently has two tools: `fetch_audit_data(url)` (BFS crawl + Ahrefs v3 + brand/industry inference) and `render_audit_pdf(...)` (landscape PDF, 5 sections incl. an AI-Visibility section). Today the AI-Visibility section is produced by the **driving LLM agent doing plain `web_search`** — subjective, non-reproducible, no defensible metric. There is **no performance signal** (no Core Web Vitals) and **no top-line score/grade**.

The local `qckbot` project (SEO SaaS) has a rigorous, reproducible answer-engine-visibility system, a CrUX Core-Web-Vitals integration, and a composite health score. This work ports those three capabilities into the MCP, server-side, so the audit is self-contained and the AI-visibility metric is defensible.

## Goals

1. Move AI-visibility from the agent into the server as a dedicated tool, using OpenAI (gpt-4o) — a faithful port of qckbot's method.
2. Add Core Web Vitals (CrUX) to `fetch_audit_data`.
3. Add a composite health score + grade to the report.

## Non-goals

- DataForSEO (Ahrefs is already richer here).
- GSC/GA4 (qckbot has neither; out of scope).
- Replacing the PDF report format (the landscape sample format stays).
- The qckbot Vercel step-machine / queueing (over-engineered for an MCP).

## Provider decision

OpenAI / **gpt-4o** with the Responses API + `web_search_preview` tool, exactly as qckbot does it. Requires `OPENAI_API_KEY`. (Anthropic was considered; OpenAI chosen for a 1:1 port of the proven method.)

## Architecture — three tools

| Tool | Change | Returns |
|---|---|---|
| `fetch_audit_data(url)` | add CrUX (cheap, ~4 HTTP calls) | `{ crawl, ahrefs, crux, brand_name, industry }` |
| `fetch_ai_visibility(url, brand?, industry?)` | **NEW** (OpenAI, ~10 calls) | the `ai_visibility` object `render_audit_pdf` already consumes |
| `render_audit_pdf(ahrefs, crawl, ai_visibility, narratives, crux?, output_path?)` | add `crux` arg; compute + render health score | PDF path |

**Agent flow:** `fetch_audit_data` → `fetch_ai_visibility` (pass `brand`/`industry` from step 1) → write narratives → `render_audit_pdf` (pass `crux` through from step 1). `SKILL.md` Step 2 changes from "agent does 7 web searches" to "call `fetch_ai_visibility`".

`fetch_ai_visibility` takes optional `brand`/`industry`; if absent it does one lightweight homepage fetch to infer brand (reuse `inferBrandName` against a 1-page crawl). The agent normally passes them from step 1 to avoid the extra fetch.

## New modules (`src/`)

- `lib/openai.ts` — thin client. `groundedRanking(query): Promise<RankEntry[]>` (Responses API, `tools:[{type:'web_search_preview'}]`, strict `json_schema` → `{rank,brand,domain,reason,url}[]`). `chatJSON(schema, messages)` (chat.completions, structured output, no search) for prompt generation. Reads `OPENAI_API_KEY`; throws a clear error if missing.
- `lib/competitor-denylist.ts` — port of qckbot `BLOCK_ANYWHERE` (Google/Amazon/Reddit/Wikipedia… incl. subdomains) + `BLOCK_ROOT_ONLY` (Shopify/Wix/Medium… keep customer subdomains) + `isDeniedCompetitor(domain)`.
- `lib/crux.ts` — `fetchCoreWebVitals(domain): Promise<CruxResult | null>`. Calls `chromeuxreport.googleapis.com/v1/records:queryRecord?key=$CRUX_API_KEY` for the origin, `DESKTOP` + `PHONE`, metrics `largest_contentful_paint, interaction_to_next_paint, cumulative_layout_shift`. Tries www + non-www. Returns p75 values + per-metric verdict; `null` if `CRUX_API_KEY` missing or origin has no CrUX data.
- `lib/score.ts` — `computeHealthScore({ahrefs, crawl, crux, ai}): { score, grade, breakdown }`.
- `tools/ai-visibility.ts` — `fetchAiVisibility(domain, brand, industry): Promise<AIVisibilityResult>` (the algorithm below).

## AI-visibility algorithm (ported from qckbot)

1. **Generate prompts** (`chatJSON`, gpt-4o): 7 realistic category questions a *buyer* would type, **hard exclusion** of the brand name, brand domain, and competitor names (qckbot `generate-prompts.ts:48-53,130-152`). Cluster/label topics (one short label each).
2. **Grounded ranking per prompt** (`groundedRanking`, concurrency 3): "identify the top ~10 brands/sites a buyer would be recommended today; for each: brand, root domain, source URL, 1-sentence reason; rank by relevance/authority; do not bias toward any brand" → strict JSON `{rank,brand,domain,reason,url}[]` (qckbot `ai-ranking.ts:136-160`).
3. **Detect** (qckbot `ai-prompt-check.ts:43-122`): match the model's returned root domain directly against the target via `bareHost` — **no redirect-resolution**, which avoids issuing requests to model-supplied (untrusted) hosts (blind-SSRF risk) for marginal alias-matching value. Brand appears if any returned domain === target domain; record its `rank` as position + `reason` as snippet (both coerced: non-numeric rank → null). Competitors = other returned domains, `isDeniedCompetitor`-filtered, max 5 per prompt, with average position aggregated across prompts.
4. **Aggregate** (qckbot `aggregate.ts:91-275`) into the existing `AIVisibilityResult` shape:
   - `brand_visibility_pct` = round(appeared / total × 100)
   - `avg_position` = mean of positions where appeared (or null)
   - `ranked_in`, `total_queries`
   - `topic_breakdown[]` = {topic, query, appeared, position, snippet}
   - `competitor_brands[]` = top 8 by appearances, with avg_position
   - `sample_responses[]` = up to 3 where brand appeared

Per-prompt failures are caught and skipped (don't fail the audit). Concurrency cap 3. One transient retry per call.

## CrUX detail

`CruxResult` (new type): `{ available: boolean, desktop: DeviceCWV | null, mobile: DeviceCWV | null }` where `DeviceCWV = { lcp_ms, inp_ms, cls, lcp_verdict, inp_verdict, cls_verdict }`. Thresholds (qckbot `score.ts:84-94`): LCP <2500/<4000; INP <200/<600; CLS <0.1/<0.25 → good / needs-improvement / poor. Display-only in qckbot; here it **also feeds the health score**.

## Health score (`lib/score.ts`)

Sub-scores 0–100, **renormalized over present dimensions**:
- **On-page** — qckbot severity-weighted penalty over live crawled pages: weights high=3/med=2/low=1; `penalty = min(Σweight / (livePages·3), 1)·100`; `score = max(0, 100 − penalty)`. Weight **0.35**.
- **Authority** — from DR + badges (organic keywords ≥100/≥25, backlinks ≥500/≥50 → GREAT 88 / OK 60 / POOR 30, blended with DR). Weight **0.25**.
- **Performance** — CrUX: all metrics good → 90; mixed → 60; any poor → 30 (worst of desktop/mobile). Weight **0.20**. Omitted from the blend if CrUX unavailable (weights renormalize).
- **AI visibility** — `brand_visibility_pct` directly. Weight **0.20**. Omitted if AI-viz not run.

`grade`: ≥80 A / ≥65 B / ≥50 C / else D. `breakdown` lists each present sub-score + weight for transparency.

## Report changes (`lib/report.ts`)

- **Page 1**: health-score chip near the title — `Health <score>/100 · <grade>`.
- **Page 3 (Technical)**: compact "Core Web Vitals" card — 3 metrics × 2 devices, verdict-colored. Omitted cleanly when `crux` is null/unavailable.
- **Page 5 (AI Visibility)**: unchanged shape; now server-fed. Optionally show the score in the headline stat row (already shows `brand_visibility_pct`).

`render_audit_pdf` gains an optional `crux` arg; `buildHtml` computes the health score from `{ahrefs, crawl, crux, ai}`.

## Types (`lib/types.ts`)

Add `CruxResult`, `DeviceCWV`, `HealthScore`. Existing `AIVisibilityResult` unchanged (the new tool produces exactly that shape).

## Env

- `OPENAI_API_KEY` — required for `fetch_ai_visibility`; clear error if missing.
- `CRUX_API_KEY` — optional; CrUX skipped if absent.
- Update `.env.example` to list both (and drop unused ANTHROPIC/OPENAI placeholders that don't match reality → keep AHREFS + OPENAI + CRUX).

## Error handling / cost

- Graceful degradation everywhere: missing keys → `null`, never a crash. One bad LLM/HTTP call never aborts the audit (`.catch(() => null/[])`).
- Concurrency cap 3 on OpenAI calls; one transient retry; per-call timeout.
- `fetch_audit_data` stays cheap (CrUX is ~4 plain HTTP calls); the ~10 OpenAI calls live only in `fetch_ai_visibility`, so cost is incurred only when AI-visibility is requested.

## Testing (ponytail)

Assert-based self-checks, no framework:
- `score.ts` — health score math (known inputs → known output; renormalization when a dimension is absent).
- `crux.ts` — verdict bucketing + parsing a sample CrUX payload (fixture, no network).
- `ai-visibility.ts` — aggregation math (mocked ranking arrays → expected `brand_visibility_pct` / `avg_position` / competitor counts; no live API).

## File-by-file change list

New: `lib/openai.ts`, `lib/competitor-denylist.ts`, `lib/crux.ts`, `lib/score.ts`, `tools/ai-visibility.ts` (+ 3 self-check files).
Modified: `index.ts` (register `fetch_ai_visibility`; add `crux` to `fetch_audit_data` return + `render_audit_pdf` schema), `tools/ahrefs.ts` (unchanged — reused), `lib/types.ts` (CrUX + HealthScore types), `lib/report.ts` (health chip + CWV card + score compute), `.env.example` (keep AHREFS + add OPENAI + CRUX, drop ANTHROPIC), `SKILL.md` (Step 1 returns crux; Step 2 = call `fetch_ai_visibility`).

## Risks

- OpenAI cost/latency per audit (~10 calls). Mitigated by isolating in its own tool + concurrency cap.
- CrUX has no data for low-traffic origins → card omitted (expected, not an error).
- `web_search_preview` output drift → strict JSON schema + sanitize/truncation-recovery (qckbot `ai-serp.ts:79-220`).
