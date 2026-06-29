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
