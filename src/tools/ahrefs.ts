import type { AhrefsMetrics, AhrefsKeyword, AhrefsPage, AhrefsReferringDomain } from '../lib/types.js'

const AHREFS_BASE = 'https://api.ahrefs.com/v3'

function getApiKey(): string {
  const key = process.env.AHREFS_API_KEY
  if (!key) throw new Error('AHREFS_API_KEY is not set')
  return key
}

async function ahrefsGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `${AHREFS_BASE}${path}?${qs}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ahrefs API error ${res.status} on ${path}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

// Ahrefs v3 requires a concrete YYYY-MM-DD snapshot date — the literal 'today' is rejected.
function snapshotDate(): string {
  return new Date().toISOString().slice(0, 10)
}

interface DrResponse {
  domain_rating: { domain_rating: number; ahrefs_rank: number }
}

interface MetricsResponse {
  metrics: { org_keywords: number; org_keywords_1_3: number; org_traffic: number; org_cost: number }
}

// Backlink/refdomain totals live on backlinks-stats, not domain-rating.
interface BacklinksStatsResponse {
  metrics: { live: number; live_refdomains: number; all_time_refdomains: number }
}

interface KeywordsResponse {
  keywords: Array<{
    keyword: string
    volume: number | null
    best_position: number
    sum_traffic: number
    best_position_url: string
    keyword_difficulty: number | null
  }>
}

interface TopPagesResponse {
  pages: Array<{
    url: string
    sum_traffic: number | null
    keywords: number
    top_keyword?: string
    top_keyword_best_position?: number
  }>
}

interface RefdomainsResponse {
  refdomains: Array<{
    domain: string
    domain_rating: number | null
    links_to_target: number
    dofollow_links: number
    is_spam: boolean | null
  }>
}

export async function fetchAhrefsMetrics(domain: string): Promise<AhrefsMetrics> {
  const target = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  const date = snapshotDate()

  const [drData, metricsData, backlinksData, keywordsData, pagesData, refData] = await Promise.all([
    ahrefsGet<DrResponse>('/site-explorer/domain-rating', {
      target,
      date,
      output: 'json',
    }),
    ahrefsGet<MetricsResponse>('/site-explorer/metrics', {
      target,
      date,
      mode: 'subdomains',
      output: 'json',
    }),
    ahrefsGet<BacklinksStatsResponse>('/site-explorer/backlinks-stats', {
      target,
      date,
      mode: 'subdomains',
      output: 'json',
    }),
    ahrefsGet<KeywordsResponse>('/site-explorer/organic-keywords', {
      target,
      date,
      mode: 'subdomains',
      limit: '10',
      order_by: 'sum_traffic:desc',
      select: 'keyword,volume,best_position,sum_traffic,best_position_url,keyword_difficulty',
      output: 'json',
    }),
    ahrefsGet<TopPagesResponse>('/site-explorer/top-pages', {
      target,
      date,
      mode: 'subdomains',
      limit: '10',
      order_by: 'sum_traffic:desc',
      select: 'url,sum_traffic,keywords,top_keyword,top_keyword_best_position',
      output: 'json',
    }),
    // Order by links_to_target so high-volume (often low-quality) linkers surface,
    // which is what makes the link-cleanup story legible in the report.
    ahrefsGet<RefdomainsResponse>('/site-explorer/refdomains', {
      target,
      date,
      mode: 'subdomains',
      limit: '12',
      order_by: 'links_to_target:desc',
      select: 'domain,domain_rating,links_to_target,dofollow_links,is_spam',
      output: 'json',
    }),
  ])

  const top_keywords: AhrefsKeyword[] = (keywordsData.keywords ?? []).map((k) => ({
    keyword: k.keyword,
    volume: k.volume ?? 0,
    position: k.best_position,
    traffic: k.sum_traffic,
    best_url: k.best_position_url,
    keyword_difficulty: k.keyword_difficulty ?? 0,
  }))

  const top_pages: AhrefsPage[] = (pagesData.pages ?? []).map((p) => ({
    url: p.url,
    traffic: p.sum_traffic ?? 0,
    keywords: p.keywords,
    top_keyword: p.top_keyword ?? '',
    top_keyword_position: p.top_keyword_best_position ?? 0,
  }))

  const top_referring_domains: AhrefsReferringDomain[] = (refData.refdomains ?? []).map((r) => ({
    domain: r.domain,
    domain_rating: r.domain_rating ?? 0,
    backlinks: r.links_to_target,
    is_dofollow: r.dofollow_links > 0,
    is_spam: r.is_spam === true,
  }))

  return {
    domain: target,
    domain_rating: drData.domain_rating?.domain_rating ?? 0,
    ahrefs_rank: drData.domain_rating?.ahrefs_rank ?? 0,
    organic_keywords: metricsData.metrics?.org_keywords ?? 0,
    organic_keywords_top3: metricsData.metrics?.org_keywords_1_3 ?? 0,
    organic_traffic: metricsData.metrics?.org_traffic ?? 0,
    organic_cost: metricsData.metrics?.org_cost ?? 0,
    backlinks: backlinksData.metrics?.live ?? 0,
    referring_domains: backlinksData.metrics?.live_refdomains ?? 0,
    all_time_referring_domains: backlinksData.metrics?.all_time_refdomains ?? 0,
    top_keywords,
    top_pages,
    top_referring_domains,
  }
}
