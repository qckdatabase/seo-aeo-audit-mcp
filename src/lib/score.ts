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
  if (input.ai && input.ai.available !== false && input.ai.total_queries > 0)
    dims.push({ dimension: 'AI visibility', subscore: input.ai.brand_visibility_pct, weight: 0.2 })

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0)
  const score = Math.round(dims.reduce((s, d) => s + d.subscore * d.weight, 0) / totalWeight)
  return { score, grade: gradeFor(score), breakdown: dims }
}
