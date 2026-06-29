import { safeFetchText, getDisallowedPaths, isAllowedByRobots, fetchSitemapUrls } from '../lib/fetch.js'
import { extractPage, extractLinks } from '../lib/extract.js'
import type { CrawlResult, ExtractedPage } from '../lib/types.js'

const MAX_PAGES = 40
const PAGE_TIMEOUT_MS = 8000
const CONCURRENCY = 4

// Normalize for dedup: registrable host (drop www), strip trailing slash + hash.
function normalize(u: string): string {
  try {
    const url = new URL(u)
    url.hash = ''
    const host = url.hostname.replace(/^www\./, '')
    const pathPart = url.pathname.replace(/\/$/, '') || '/'
    return `${host}${pathPart}${url.search}`
  } catch {
    return u
  }
}

function sameRegistrableDomain(u: string, domain: string): boolean {
  try {
    return new URL(u).hostname.replace(/^www\./, '') === domain.replace(/^www\./, '')
  } catch {
    return false
  }
}

function errorPage(pageUrl: string, status: number | null, detail: string): ExtractedPage {
  return {
    url: pageUrl,
    fetch_status: status,
    title: null,
    title_length: null,
    meta_description: null,
    meta_description_length: null,
    h1_tags: [],
    h1_count: 0,
    schema_types: [],
    jsonld_blocks: [],
    microdata_detected: false,
    canonical: null,
    issues: [{ type: 'fetch_error', severity: 'error', detail }],
  }
}

export async function crawlWebsite(url: string, maxPages = MAX_PAGES): Promise<CrawlResult> {
  const rootUrl = url.replace(/\/$/, '')
  let domain: string
  try {
    domain = new URL(rootUrl).hostname
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }

  const limit = Math.min(maxPages, MAX_PAGES)
  const disallowed = await getDisallowedPaths(rootUrl)

  // Seed the queue from the sitemap (if any), then BFS-discover via on-page links.
  const sitemapUrls = await fetchSitemapUrls(rootUrl)
  const sitemapSeeds = sitemapUrls.filter(
    (u) => sameRegistrableDomain(u, domain) && isAllowedByRobots(u, disallowed)
  )

  const seen = new Set<string>()
  const queue: string[] = []
  const enqueue = (u: string) => {
    const key = normalize(u)
    if (seen.has(key)) return
    if (!sameRegistrableDomain(u, domain)) return
    if (!isAllowedByRobots(u, disallowed)) return
    seen.add(key)
    queue.push(u)
  }
  enqueue(rootUrl)
  sitemapSeeds.forEach(enqueue)

  let pagesFailed = 0
  const pages: ExtractedPage[] = []

  // Breadth-first: fetch a wave, extract issues + links, enqueue fresh same-domain links.
  while (queue.length && pages.length < limit) {
    const batch: string[] = []
    while (queue.length && batch.length < CONCURRENCY && pages.length + batch.length < limit) {
      batch.push(queue.shift() as string)
    }

    const fetched = await Promise.all(
      batch.map(async (pageUrl): Promise<{ page: ExtractedPage; links: string[] }> => {
        try {
          const res = await safeFetchText(pageUrl, PAGE_TIMEOUT_MS)
          if (!res.text || res.status >= 400) {
            return { page: errorPage(pageUrl, res.status, `HTTP ${res.status}`), links: [] }
          }
          return { page: extractPage(res.url, res.status, res.text), links: extractLinks(res.text, res.url) }
        } catch (err) {
          return { page: errorPage(pageUrl, null, err instanceof Error ? err.message : 'Unknown error'), links: [] }
        }
      })
    )

    for (const { page, links } of fetched) {
      pages.push(page)
      if (page.issues.some((i) => i.type === 'fetch_error')) pagesFailed++
      links.forEach(enqueue)
    }
  }

  const allSchemaTypes = new Set(pages.flatMap((p) => p.schema_types))

  const summary = {
    missing_title: pages.filter((p) => !p.title && p.fetch_status === 200).length,
    missing_meta: pages.filter((p) => !p.meta_description && p.fetch_status === 200).length,
    missing_h1: pages.filter((p) => p.h1_count === 0 && p.fetch_status === 200).length,
    missing_schema: pages.filter((p) => p.schema_types.length === 0 && !p.microdata_detected && p.fetch_status === 200).length,
    has_faq_schema: allSchemaTypes.has('FAQPage'),
    has_article_schema: allSchemaTypes.has('Article') || allSchemaTypes.has('NewsArticle') || allSchemaTypes.has('BlogPosting'),
    has_organization_schema: allSchemaTypes.has('Organization') || allSchemaTypes.has('LocalBusiness'),
    has_breadcrumb_schema: allSchemaTypes.has('BreadcrumbList'),
    has_search_action: pages.some((p) =>
      p.jsonld_blocks.some((b) => {
        const obj = b as Record<string, unknown>
        return obj['potentialAction'] !== undefined
      })
    ),
  }

  return {
    domain,
    root_url: rootUrl,
    pages_crawled: pages.length - pagesFailed,
    pages_failed: pagesFailed,
    sitemap_urls_found: sitemapUrls.length,
    pages,
    summary,
  }
}
