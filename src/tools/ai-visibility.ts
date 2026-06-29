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
