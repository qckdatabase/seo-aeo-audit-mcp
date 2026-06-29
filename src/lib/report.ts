import puppeteer from 'puppeteer'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import type { CrawlResult, AhrefsMetrics, AIVisibilityResult, ReportNarratives, ExtractedPage, CruxResult } from './types.js'
import { computeHealthScore } from './score.js'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// "/taxonomy/term/51" from a full URL, so tables read like the sample.
function pathOf(u: string): string {
  try {
    const x = new URL(u)
    return `${x.pathname}${x.search}` || '/'
  } catch {
    return u
  }
}

// Bold the lead-in before the first colon (highest-impact gaps style).
function boldColon(s: string): string {
  const i = s.indexOf(':')
  if (i === -1) return esc(s)
  return `<strong>${esc(s.slice(0, i + 1))}</strong>${esc(s.slice(i + 1))}`
}

// Bold the first sentence (AEO findings style).
function boldSentence(s: string): string {
  const i = s.indexOf('.')
  if (i === -1) return esc(s)
  return `<strong>${esc(s.slice(0, i + 1))}</strong>${esc(s.slice(i + 1))}`
}

function paragraphs(s: string): string {
  return s
    .split(/\n\n+/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join('')
}

function li(items: string[], render: (s: string) => string = esc): string {
  return items.map((x) => `<li>${render(x)}</li>`).join('')
}

// One-line issue summary for the crawl/template findings table.
const ISSUE_LABEL: Record<string, string> = {
  missing_title: 'no title',
  title_too_long: 'title >60',
  title_too_short: 'title <30',
  missing_meta: 'no meta description',
  meta_too_long: 'meta >160',
  missing_h1: 'no H1',
  multiple_h1: 'multiple H1',
  missing_schema: 'no schema',
  missing_canonical: 'no canonical',
}

function issueSummary(page: ExtractedPage): string {
  const err = page.issues.find((i) => i.type === 'fetch_error')
  if (err) return err.detail
  const labels = page.issues.map((i) => ISSUE_LABEL[i.type]).filter(Boolean)
  if (!labels.length) return 'OK'
  return labels.join('; ').replace(/^./, (c) => c.toUpperCase())
}

function cwvCell(ms: number | null, verdict: string, unit: string): string {
  const cls = verdict === 'good' ? 'b-green' : verdict === 'poor' ? 'b-red' : verdict === 'needs-improvement' ? 'b-amber' : 'b-gray'
  const val = ms == null ? '—' : unit === 'cls' ? ms.toFixed(2) : `${Math.round(ms)}${unit}`
  return `<td><span class="badge ${cls}">${val}</span></td>`
}

function buildHtml(
  ahrefs: AhrefsMetrics,
  crawl: CrawlResult,
  ai: AIVisibilityResult,
  narratives: ReportNarratives,
  crux: CruxResult | null
): string {
  const health = computeHealthScore({ ahrefs, crawl, crux, ai })
  const date = new Date().toISOString().slice(0, 10)
  const total = crawl.pages.length
  const metaMissing = crawl.pages.filter((p) => !p.meta_description && p.fetch_status === 200).length
  const h1Missing = crawl.pages.filter((p) => p.h1_count === 0 && p.fetch_status === 200).length
  const schemaMissing = crawl.pages.filter(
    (p) => p.schema_types.length === 0 && !p.microdata_detected && p.fetch_status === 200
  ).length

  const kwRows = (ahrefs.top_keywords ?? [])
    .slice(0, 8)
    .map(
      (k) => `<tr><td>${esc(k.keyword)}</td><td>${fmt(k.volume)}</td><td>${k.position}</td><td>${fmt(
        k.traffic
      )}</td><td class="u">${esc(pathOf(k.best_url))}</td></tr>`
    )
    .join('')

  const pageRows = (ahrefs.top_pages ?? [])
    .slice(0, 8)
    .map(
      (p) => `<tr><td class="u">${esc(pathOf(p.url))}</td><td>${fmt(p.traffic)}</td><td>${p.keywords}</td><td>${esc(
        p.top_keyword || '—'
      )}</td><td>${p.top_keyword_position || '—'}</td></tr>`
    )
    .join('')

  const crawlRows = crawl.pages
    .filter((p) => p.issues.length)
    .slice(0, 12)
    .map(
      (p) => `<tr><td class="u">${esc(pathOf(p.url))}</td><td>${esc(p.title || '—')}</td><td>${esc(
        issueSummary(p)
      )}</td></tr>`
    )
    .join('')

  const refRows = (ahrefs.top_referring_domains ?? [])
    .slice(0, 8)
    .map(
      (r) => `<tr><td>${esc(r.domain)}</td><td>${r.domain_rating}</td><td>${fmt(r.backlinks)}</td><td>${
        r.is_spam ? '<span class="badge b-red">Yes</span>' : '<span class="badge b-gray">No</span>'
      }</td></tr>`
    )
    .join('')

  const topicRows = ai.topic_breakdown
    .map(
      (t) => `<tr><td>${esc(t.topic)}</td><td class="q">${esc(t.query)}</td><td>${
        t.appeared ? '<span class="badge b-green">Yes</span>' : '<span class="badge b-gray">No</span>'
      }</td><td>${t.position ?? '—'}</td></tr>`
    )
    .join('')

  const compRows = ai.competitor_brands
    .map(
      (c) => `<tr><td>${esc(c.brand)}</td><td class="u">${esc(c.domain)}</td><td>${c.appearances}</td><td>${
        c.avg_position !== null ? c.avg_position.toFixed(1) : '—'
      }</td></tr>`
    )
    .join('')

  const sampleBlocks = ai.sample_responses.length
    ? ai.sample_responses
        .map(
          (s) => `<div class="sample"><div class="q">Q: ${esc(s.query)}</div><div class="a">${
            s.brand_position !== null ? `Position ${s.brand_position} — ` : ''
          }${esc(s.raw_snippet ?? '—')}</div></div>`
        )
        .join('')
    : `<p class="muted">No brand mentions surfaced across the ${ai.total_queries} tested queries.</p>`

  const moveCols = narratives.content_analysis.content_moves
    .slice(0, 3)
    .map(
      (m, i) => `<div class="pcol"><div class="ptitle">${i + 1}. ${esc(m.title)}</div><p>${esc(m.body)}</p></div>`
    )
    .join('')

  const neutralFoot = `SEO / AEO audit · ${esc(crawl.domain.replace(/^www\./, ''))} · ${date}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #243049; font-size: 8.6pt; -webkit-print-color-adjust: exact; }
  .page { padding: 22px 38px 34px; page-break-after: always; position: relative; }
  .page:last-child { page-break-after: auto; }

  .eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #5b4bd6; }
  .headline { font-size: 16.5pt; font-weight: 700; color: #1c2540; margin-top: 3px; line-height: 1.12; }
  .doc-title { font-size: 23pt; font-weight: 700; color: #2b3550; margin-top: 2px; }
  .doc-sub { font-size: 8.5pt; color: #7a8294; margin-top: 5px; }
  .health { display: inline-block; margin-top: 8px; background: #1c2540; color: #fff; font-size: 9pt; font-weight: 700; padding: 3px 12px; border-radius: 14px; }
  .hd { margin-bottom: 12px; }

  .stats { display: grid; gap: 11px; margin-bottom: 11px; }
  .stats.s4 { grid-template-columns: repeat(4, 1fr); }
  .stats.s3 { grid-template-columns: repeat(3, 1fr); }
  .stat { border: 1px solid #e6e8ef; border-radius: 9px; padding: 9px 12px; }
  .stat .k { font-size: 7pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a91a0; }
  .stat .v { font-size: 18pt; font-weight: 700; color: #1c2540; line-height: 1.1; margin-top: 2px; }
  .stat .s { font-size: 7.5pt; color: #8a91a0; margin-top: 1px; }

  .row { display: grid; gap: 12px; margin-bottom: 11px; }
  .row.c2 { grid-template-columns: 1fr 1fr; }
  .card { border: 1px solid #e6e8ef; border-radius: 10px; padding: 11px 14px; background: #fff; }
  .card.indigo { border-left: 3px solid #5b4bd6; }
  .card.amber { border-left: 3px solid #e0a008; }
  .card-title { font-size: 11pt; font-weight: 700; color: #1c2540; margin-bottom: 7px; }
  .sub-label { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a91a0; margin: 9px 0 5px; }

  p { line-height: 1.45; color: #36405a; margin-bottom: 6px; font-size: 8.6pt; }
  ul { list-style: none; }
  li { position: relative; padding-left: 12px; margin-bottom: 4px; line-height: 1.4; font-size: 8.3pt; color: #36405a; }
  li::before { content: '•'; position: absolute; left: 0; color: #b9bfcc; }
  .muted { color: #8a91a0; font-size: 8.2pt; }

  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th { text-align: left; color: #8a91a0; font-weight: 700; font-size: 7pt; letter-spacing: 0.05em; text-transform: uppercase; padding: 4px 6px; border-bottom: 1.5px solid #e6e8ef; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f2f6; color: #2b3550; vertical-align: top; }
  td.u { color: #5b4bd6; }
  td.q { color: #5a6072; }

  .badge { display: inline-block; font-size: 7pt; font-weight: 700; padding: 1px 7px; border-radius: 8px; }
  .b-red { background: #fde8e8; color: #b42318; }
  .b-green { background: #e7f6ec; color: #197741; }
  .b-amber { background: #fef3cd; color: #91660a; }
  .b-gray { background: #eef0f3; color: #667085; }

  .plan { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .pcol .range { font-size: 8.5pt; font-weight: 700; color: #5b4bd6; }
  .pcol .ptitle { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #1c2540; margin: 2px 0 6px; }
  .bp-row { display: flex; gap: 26px; margin-bottom: 4px; }
  .bp { }
  .bp .k { font-size: 7pt; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #8a91a0; }
  .bp .v { font-size: 18pt; font-weight: 700; color: #1c2540; line-height: 1.1; }

  .sample { background: #f7f8fb; border-left: 3px solid #5b4bd6; border-radius: 5px; padding: 8px 12px; margin-bottom: 8px; }
  .sample .q { font-size: 8pt; font-weight: 700; color: #5a6072; margin-bottom: 3px; }
  .sample .a { font-size: 8.5pt; color: #2b3550; }

  .foot { position: absolute; left: 38px; right: 38px; bottom: 12px; font-size: 7.3pt; color: #9aa1ad; border-top: 1px solid #eef0f3; padding-top: 6px; }
</style>
</head>
<body>

<!-- Page 1: Executive Summary -->
<div class="page">
  <div class="hd">
    <div class="eyebrow">SEO / AEO Audit</div>
    <div class="doc-title">${esc(ai.brand_name)}</div>
    <div class="doc-sub">Audit target: ${esc(crawl.root_url)} · Generated ${date}</div>
    <span class="health">Health ${health.score}/100 · Grade ${health.grade}</span>
  </div>

  <div class="stats s4">
    <div class="stat"><div class="k">Ahrefs DR</div><div class="v">${ahrefs.domain_rating.toFixed(1)}</div><div class="s">Rank ${fmt(ahrefs.ahrefs_rank)}</div></div>
    <div class="stat"><div class="k">Organic Keywords</div><div class="v">${fmt(ahrefs.organic_keywords)}</div><div class="s">${fmt(ahrefs.organic_keywords_top3)} in positions 1–3</div></div>
    <div class="stat"><div class="k">Est. Organic Traffic</div><div class="v">${fmt(ahrefs.organic_traffic)}</div><div class="s">Ahrefs US estimate</div></div>
    <div class="stat"><div class="k">Live Ref. Domains</div><div class="v">${fmt(ahrefs.referring_domains)}</div><div class="s">${fmt(ahrefs.backlinks)} live backlinks</div></div>
  </div>

  <div class="row c2">
    <div class="card indigo"><div class="card-title">Executive readout</div>${paragraphs(narratives.executive_readout)}</div>
    <div class="card amber"><div class="card-title">Highest-impact gaps</div><ul>${li(narratives.highest_impact_gaps, boldColon)}</ul></div>
  </div>

  <div class="card">
    <div class="card-title">Priority plan</div>
    <div class="plan">
      <div class="pcol"><div class="range">0–30 days</div><div class="ptitle">Technical + SERP basics</div><ul>${li(narratives.priority_plan.days_0_30)}</ul></div>
      <div class="pcol"><div class="range">30–60 days</div><div class="ptitle">AEO foundations</div><ul>${li(narratives.priority_plan.days_30_60)}</ul></div>
      <div class="pcol"><div class="range">60–90 days</div><div class="ptitle">Authority + growth</div><ul>${li(narratives.priority_plan.days_60_90)}</ul></div>
    </div>
  </div>

  <div class="foot">Sources: live crawl of ${total} URLs, robots/sitemap checks, Ahrefs API v3.</div>
</div>

<!-- Page 2: Search Demand + Content Performance -->
<div class="page">
  <div class="hd"><div class="eyebrow">Search Demand + Content Performance</div><div class="headline">${esc(narratives.content_headline)}</div></div>

  <div class="row c2">
    <div class="card"><div class="card-title">Top Ahrefs organic keywords</div>
      <table><thead><tr><th>Keyword</th><th>Vol.</th><th>Pos.</th><th>Traffic</th><th>Best URL</th></tr></thead><tbody>${kwRows}</tbody></table>
    </div>
    <div class="card"><div class="card-title">Top organic pages</div>
      <table><thead><tr><th>URL</th><th>Traffic</th><th>KWs</th><th>Top KW</th><th>Pos.</th></tr></thead><tbody>${pageRows}</tbody></table>
    </div>
  </div>

  <div class="row c2">
    <div class="card indigo"><div class="card-title">What is working</div><ul>${li(narratives.content_analysis.whats_working)}</ul></div>
    <div class="card amber"><div class="card-title">What is limiting growth</div><ul>${li(narratives.content_analysis.limiting_growth)}</ul></div>
  </div>

  <div class="card">
    <div class="card-title">Content moves that should produce the fastest lift</div>
    <div class="plan">${moveCols}</div>
  </div>

  <div class="foot">Ahrefs snapshot: DR ${ahrefs.domain_rating.toFixed(1)}; organic traffic estimate ${fmt(ahrefs.organic_traffic)}; organic cost ${fmt(ahrefs.organic_cost)}.</div>
</div>

<!-- Page 3: Technical SEO + AEO Readiness -->
<div class="page">
  <div class="hd"><div class="eyebrow">Technical SEO + AEO Readiness</div><div class="headline">${esc(narratives.technical_headline)}</div></div>

  <div class="stats s3">
    <div class="stat"><div class="k">Meta descriptions missing</div><div class="v">${metaMissing}/${total}</div><div class="s">across crawled pages</div></div>
    <div class="stat"><div class="k">Pages missing H1</div><div class="v">${h1Missing}/${total}</div><div class="s">across crawled pages</div></div>
    <div class="stat"><div class="k">Pages missing JSON-LD</div><div class="v">${schemaMissing}/${total}</div><div class="s">no structured data</div></div>
  </div>

  ${crux && crux.available ? `<div class="card" style="margin-bottom:11px"><div class="card-title">Core Web Vitals (CrUX field data)</div>
    <table><thead><tr><th>Device</th><th>LCP</th><th>INP</th><th>CLS</th></tr></thead><tbody>
      <tr><td>Desktop</td>${cwvCell(crux.desktop?.lcp_ms ?? null, crux.desktop?.lcp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.desktop?.inp_ms ?? null, crux.desktop?.inp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.desktop?.cls ?? null, crux.desktop?.cls_verdict ?? 'unknown', 'cls')}</tr>
      <tr><td>Mobile</td>${cwvCell(crux.mobile?.lcp_ms ?? null, crux.mobile?.lcp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.mobile?.inp_ms ?? null, crux.mobile?.inp_verdict ?? 'unknown', 'ms')}${cwvCell(crux.mobile?.cls ?? null, crux.mobile?.cls_verdict ?? 'unknown', 'cls')}</tr>
    </tbody></table></div>` : ''}

  <div class="row c2">
    <div class="card"><div class="card-title">Crawl/template findings</div>
      <table><thead><tr><th>URL</th><th>Title</th><th>Issue</th></tr></thead><tbody>${crawlRows}</tbody></table>
    </div>
    <div class="card indigo"><div class="card-title">AEO / AI-search findings</div><ul>${li(narratives.technical_aeo_findings, boldSentence)}</ul></div>
  </div>

  <div class="card">
    <div class="card-title">Technical fix list</div>
    <div class="plan">
      <div class="pcol"><div class="ptitle">Indexation</div><ul>${li(narratives.technical_fix_list.indexation)}</ul></div>
      <div class="pcol"><div class="ptitle">On-page</div><ul>${li(narratives.technical_fix_list.on_page)}</ul></div>
      <div class="pcol"><div class="ptitle">AEO schema</div><ul>${li(narratives.technical_fix_list.aeo_schema)}</ul></div>
    </div>
  </div>

  <div class="foot">Crawl notes: ${crawl.sitemap_urls_found > 0 ? `${crawl.sitemap_urls_found} sitemap URLs found` : 'no XML sitemap found at common URLs'}; ${crawl.pages_failed} of ${total} crawled URLs returned errors.</div>
</div>

<!-- Page 4: Authority + Roadmap -->
<div class="page">
  <div class="hd"><div class="eyebrow">Authority + Roadmap</div><div class="headline">${esc(narratives.authority_headline)}</div></div>

  <div class="row c2">
    <div class="card"><div class="card-title">Backlink profile snapshot</div>
      <div class="bp-row">
        <div class="bp"><div class="k">Live backlinks</div><div class="v">${fmt(ahrefs.backlinks)}</div></div>
        <div class="bp"><div class="k">Live ref domains</div><div class="v">${fmt(ahrefs.referring_domains)}</div></div>
        <div class="bp"><div class="k">All-time ref domains</div><div class="v">${fmt(ahrefs.all_time_referring_domains)}</div></div>
      </div>
      <div class="sub-label">Sample referring domains</div>
      <table><thead><tr><th>Domain</th><th>DR</th><th>Links</th><th>Spam?</th></tr></thead><tbody>${refRows}</tbody></table>
    </div>
    <div class="card indigo"><div class="card-title">Authority interpretation</div>${paragraphs(narratives.authority_interpretation)}<ul>${li(narratives.authority_actions)}</ul></div>
  </div>

  <div class="card">
    <div class="card-title">90-day implementation roadmap</div>
    <div class="plan">
      <div class="pcol"><div class="range">Month 1</div><div class="ptitle">Repair foundations</div><ul>${li(narratives.roadmap.month_1)}</ul></div>
      <div class="pcol"><div class="range">Month 2</div><div class="ptitle">Build AEO assets</div><ul>${li(narratives.roadmap.month_2)}</ul></div>
      <div class="pcol"><div class="range">Month 3</div><div class="ptitle">Grow authority</div><ul>${li(narratives.roadmap.month_3)}</ul></div>
    </div>
  </div>

  <div class="card"><div class="card-title">Expected outcome</div>${paragraphs(narratives.expected_outcome)}<p class="muted">${esc(narratives.data_limitations)}</p></div>

  <div class="foot">${neutralFoot}</div>
</div>

<!-- Page 5: AI Visibility (added) -->
<div class="page">
  <div class="hd"><div class="eyebrow">AI Visibility</div><div class="headline">${esc(narratives.aivisibility_headline)}</div></div>

  <div class="stats s3">
    <div class="stat"><div class="k">Brand visibility</div><div class="v">${ai.brand_visibility_pct}%</div><div class="s">${ai.ranked_in} of ${ai.total_queries} queries</div></div>
    <div class="stat"><div class="k">Avg position</div><div class="v">${ai.avg_position ?? '—'}</div><div class="s">when surfaced</div></div>
    <div class="stat"><div class="k">Queries tested</div><div class="v">${ai.total_queries}</div><div class="s">category buying-intent</div></div>
  </div>

  <div class="row c2">
    <div class="card"><div class="card-title">Query coverage</div>
      <table><thead><tr><th>Topic</th><th>Query</th><th>Appeared</th><th>Pos.</th></tr></thead><tbody>${topicRows}</tbody></table>
    </div>
    <div class="card"><div class="card-title">Competitor brands in AI answers</div>
      <table><thead><tr><th>Brand</th><th>Domain</th><th>Appears</th><th>Avg Pos.</th></tr></thead><tbody>${compRows}</tbody></table>
    </div>
  </div>

  <div class="card"><div class="card-title">Sample AI responses</div>${sampleBlocks}</div>

  <div class="foot">${neutralFoot}</div>
</div>

</body>
</html>`
}

export async function renderAuditPdf(
  ahrefs: AhrefsMetrics,
  crawl: CrawlResult,
  ai: AIVisibilityResult,
  narratives: ReportNarratives,
  crux: CruxResult | null,
  outputPath?: string
): Promise<string> {
  const html = buildHtml(ahrefs, crawl, ai, narratives, crux)

  const resolvedPath =
    outputPath ??
    path.join(os.homedir(), 'Desktop', `${ahrefs.domain.replace(/\./g, '-')}-seo-audit.pdf`)

  const htmlPath = resolvedPath.replace(/\.pdf$/, '.html')
  await fs.writeFile(htmlPath, html, 'utf8')

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' })
    await page.pdf({
      path: resolvedPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    })
  } finally {
    await browser.close()
    await fs.unlink(htmlPath).catch(() => undefined)
  }

  return resolvedPath
}
