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
const ai = { brand_visibility_pct: 29, total_queries: 7, available: true } as AIVisibilityResult

const full = computeHealthScore({ ahrefs, crawl, crux, ai })
assert.ok(full.score >= 0 && full.score <= 100)
assert.equal(full.breakdown.length, 4) // all dims present
assert.ok(['A', 'B', 'C', 'D'].includes(full.grade))

// renormalization: dropping crux + ai still yields a valid score over 2 dims
const partial = computeHealthScore({ ahrefs, crawl, crux: null, ai: null })
assert.equal(partial.breakdown.length, 2)
assert.ok(partial.score >= 0 && partial.score <= 100)

// AI visibility unavailable (no OpenAI key) -> dimension dropped, NOT counted as 0%
const noAi = computeHealthScore({
  ahrefs, crawl, crux,
  ai: { brand_visibility_pct: 0, total_queries: 0, available: false } as AIVisibilityResult,
})
assert.equal(noAi.breakdown.length, 3) // on-page + authority + performance; ai skipped
assert.ok(!noAi.breakdown.some((d) => d.dimension === 'AI visibility'))

console.log('OK')
