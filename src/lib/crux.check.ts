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
