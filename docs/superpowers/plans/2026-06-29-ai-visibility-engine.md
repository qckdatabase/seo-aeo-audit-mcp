# AI-Visibility Engine + CrUX + Health Score — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side OpenAI AI-visibility tool, CrUX Core Web Vitals, and a composite health score to the SEO/AEO audit MCP.

**Architecture:** Three tools — `fetch_audit_data` (now also returns CrUX), a new `fetch_ai_visibility` (OpenAI gpt-4o grounded brand discovery), and `render_audit_pdf` (now renders a health score + CWV card). Pure logic (verdict bucketing, aggregation, scoring, denylist) is extracted into testable functions; network calls degrade gracefully to `null`.

**Tech Stack:** TypeScript (ESM, NodeNext), `openai` SDK, `cheerio`, `puppeteer`, Ahrefs v3 + Chrome UX Report APIs. No test framework — self-checks are `assert`-based scripts run with `npx tsx`.

---

## Conventions for every task

- Work in the worktree: `/home/anivaryam/github/repositories/projects/seo-aeo-audit-mcp/.worktrees/ai-visibility`.
- Self-check files are named `*.check.ts`, run with `npx tsx src/<path>.check.ts`. They print `OK` on success and throw on failure.
- After each task: `npm run build` must pass (tsc clean) before commit.
- Commit messages use `feat:` / `test:` / `chore:` prefixes. No `Co-Authored-By`.

---

## Task 1: CrUX + HealthScore types

**Files:**
- Modify: `src/lib/types.ts` (append at end)

- [ ] **Step 1: Add the types**

Append to `src/lib/types.ts`:

```typescript
// ─── Core Web Vitals (CrUX) ────────────────────────────────────────────────
export type CwvVerdict = 'good' | 'needs-improvement' | 'poor' | 'unknown'

export interface DeviceCWV {
  lcp_ms: number | null
  inp_ms: number | null
  cls: number | null
  lcp_verdict: CwvVerdict
  inp_verdict: CwvVerdict
  cls_verdict: CwvVerdict
}

export interface CruxResult {
  available: boolean
  desktop: DeviceCWV | null
  mobile: DeviceCWV | null
}

// ─── Health Score ──────────────────────────────────────────────────────────
export interface HealthScore {
  score: number // 0-100
  grade: 'A' | 'B' | 'C' | 'D'
  breakdown: Array<{ dimension: string; subscore: number; weight: number }>
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: tsc exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add CrUX and HealthScore types"
```

---

## Task 2: CrUX module (verdict + parse + fetch)

**Files:**
- Create: `src/lib/crux.ts`
- Create: `src/lib/crux.check.ts`

- [ ] **Step 1: Write the failing self-check**

Create `src/lib/crux.check.ts`:

```typescript
import assert from 'node:assert'
import { lcpVerdict, inpVerdict, clsVerdict, parseCruxRecord } from './crux.js'

// verdict thresholds
assert.equal(lcpVerdict(2400), 'good')
assert.equal(lcpVerdict(3000), 'needs-improvement')
assert.equal(lcpVerdict(5000), 'poor')
assert.equal(lcpVerdict(null), 'unknown')
assert.equal(inpVerdict(150), 'good')
assert.equal(inpVerdict(300), 'needs-improvement')
assert.equal(inpVerdict(700), 'poor')
assert.equal(clsVerdict(0.05), 'good')
assert.equal(clsVerdict(0.2), 'needs-improvement')
assert.equal(clsVerdict(0.4), 'poor')

// parse a CrUX record payload (p75; CLS p75 arrives as a string)
const sample = {
  record: {
    metrics: {
      largest_contentful_paint: { percentiles: { p75: 2100 } },
      interaction_to_next_paint: { percentiles: { p75: 180 } },
      cumulative_layout_shift: { percentiles: { p75: '0.08' } },
    },
  },
}
const d = parseCruxRecord(sample)
assert.equal(d.lcp_ms, 2100)
assert.equal(d.inp_ms, 180)
assert.equal(d.cls, 0.08)
assert.equal(d.lcp_verdict, 'good')
assert.equal(d.cls_verdict, 'good')

console.log('OK')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx src/lib/crux.check.ts`
Expected: FAIL (Cannot find module './crux.js' / export missing).

- [ ] **Step 3: Implement `src/lib/crux.ts`**

```typescript
import type { CruxResult, DeviceCWV, CwvVerdict } from './types.js'

const CRUX_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord'
const METRICS = [
  'largest_contentful_paint',
  'interaction_to_next_paint',
  'cumulative_layout_shift',
]

export function lcpVerdict(ms: number | null): CwvVerdict {
  if (ms == null) return 'unknown'
  return ms < 2500 ? 'good' : ms < 4000 ? 'needs-improvement' : 'poor'
}
export function inpVerdict(ms: number | null): CwvVerdict {
  if (ms == null) return 'unknown'
  return ms < 200 ? 'good' : ms < 600 ? 'needs-improvement' : 'poor'
}
export function clsVerdict(v: number | null): CwvVerdict {
  if (v == null) return 'unknown'
  return v < 0.1 ? 'good' : v < 0.25 ? 'needs-improvement' : 'poor'
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

// Parse one CrUX queryRecord response into a DeviceCWV (uses p75).
export function parseCruxRecord(json: any): DeviceCWV {
  const m = json?.record?.metrics ?? {}
  const lcp = num(m['largest_contentful_paint']?.percentiles?.p75)
  const inp = num(m['interaction_to_next_paint']?.percentiles?.p75)
  const cls = num(m['cumulative_layout_shift']?.percentiles?.p75)
  return {
    lcp_ms: lcp,
    inp_ms: inp,
    cls,
    lcp_verdict: lcpVerdict(lcp),
    inp_verdict: inpVerdict(inp),
    cls_verdict: clsVerdict(cls),
  }
}

async function queryForm(
  origin: string,
  formFactor: 'DESKTOP' | 'PHONE',
  key: string
): Promise<DeviceCWV | null> {
  try {
    const res = await fetch(`${CRUX_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, formFactor, metrics: METRICS }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    return parseCruxRecord(await res.json())
  } catch {
    return null
  }
}

// Origin-level Core Web Vitals, desktop + mobile. null if no key or no data.
export async function fetchCoreWebVitals(domain: string): Promise<CruxResult | null> {
  const key = process.env.CRUX_API_KEY
  if (!key) return null
  const bare = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

  for (const origin of [`https://${bare}`, `https://www.${bare}`]) {
    const [desktop, mobile] = await Promise.all([
      queryForm(origin, 'DESKTOP', key),
      queryForm(origin, 'PHONE', key),
    ])
    if (desktop || mobile) return { available: true, desktop, mobile }
  }
  return { available: false, desktop: null, mobile: null }
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `npx tsx src/lib/crux.check.ts`
Expected: prints `OK`.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/lib/crux.ts src/lib/crux.check.ts
git commit -m "feat: add CrUX Core Web Vitals module with verdict bucketing"
```

---

## Task 3: Competitor denylist

**Files:**
- Create: `src/lib/competitor-denylist.ts`
- Create: `src/lib/competitor-denylist.check.ts`

- [ ] **Step 1: Write the failing self-check**

Create `src/lib/competitor-denylist.check.ts`:

```typescript
import assert from 'node:assert'
import { isDeniedCompetitor } from './competitor-denylist.js'

// horizontal giants blocked anywhere (incl. subdomains)
assert.equal(isDeniedCompetitor('amazon.com'), true)
assert.equal(isDeniedCompetitor('www.reddit.com'), true)
assert.equal(isDeniedCompetitor('en.wikipedia.org'), true)
assert.equal(isDeniedCompetitor('m.youtube.com'), true)
// platforms blocked at root only — keep customer subdomains
assert.equal(isDeniedCompetitor('shopify.com'), true)
assert.equal(isDeniedCompetitor('mystore.myshopify.com'), false)
assert.equal(isDeniedCompetitor('someone.medium.com'), false)
// a real competitor passes through
assert.equal(isDeniedCompetitor('fooddive.com'), false)

console.log('OK')
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx src/lib/competitor-denylist.check.ts`
Expected: FAIL (module/export missing).

- [ ] **Step 3: Implement `src/lib/competitor-denylist.ts`**

```typescript
// Domains that are never useful as "competitors" in AI answers.
const BLOCK_ANYWHERE = new Set([
  'google.com', 'youtube.com', 'amazon.com', 'reddit.com', 'wikipedia.org',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'pinterest.com', 'tiktok.com', 'quora.com', 'yelp.com', 'bing.com',
  'apple.com', 'microsoft.com', 'forbes.com', 'businessinsider.com',
  'nytimes.com', 'theguardian.com', 'wsj.com', 'bloomberg.com', 'cnbc.com',
  'github.com', 'stackoverflow.com', 'gartner.com', 'g2.com', 'capterra.com',
  'trustpilot.com', 'glassdoor.com', 'indeed.com', 'crunchbase.com',
  'ebay.com', 'walmart.com', 'target.com', 'etsy.com', 'aliexpress.com',
])

// Platforms blocked only at their root; customer subdomains are real sites.
const BLOCK_ROOT_ONLY = new Set([
  'shopify.com', 'wix.com', 'squarespace.com', 'wordpress.com', 'medium.com',
  'substack.com', 'blogspot.com', 'godaddy.com', 'weebly.com', 'webflow.io',
  'github.io', 'notion.site', 'hubspot.com', 'wordpress.org',
])

function normalize(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
}

function registrable(host: string): string {
  const parts = host.split('.')
  return parts.length <= 2 ? host : parts.slice(-2).join('.')
}

export function isDeniedCompetitor(domain: string): boolean {
  const host = normalize(domain)
  const root = registrable(host)
  if (BLOCK_ANYWHERE.has(root)) return true
  // root-only: deny exactly the root (and bare www), allow subdomains
  if (BLOCK_ROOT_ONLY.has(host)) return true
  return false
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `npx tsx src/lib/competitor-denylist.check.ts`
Expected: prints `OK`.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/lib/competitor-denylist.ts src/lib/competitor-denylist.check.ts
git commit -m "feat: add competitor denylist for AI-visibility detection"
```

---

## Task 4: OpenAI client

**Files:**
- Modify: `package.json` (add `openai` dependency)
- Create: `src/lib/openai.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install openai@^4`
Expected: `openai` appears under `dependencies` in `package.json`; `node_modules` symlink resolves it (worktree shares the main `node_modules`; if not present, the install adds it).

- [ ] **Step 2: Implement `src/lib/openai.ts`**

```typescript
import OpenAI from 'openai'

export interface RankEntry {
  rank: number
  brand: string
  domain: string
  reason: string
  url: string
}

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return client
}

// Tolerant JSON extraction (handles models that wrap JSON in prose/fences).
function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1)) as T
    throw new Error('Could not parse JSON from model output')
  }
}

// Structured chat completion (no web search) — used for prompt generation.
export async function chatJSON<T>(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  schemaName: string
): Promise<T> {
  const res = await getClient().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
  })
  return parseJsonLoose<T>(res.choices[0]?.message?.content ?? '{}')
}

// Grounded brand discovery via web search — returns a ranked list.
export async function groundedRanking(query: string): Promise<RankEntry[]> {
  const system =
    'Use web search to identify the top ~10 brands or sites a buyer would be recommended today ' +
    "for the query. For each return: brand name, the brand's ROOT domain (no protocol/path), the " +
    'source URL, and a one-sentence reason. Rank purely on relevance and authority. Do not bias ' +
    'toward any particular brand. Respond ONLY with JSON: {"rankings":[{"rank","brand","domain","reason","url"}]}.'
  const res = await getClient().responses.create({
    model: 'gpt-4o',
    tools: [{ type: 'web_search_preview' }],
    input: `${system}\n\nQuery: ${query}`,
  })
  const text = (res as any).output_text ?? ''
  const parsed = parseJsonLoose<{ rankings?: RankEntry[] }>(text)
  return (parsed.rankings ?? []).filter((r) => r && r.domain)
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: tsc exits 0. (No unit test — this module only does network I/O; it is exercised in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/openai.ts
git commit -m "feat: add OpenAI client (grounded ranking + structured chat)"
```

---

## Task 5: AI-visibility tool (aggregation TDD + orchestration)

**Files:**
- Create: `src/tools/ai-visibility.ts`
- Create: `src/tools/ai-visibility.check.ts`

- [ ] **Step 1: Write the failing self-check (pure aggregation)**

Create `src/tools/ai-visibility.check.ts`:

```typescript
import assert from 'node:assert'
import { aggregateVisibility } from './ai-visibility.js'

const perPrompt = [
  { topic: 'Best-Of', query: 'best widgets', appeared: true, position: 2, snippet: 'good',
    competitors: [{ brand: 'Acme', domain: 'acme.com' }, { brand: 'Beta', domain: 'beta.com' }] },
  { topic: 'Alternatives', query: 'widget alternatives', appeared: false, position: null, snippet: null,
    competitors: [{ brand: 'Acme', domain: 'acme.com' }] },
  { topic: 'Pricing', query: 'widget pricing', appeared: true, position: 4, snippet: 'cited',
    competitors: [{ brand: 'Beta', domain: 'beta.com' }] },
]
const r = aggregateVisibility('mybrand.com', 'My Brand', perPrompt)
assert.equal(r.total_queries, 3)
assert.equal(r.ranked_in, 2)
assert.equal(r.brand_visibility_pct, 67) // round(2/3*100)
assert.equal(r.avg_position, 3) // mean(2,4)
assert.equal(r.topic_breakdown.length, 3)
// Acme appears 2x, Beta 2x -> both in competitor list, sorted desc
assert.equal(r.competitor_brands[0].appearances, 2)
assert.equal(r.sample_responses.length, 2) // 2 where appeared
console.log('OK')
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx src/tools/ai-visibility.check.ts`
Expected: FAIL (module/export missing).

- [ ] **Step 3: Implement `src/tools/ai-visibility.ts`**

```typescript
import { chatJSON, groundedRanking, type RankEntry } from '../lib/openai.js'
import { isDeniedCompetitor } from '../lib/competitor-denylist.js'
import { safeFetchText } from '../lib/fetch.js'
import type { AIVisibilityResult } from '../lib/types.js'

interface PromptSpec { topic: string; query: string }
interface PromptResult {
  topic: string
  query: string
  appeared: boolean
  position: number | null
  snippet: string | null
  competitors: Array<{ brand: string; domain: string }>
}

function bareHost(d: string): string {
  return d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
}

// Resolve a domain through redirects to its final host (SSRF-guarded via safeFetchText).
async function resolveHost(domain: string): Promise<string> {
  const host = bareHost(domain)
  try {
    const res = await safeFetchText(`https://${host}`, 6000)
    return res.url ? bareHost(res.url) : host
  } catch {
    return host
  }
}

const PROMPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { topic: { type: 'string' }, query: { type: 'string' } },
        required: ['topic', 'query'],
      },
    },
  },
  required: ['prompts'],
}

export async function generatePrompts(
  brand: string,
  domain: string,
  industry: string,
  count = 7
): Promise<PromptSpec[]> {
  const system =
    'You generate unbiased, category-level questions a POTENTIAL CUSTOMER would type into an AI ' +
    'assistant before they know any vendors. HARD CONSTRAINTS: never include the brand name, the ' +
    "brand's domain, or any specific competitor brand name. Cover diverse buying intents (best-of, " +
    'alternatives, comparison, use-case, pricing, feature, industry-leader). Each item also gets a ' +
    '2-4 word topic label.'
  const user =
    `Brand (DO NOT mention): ${brand} (${domain}). Industry/context: ${industry}. ` +
    `Generate ${count} prompts as JSON {"prompts":[{"topic","query"}]}.`
  const out = await chatJSON<{ prompts: PromptSpec[] }>(system, user, PROMPT_SCHEMA, 'prompts')
  const brandLc = brand.toLowerCase()
  const domainLc = bareHost(domain)
  return (out.prompts ?? [])
    .filter((p) => p.query && !p.query.toLowerCase().includes(brandLc) && !p.query.toLowerCase().includes(domainLc))
    .slice(0, count)
}

// PURE: fold per-prompt results into the report shape.
export function aggregateVisibility(
  domain: string,
  brand: string,
  results: PromptResult[]
): AIVisibilityResult {
  const total = results.length
  const appeared = results.filter((r) => r.appeared)
  const positions = appeared.map((r) => r.position).filter((p): p is number => p != null)
  const avg = positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null

  const compMap = new Map<string, { brand: string; domain: string; appearances: number }>()
  for (const r of results) {
    for (const c of r.competitors) {
      const key = bareHost(c.domain)
      const cur = compMap.get(key) ?? { brand: c.brand, domain: key, appearances: 0 }
      cur.appearances += 1
      compMap.set(key, cur)
    }
  }
  const competitor_brands = [...compMap.values()]
    .sort((a, b) => b.appearances - a.appearances)
    .slice(0, 8)
    .map((c) => ({ ...c, avg_position: null }))

  return {
    domain: bareHost(domain),
    brand_name: brand,
    brand_visibility_pct: total ? Math.round((appeared.length / total) * 100) : 0,
    avg_position: avg,
    ranked_in: appeared.length,
    total_queries: total,
    topic_breakdown: results.map((r) => ({
      topic: r.topic,
      appeared: r.appeared,
      position: r.position,
      query: r.query,
      snippet: r.snippet,
    })),
    competitor_brands,
    sample_responses: appeared.slice(0, 3).map((r) => ({
      query: r.query,
      brand_position: r.position,
      raw_snippet: r.snippet,
    })),
  }
}

async function runPrompt(spec: PromptSpec, domain: string): Promise<PromptResult> {
  try {
    const ranked: RankEntry[] = await groundedRanking(spec.query)
    const resolved = await Promise.all(
      ranked.map(async (r) => ({ ...r, host: await resolveHost(r.domain) }))
    )
    const target = bareHost(domain)
    const me = resolved.find((r) => r.host === target)
    const competitors: Array<{ brand: string; domain: string }> = []
    for (const r of resolved) {
      if (r.host === target || isDeniedCompetitor(r.host)) continue
      competitors.push({ brand: r.brand, domain: r.host })
      if (competitors.length >= 5) break
    }
    return {
      topic: spec.topic,
      query: spec.query,
      appeared: !!me,
      position: me ? me.rank : null,
      snippet: me ? me.reason : null,
      competitors,
    }
  } catch {
    return { topic: spec.topic, query: spec.query, appeared: false, position: null, snippet: null, competitors: [] }
  }
}

// Concurrency-limited map (cap 3).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function fetchAiVisibility(
  domain: string,
  brand: string,
  industry: string
): Promise<AIVisibilityResult> {
  const prompts = await generatePrompts(brand, domain, industry, 7)
  const results = await mapLimit(prompts, 3, (p) => runPrompt(p, domain))
  return aggregateVisibility(domain, brand, results)
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `npx tsx src/tools/ai-visibility.check.ts`
Expected: prints `OK`.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/tools/ai-visibility.ts src/tools/ai-visibility.check.ts
git commit -m "feat: add server-side AI-visibility tool (OpenAI grounded discovery)"
```

---

## Task 6: Health score

**Files:**
- Create: `src/lib/score.ts`
- Create: `src/lib/score.check.ts`

- [ ] **Step 1: Write the failing self-check**

Create `src/lib/score.check.ts`:

```typescript
import assert from 'node:assert'
import { computeHealthScore, onPageScore } from './score.js'
import type { CrawlResult, AhrefsMetrics, CruxResult, AIVisibilityResult } from './types.js'

// on-page: 2 live pages, one with a high-severity issue -> penalty = 3/(2*3)*100 = 50 -> 50
const crawl = {
  pages: [
    { fetch_status: 200, issues: [{ severity: 'error' }] },
    { fetch_status: 200, issues: [] },
  ],
} as unknown as CrawlResult
assert.equal(onPageScore(crawl), 50)

const ahrefs = { domain_rating: 32, organic_keywords: 10, backlinks: 1261 } as AhrefsMetrics
const crux: CruxResult = {
  available: true,
  desktop: { lcp_ms: 2000, inp_ms: 150, cls: 0.05, lcp_verdict: 'good', inp_verdict: 'good', cls_verdict: 'good' },
  mobile: { lcp_ms: 2000, inp_ms: 150, cls: 0.05, lcp_verdict: 'good', inp_verdict: 'good', cls_verdict: 'good' },
}
const ai = { brand_visibility_pct: 29 } as AIVisibilityResult

const full = computeHealthScore({ ahrefs, crawl, crux, ai })
assert.ok(full.score >= 0 && full.score <= 100)
assert.equal(full.breakdown.length, 4) // all dims present
assert.ok(['A', 'B', 'C', 'D'].includes(full.grade))

// renormalization: dropping crux + ai still yields a valid score over 2 dims
const partial = computeHealthScore({ ahrefs, crawl, crux: null, ai: null })
assert.equal(partial.breakdown.length, 2)
assert.ok(partial.score >= 0 && partial.score <= 100)
console.log('OK')
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx src/lib/score.check.ts`
Expected: FAIL (module/export missing).

- [ ] **Step 3: Implement `src/lib/score.ts`**

```typescript
import type { AhrefsMetrics, CrawlResult, CruxResult, AIVisibilityResult, HealthScore, DeviceCWV } from './types.js'

const SEV_WEIGHT: Record<string, number> = { error: 3, warning: 1 }

// 0-100 from crawl issues over live (200) pages. 100 = clean.
export function onPageScore(crawl: CrawlResult): number {
  const live = crawl.pages.filter((p) => p.fetch_status === 200)
  if (!live.length) return 0
  let weight = 0
  for (const p of live) for (const i of p.issues) weight += SEV_WEIGHT[i.severity] ?? 1
  const penalty = Math.min(weight / (live.length * 3), 1) * 100
  return Math.max(0, Math.round(100 - penalty))
}

function authorityScore(a: AhrefsMetrics): number {
  // Blend DR (0-100) with keyword/backlink badges.
  const kw = a.organic_keywords >= 100 ? 88 : a.organic_keywords >= 25 ? 60 : 30
  const bl = a.backlinks >= 500 ? 88 : a.backlinks >= 50 ? 60 : 30
  return Math.round(0.5 * a.domain_rating + 0.25 * kw + 0.25 * bl)
}

function deviceVerdictScore(d: DeviceCWV | null): number | null {
  if (!d) return null
  const verdicts = [d.lcp_verdict, d.inp_verdict, d.cls_verdict].filter((v) => v !== 'unknown')
  if (!verdicts.length) return null
  if (verdicts.some((v) => v === 'poor')) return 30
  if (verdicts.some((v) => v === 'needs-improvement')) return 60
  return 90
}

function performanceScore(crux: CruxResult | null): number | null {
  if (!crux || !crux.available) return null
  const scores = [deviceVerdictScore(crux.desktop), deviceVerdictScore(crux.mobile)].filter(
    (s): s is number => s != null
  )
  if (!scores.length) return null
  return Math.min(...scores) // worst of desktop/mobile
}

function gradeFor(score: number): HealthScore['grade'] {
  return score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D'
}

export function computeHealthScore(input: {
  ahrefs: AhrefsMetrics
  crawl: CrawlResult
  crux: CruxResult | null
  ai: AIVisibilityResult | null
}): HealthScore {
  const dims: Array<{ dimension: string; subscore: number; weight: number }> = [
    { dimension: 'On-page', subscore: onPageScore(input.crawl), weight: 0.35 },
    { dimension: 'Authority', subscore: authorityScore(input.ahrefs), weight: 0.25 },
  ]
  const perf = performanceScore(input.crux)
  if (perf != null) dims.push({ dimension: 'Performance', subscore: perf, weight: 0.2 })
  if (input.ai) dims.push({ dimension: 'AI visibility', subscore: input.ai.brand_visibility_pct, weight: 0.2 })

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0)
  const score = Math.round(dims.reduce((s, d) => s + d.subscore * d.weight, 0) / totalWeight)
  return { score, grade: gradeFor(score), breakdown: dims }
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `npx tsx src/lib/score.check.ts`
Expected: prints `OK`.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/lib/score.ts src/lib/score.check.ts
git commit -m "feat: add composite health score with renormalization"
```

---

## Task 7: Wire tools into `index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports**

At the top of `src/index.ts`, after the existing tool imports, add:

```typescript
import { fetchCoreWebVitals } from './lib/crux.js'
import { fetchAiVisibility } from './tools/ai-visibility.js'
import { inferBrandName } from './lib/infer.js'
```

(`inferBrandName` may already be imported — if so, don't duplicate.)

- [ ] **Step 2: Add CrUX to `fetch_audit_data`**

In the `fetch_audit_data` handler, change the parallel fetch and return. Replace:

```typescript
    const [crawl, ahrefs] = await Promise.all([
      crawlWebsite(rootUrl, 32),
      fetchAhrefsMetrics(domain),
    ])

    const brand_name = inferBrandName(rootUrl, crawl)
    const industry = inferIndustry(crawl)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ crawl, ahrefs, brand_name, industry }),
        },
      ],
    }
```

with:

```typescript
    const [crawl, ahrefs, crux] = await Promise.all([
      crawlWebsite(rootUrl, 32),
      fetchAhrefsMetrics(domain),
      fetchCoreWebVitals(domain),
    ])

    const brand_name = inferBrandName(rootUrl, crawl)
    const industry = inferIndustry(crawl)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ crawl, ahrefs, crux, brand_name, industry }),
        },
      ],
    }
```

- [ ] **Step 3: Register the `fetch_ai_visibility` tool**

After the `fetch_audit_data` tool registration block (before `render_audit_pdf`), add:

```typescript
server.tool(
  'fetch_ai_visibility',
  'Measure how often a brand appears in AI/answer-engine results for unbiased, category-level ' +
  'buyer queries. Generates prompts (brand-name excluded), runs grounded web-search rankings, and ' +
  'returns brand visibility %, average position, per-topic breakdown, and competitor brands. ' +
  'Pass brand and industry from fetch_audit_data when available. Requires OPENAI_API_KEY.',
  {
    url: z.string().url().describe('Full URL to audit'),
    brand: z.string().optional().describe('Brand name (from fetch_audit_data.brand_name)'),
    industry: z.string().optional().describe('Industry/context hint (from fetch_audit_data.industry)'),
  },
  async ({ url, brand, industry }) => {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const brandName = brand ?? domain
    const ind = industry ?? 'general'
    const result = await fetchAiVisibility(domain, brandName, ind)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  }
)
```

- [ ] **Step 4: Add optional `crux` to the `render_audit_pdf` schema**

In the `render_audit_pdf` registration, add to the params object (alongside `ahrefs`, `crawl`, `ai_visibility`, `narratives`):

```typescript
    crux: z.any().optional().describe('The crux object from fetch_audit_data (pass through; optional)'),
```

And update the handler signature + call:

```typescript
  async ({ ahrefs, crawl, ai_visibility, narratives, crux, output_path }) => {
    const pdfPath = await renderAuditPdf(
      ahrefs as AhrefsMetrics,
      crawl as CrawlResult,
      ai_visibility as AIVisibilityResult,
      narratives as ReportNarratives,
      (crux ?? null) as CruxResult | null,
      output_path
    )
```

(Add `CruxResult` to the existing `import type { ... } from './lib/types.js'` line.)

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: tsc exits 0. (Will fail until Task 8 updates `renderAuditPdf`'s signature — that's expected; do Task 8 before committing, or temporarily expect the signature error. Commit after Task 8.)

- [ ] **Step 6: Do NOT commit yet**

`index.ts` references the new `renderAuditPdf(..., crux, ...)` signature, which only exists after Task 8. Leave the changes uncommitted; `index.ts` and `report.ts` are committed together at the end of Task 8 (they must compile as a pair).

---

## Task 8: Report — health chip + CWV card + crux arg

**Files:**
- Modify: `src/lib/report.ts`

- [ ] **Step 1: Update `renderAuditPdf` + `buildHtml` signatures**

Add `CruxResult` and `computeHealthScore` imports at the top of `src/lib/report.ts`:

```typescript
import type { CrawlResult, AhrefsMetrics, AIVisibilityResult, ReportNarratives, ExtractedPage, CruxResult } from './types.js'
import { computeHealthScore } from './score.js'
```

Change `renderAuditPdf` signature to accept `crux` before `outputPath`:

```typescript
export async function renderAuditPdf(
  ahrefs: AhrefsMetrics,
  crawl: CrawlResult,
  ai: AIVisibilityResult,
  narratives: ReportNarratives,
  crux: CruxResult | null,
  outputPath?: string
): Promise<string> {
  const html = buildHtml(ahrefs, crawl, ai, narratives, crux)
  ...
```

Change `buildHtml` signature to accept `crux: CruxResult | null` and compute the score at the top of the function body:

```typescript
function buildHtml(
  ahrefs: AhrefsMetrics,
  crawl: CrawlResult,
  ai: AIVisibilityResult,
  narratives: ReportNarratives,
  crux: CruxResult | null
): string {
  const health = computeHealthScore({ ahrefs, crawl, crux, ai })
  ...
```

- [ ] **Step 2: Add the health chip to Page 1 header**

In the Page 1 `<div class="hd">` block, after the `doc-sub` line, add a score chip:

```typescript
    <div class="doc-sub">Audit target: ${esc(crawl.root_url)} · Generated ${date}</div>
    <span class="health">Health ${health.score}/100 · Grade ${health.grade}</span>
```

Add CSS (near `.doc-sub`):

```css
  .health { display: inline-block; margin-top: 8px; background: #1c2540; color: #fff; font-size: 9pt; font-weight: 700; padding: 3px 12px; border-radius: 14px; }
```

- [ ] **Step 3: Add the Core Web Vitals card to Page 3**

Add this helper above `buildHtml` (cell renderer):

```typescript
function cwvCell(ms: number | null, verdict: string, unit: string): string {
  const cls = verdict === 'good' ? 'b-green' : verdict === 'poor' ? 'b-red' : verdict === 'needs-improvement' ? 'b-amber' : 'b-gray'
  const val = ms == null ? '—' : unit === 'cls' ? ms.toFixed(2) : `${Math.round(ms)}${unit}`
  return `<td><span class="badge ${cls}">${val}</span></td>`
}
```

Add a `.b-amber` badge style next to `.b-red`/`.b-green`:

```css
  .b-amber { background: #fef3cd; color: #91660a; }
```

In Page 3, immediately after the 3-stat `.stats.s3` block and before the `.row.c2`, insert (only when CrUX is available):

```typescript
  ${crux && crux.available ? `<div class="card" style="margin-bottom:11px"><div class="card-title">Core Web Vitals (CrUX field data)</div>
    <table><thead><tr><th>Device</th><th>LCP</th><th>INP</th><th>CLS</th></tr></thead><tbody>
      <tr><td>Desktop</td>${cwvCell(crux.desktop?.lcp_ms ?? null, crux.desktop?.lcp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.desktop?.inp_ms ?? null, crux.desktop?.inp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.desktop?.cls ?? null, crux.desktop?.cls_verdict ?? 'unknown', 'cls')}</tr>
      <tr><td>Mobile</td>${cwvCell(crux.mobile?.lcp_ms ?? null, crux.mobile?.lcp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.mobile?.inp_ms ?? null, crux.mobile?.inp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.mobile?.cls ?? null, crux.mobile?.cls_verdict ?? 'unknown', 'cls')}</tr>
    </tbody></table></div>` : ''}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: tsc exits 0 (Task 7 + Task 8 together compile clean).

- [ ] **Step 5: Commit (Task 7 + Task 8 together)**

```bash
git add src/lib/report.ts src/index.ts
git commit -m "feat: render health score chip and Core Web Vitals card"
```

---

## Task 9: Docs — `.env.example` + `SKILL.md`

**Files:**
- Modify: `.env.example`
- Modify: `SKILL.md` (the skill file at `~/.claude/skills/seo-aeo-audit/SKILL.md` — note: lives outside the repo; update separately and do not commit it to this repo)

- [ ] **Step 1: Update `.env.example`**

Replace contents with:

```
AHREFS_API_KEY=your_ahrefs_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
CRUX_API_KEY=your_google_chrome_ux_report_api_key_here
```

- [ ] **Step 2: Update SKILL.md Step 1 and Step 2**

In `~/.claude/skills/seo-aeo-audit/SKILL.md`:
- Step 1: note that `fetch_audit_data` now also returns `crux` (pass it through to `render_audit_pdf`).
- Step 2: replace the "generate 7 queries + web_search" instructions with: "Call `fetch_ai_visibility(url, brand_name, industry)` (brand_name + industry from Step 1). It returns the complete `ai_visibility` object — use it directly."
- Step 4: add `crux` to the `render_audit_pdf` arguments list.

- [ ] **Step 3: Commit the repo change**

```bash
git add .env.example
git commit -m "chore: document OPENAI_API_KEY and CRUX_API_KEY in .env.example"
```

(SKILL.md is edited in place but not part of this git repo.)

---

## Task 10: End-to-end verification (requires keys)

**Files:** none (manual run)

- [ ] **Step 1: Ensure keys are in the worktree `.env`**

Confirm `.env` contains real `AHREFS_API_KEY`, `OPENAI_API_KEY`, and (optionally) `CRUX_API_KEY`.

- [ ] **Step 2: Run all self-checks**

Run:
```bash
for f in src/lib/crux.check.ts src/lib/competitor-denylist.check.ts src/lib/score.check.ts src/tools/ai-visibility.check.ts; do npx tsx "$f"; done
```
Expected: four `OK` lines.

- [ ] **Step 3: Live smoke test of the pipeline**

Create a temporary `._e2e.mjs` in the worktree root:

```javascript
import { config } from 'dotenv'; config()
const { crawlWebsite } = await import('./dist/tools/crawl.js')
const { fetchAhrefsMetrics } = await import('./dist/tools/ahrefs.js')
const { fetchCoreWebVitals } = await import('./dist/lib/crux.js')
const { fetchAiVisibility } = await import('./dist/tools/ai-visibility.js')
const { inferBrandName, inferIndustry } = await import('./dist/lib/infer.js')
const { renderAuditPdf } = await import('./dist/lib/report.js')
const rootUrl = 'https://www.cpgmatters.com'
const domain = 'cpgmatters.com'
const [crawl, ahrefs, crux] = await Promise.all([crawlWebsite(rootUrl, 32), fetchAhrefsMetrics(domain), fetchCoreWebVitals(domain)])
const brand = inferBrandName(rootUrl, crawl), industry = inferIndustry(crawl)
const ai = await fetchAiVisibility(domain, brand, industry)
console.log('crux available:', !!(crux && crux.available), '| ai visibility %:', ai.brand_visibility_pct, '| ranked_in:', ai.ranked_in, '| competitors:', ai.competitor_brands.length)
// narratives must be supplied by the agent; for the smoke test, reuse any saved narratives file or a minimal stub.
```

Run: `npm run build && node ._e2e.mjs`
Expected: prints a line with a CrUX flag, an AI-visibility %, ranked_in count, and competitor count, with no thrown errors. Delete `._e2e.mjs` after.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "test: end-to-end smoke verification of AI-visibility + CrUX pipeline"
```

---

## Notes for the implementer

- The live MCP process runs from the **main** repo's `dist/`; this worktree is isolated. Nothing here affects the running server until the branch is merged and `/mcp` is reconnected.
- OpenAI calls cost money and take ~10–30s for 7 prompts. Keep the concurrency cap at 3.
- If `web_search_preview` is rejected by the account/SDK version, fall back to `chat.completions` with a search-style prompt — but prefer the Responses API path.
