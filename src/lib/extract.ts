import * as cheerio from 'cheerio'
import type { ExtractedPage, PageIssue } from './types.js'

function cleanText(value: string | undefined | null): string | null {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim()
  return cleaned || null
}

function extractSchemaTypes(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(extractSchemaTypes)
  const obj = value as Record<string, unknown>
  const out: string[] = []
  const type = obj['@type']
  if (typeof type === 'string') out.push(type)
  if (Array.isArray(type)) out.push(...type.filter((t): t is string => typeof t === 'string'))
  const graph = obj['@graph']
  if (graph) out.push(...extractSchemaTypes(graph))
  return out
}

function buildIssues(page: Omit<ExtractedPage, 'issues'>): PageIssue[] {
  const issues: PageIssue[] = []

  if (!page.title) {
    issues.push({ type: 'missing_title', severity: 'error', detail: 'Page has no <title> tag' })
  } else if ((page.title_length ?? 0) > 60) {
    issues.push({ type: 'title_too_long', severity: 'warning', detail: `Title is ${page.title_length} chars (>60)` })
  } else if ((page.title_length ?? 0) < 30) {
    issues.push({ type: 'title_too_short', severity: 'warning', detail: `Title is ${page.title_length} chars (<30)` })
  }

  if (!page.meta_description) {
    issues.push({ type: 'missing_meta', severity: 'error', detail: 'No meta description' })
  } else if ((page.meta_description_length ?? 0) > 160) {
    issues.push({ type: 'meta_too_long', severity: 'warning', detail: `Meta description is ${page.meta_description_length} chars (>160)` })
  }

  if (page.h1_count === 0) {
    issues.push({ type: 'missing_h1', severity: 'error', detail: 'No H1 tag found' })
  } else if (page.h1_count > 1) {
    issues.push({ type: 'multiple_h1', severity: 'warning', detail: `${page.h1_count} H1 tags found (should be 1)` })
  }

  if (page.schema_types.length === 0 && !page.microdata_detected) {
    issues.push({ type: 'missing_schema', severity: 'warning', detail: 'No structured data (JSON-LD or Microdata) detected' })
  }

  if (!page.canonical) {
    issues.push({ type: 'missing_canonical', severity: 'warning', detail: 'No canonical tag found' })
  }

  return issues
}

// Extract same-page resolvable hyperlinks for crawl discovery. Skips fragments,
// non-http schemes, and obvious binary/asset URLs.
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const out = new Set<string>()
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim()
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) return
    try {
      const u = new URL(href, baseUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return
      u.hash = ''
      if (/\.(jpe?g|png|gif|svg|webp|ico|css|js|pdf|zip|gz|mp4|mp3|woff2?|ttf|eot|rss)$/i.test(u.pathname)) return
      out.add(u.toString())
    } catch {
      // ignore malformed URLs
    }
  })
  return [...out]
}

export function extractPage(url: string, status: number, html: string): ExtractedPage {
  const $ = cheerio.load(html)

  const title = cleanText($('title').first().text())
  const metaDescription = cleanText($('meta[name="description" i]').first().attr('content'))
  const h1Tags = $('h1')
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter((t): t is string => !!t)

  const canonical = $('link[rel="canonical" i]').first().attr('href') ?? null

  const jsonldBlocks: unknown[] = []
  const schemaTypes = new Set<string>()

  $('script[type="application/ld+json" i]').each((_, el) => {
    const raw = $(el).contents().text().trim()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      jsonldBlocks.push(parsed)
      extractSchemaTypes(parsed).forEach((t) => schemaTypes.add(t))
    } catch {
      // ignore parse errors
    }
  })

  $('[itemscope][itemtype]').each((_, el) => {
    const itemType = $(el).attr('itemtype')
    if (itemType) {
      const parts = itemType.split('/').filter(Boolean)
      schemaTypes.add(parts[parts.length - 1] ?? itemType)
    }
  })

  const microdataDetected = $('[itemscope]').length > 0

  const base: Omit<ExtractedPage, 'issues'> = {
    url,
    fetch_status: status,
    title,
    title_length: title ? title.length : null,
    meta_description: metaDescription,
    meta_description_length: metaDescription ? metaDescription.length : null,
    h1_tags: h1Tags,
    h1_count: h1Tags.length,
    schema_types: Array.from(schemaTypes),
    jsonld_blocks: jsonldBlocks,
    microdata_detected: microdataDetected,
    canonical: canonical || null,
  }

  return { ...base, issues: buildIssues(base) }
}
