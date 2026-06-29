import type { CrawlResult } from './types.js'

export function inferBrandName(url: string, crawl: CrawlResult): string {
  // Try Organization schema first
  for (const page of crawl.pages) {
    for (const block of page.jsonld_blocks) {
      const obj = block as Record<string, unknown>
      const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']]
      if (types.some((t) => typeof t === 'string' && /^(Organization|LocalBusiness|Corporation)$/i.test(t))) {
        const name = obj['name']
        if (typeof name === 'string' && name.trim()) return name.trim()
      }
    }
  }

  // Fall back to the homepage title (strip common suffixes like "| Home", "- Official Site")
  const homePage = crawl.pages.find((p) => {
    try {
      return new URL(p.url).pathname === '/' || new URL(p.url).pathname === ''
    } catch {
      return false
    }
  })
  if (homePage?.title) {
    // Split on common separators and prefer the brand segment over generic page
    // labels — titles like "Home | CPG Matters" must not resolve to "Home".
    const segments = homePage.title
      .split(/\s*[|\-–—:·»]\s*/u)
      .map((s) => s.trim())
      .filter(Boolean)
    const generic = /^(home|homepage|welcome|index|about|about us|contact|news|blog|page \d+)$/i
    const branded = segments.filter((s) => !generic.test(s))
    const pick = branded[branded.length - 1] ?? segments[segments.length - 1]
    if (pick) return pick
  }

  // Last resort: capitalize the domain stem
  const host = new URL(url).hostname.replace(/^www\./, '')
  const stem = host.split('.')[0] ?? host
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

export function inferIndustry(crawl: CrawlResult): string {
  // Collect text from titles and H1s across crawled pages to derive a short industry label
  const tokens: string[] = []
  for (const page of crawl.pages.slice(0, 5)) {
    if (page.title) tokens.push(page.title)
    tokens.push(...page.h1_tags)
  }
  // Return the raw corpus — the AI visibility tool's GPT-4o call uses it to
  // infer themes, so we just pass a short comma-joined string as a hint.
  return tokens.join(', ').slice(0, 200) || 'general'
}
