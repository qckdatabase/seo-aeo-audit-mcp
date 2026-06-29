import assert from 'node:assert'
import { aggregateVisibility } from './ai-visibility.js'

const perPrompt = [
  { topic: 'Best-Of', query: 'best widgets', appeared: true, position: 2, snippet: 'good',
    competitors: [{ brand: 'Acme', domain: 'acme.com', rank: 1 }, { brand: 'Beta', domain: 'beta.com', rank: 2 }] },
  { topic: 'Alternatives', query: 'widget alternatives', appeared: false, position: null, snippet: null,
    competitors: [{ brand: 'Acme', domain: 'acme.com', rank: 3 }] },
  { topic: 'Pricing', query: 'widget pricing', appeared: true, position: 4, snippet: 'cited',
    competitors: [{ brand: 'Beta', domain: 'beta.com', rank: 1 }] },
]
const r = aggregateVisibility('mybrand.com', 'My Brand', perPrompt)
assert.equal(r.total_queries, 3)
assert.equal(r.ranked_in, 2)
assert.equal(r.brand_visibility_pct, 67) // round(2/3*100)
assert.equal(r.avg_position, 3) // mean(2,4)
assert.equal(r.topic_breakdown.length, 3)
// Acme appears 2x, Beta 2x -> both in competitor list, sorted desc
assert.equal(r.competitor_brands[0].appearances, 2)
// Acme ranks: 1 and 3 -> avg 2.0; Beta ranks: 2 and 1 -> avg 1.5
assert.equal(r.competitor_brands.find((c) => c.domain === 'acme.com')?.avg_position, 2)
assert.equal(r.sample_responses.length, 2) // 2 where appeared
console.log('OK')
