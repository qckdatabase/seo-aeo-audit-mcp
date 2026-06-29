const USER_AGENT =
  'Mozilla/5.0 (compatible; SEOAuditBot/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const MAX_REDIRECTS = 10

const CHALLENGE_MARKERS = [
  /<title>\s*just a moment/i,
  /<title>\s*verifying your connection/i,
  /<title>\s*attention required\s*\|\s*cloudflare/i,
  /<title>\s*access denied/i,
  /cf-chl-bypass/i,
  /id=["']challenge-form["']/i,
  /id=["']px-captcha["']/i,
  /<title>\s*checking your browser/i,
]

export function isBlockedHtml(text: string): boolean {
  if (!text) return false
  const head = text.slice(0, 4000)
  return CHALLENGE_MARKERS.some((re) => re.test(head))
}

export async function safeFetchText(
  url: string,
  timeoutMs: number
): Promise<{ status: number; url: string; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let currentUrl = url
    let redirectCount = 0

    while (redirectCount <= MAX_REDIRECTS) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      })

      if (res.status >= 300 && res.status < 400) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new Error(`Too many redirects following: ${url}`)
        }
        const location = res.headers.get('location')
        if (!location) {
          return { status: res.status, url: currentUrl, text: '' }
        }
        currentUrl = new URL(location, currentUrl).toString()
        redirectCount++
        continue
      }

      const text = await res.text()
      if (res.status === 200 && isBlockedHtml(text)) {
        return { status: 403, url: currentUrl, text: '' }
      }
      return { status: res.status, url: currentUrl, text }
    }

    throw new Error(`Too many redirects following: ${url}`)
  } finally {
    clearTimeout(timer)
  }
}

export async function getDisallowedPaths(siteUrl: string): Promise<string[]> {
  try {
    const robots = await safeFetchText(`${siteUrl.replace(/\/$/, '')}/robots.txt`, 5000)
    const disallowed: string[] = []
    let applies = false
    for (const rawLine of robots.text.split('\n')) {
      const line = rawLine.split('#')[0].trim()
      if (!line) continue
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim().toLowerCase()
      const value = line.slice(colonIdx + 1).trim()
      if (key === 'user-agent') {
        applies = value === '*' || /seoauditbot/i.test(value)
      }
      if (applies && key === 'disallow' && value) {
        disallowed.push(value)
      }
    }
    return disallowed
  } catch {
    return []
  }
}

export function isAllowedByRobots(pageUrl: string, disallowedPaths: string[]): boolean {
  if (!disallowedPaths.length) return true
  let path: string
  try {
    path = new URL(pageUrl).pathname
  } catch {
    return false
  }
  return !disallowedPaths.some((rule) => {
    if (rule === '/') return true
    if (rule === '*') return true
    if (rule.endsWith('$')) {
      return path === rule.slice(0, -1)
    }
    return path.startsWith(rule)
  })
}

export async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  const base = siteUrl.replace(/\/$/, '')
  const candidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`]
  const urls: string[] = []

  for (const candidate of candidates) {
    try {
      const res = await safeFetchText(candidate, 8000)
      if (res.status !== 200 || !res.text) continue

      const locMatches = res.text.match(/<loc>(.*?)<\/loc>/g) ?? []
      for (const match of locMatches) {
        const url = match.replace(/<\/?loc>/g, '').trim()
        if (url.endsWith('.xml')) {
          // nested sitemap — fetch it too
          try {
            const nested = await safeFetchText(url, 8000)
            const nestedLocs = nested.text.match(/<loc>(.*?)<\/loc>/g) ?? []
            for (const nloc of nestedLocs) {
              const nurl = nloc.replace(/<\/?loc>/g, '').trim()
              if (!nurl.endsWith('.xml')) urls.push(nurl)
            }
          } catch {
            // ignore nested sitemap failures
          }
        } else {
          urls.push(url)
        }
      }
      if (urls.length) break
    } catch {
      continue
    }
  }

  return [...new Set(urls)]
}
