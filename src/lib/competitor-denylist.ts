// Domains that are never useful as "competitors" in AI answers.
const BLOCK_ANYWHERE = new Set([
  'google.com', 'youtube.com', 'amazon.com', 'reddit.com', 'wikipedia.org',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'pinterest.com', 'tiktok.com', 'quora.com', 'yelp.com', 'bing.com',
  'apple.com', 'microsoft.com', 'forbes.com', 'businessinsider.com',
  'nytimes.com', 'theguardian.com', 'wsj.com', 'bloomberg.com', 'cnbc.com',
  'github.com', 'stackoverflow.com', 'gartner.com', 'g2.com', 'capterra.com',
  'trustpilot.com', 'glassdoor.com', 'indeed.com', 'crunchbase.com',
  'ebay.com', 'walmart.com', 'target.com', 'etsy.com', 'aliexpress.com',
])

// Platforms blocked only at their root; customer subdomains are real sites.
const BLOCK_ROOT_ONLY = new Set([
  'shopify.com', 'wix.com', 'squarespace.com', 'wordpress.com', 'medium.com',
  'substack.com', 'blogspot.com', 'godaddy.com', 'weebly.com', 'webflow.io',
  'github.io', 'notion.site', 'hubspot.com', 'wordpress.org',
])

function normalize(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
}

function registrable(host: string): string {
  const parts = host.split('.')
  return parts.length <= 2 ? host : parts.slice(-2).join('.')
}

export function isDeniedCompetitor(domain: string): boolean {
  const host = normalize(domain)
  const root = registrable(host)
  if (BLOCK_ANYWHERE.has(root)) return true
  // root-only: deny exactly the root (and bare www), allow subdomains
  if (BLOCK_ROOT_ONLY.has(host)) return true
  return false
}
