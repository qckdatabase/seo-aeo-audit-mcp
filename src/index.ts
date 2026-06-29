import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Resolve .env relative to this file so the MCP server finds it regardless of CWD.
// In dev (tsx src/index.ts): __dirname = src/ → join(..) = project root
// In prod (node dist/index.js): __dirname = dist/ → join(..) = project root
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { crawlWebsite } from './tools/crawl.js'
import { fetchAhrefsMetrics } from './tools/ahrefs.js'
import { renderAuditPdf } from './lib/report.js'
import { inferBrandName, inferIndustry } from './lib/infer.js'
import type { AhrefsMetrics, CrawlResult, AIVisibilityResult, ReportNarratives, CruxResult } from './lib/types.js'
import { fetchCoreWebVitals } from './lib/crux.js'
import { fetchAiVisibility } from './tools/ai-visibility.js'
import { parseArg } from './lib/parse-arg.js'

const server = new McpServer({
  name: 'seo-aeo-audit',
  version: '2.0.0',
})

// ─── Tool 1: fetch_audit_data ─────────────────────────────────────────────────
// Data gathering only. Claude does all analysis and writing in the conversation.

server.tool(
  'fetch_audit_data',
  'Crawl a website and fetch its Ahrefs SEO metrics. ' +
  'Returns a JSON object with: crawl (pages, issues, schema summary), ahrefs (DR, keywords, traffic, backlinks, top pages, referring domains), ' +
  'brand_name (inferred from schema/title), and industry (inferred from page content). ' +
  'Call this first when auditing a site.',
  {
    url: z.string().url().describe('Full URL to audit, e.g. https://www.example.com'),
  },
  async ({ url }) => {
    const rootUrl = url.replace(/\/$/, '')
    let domain: string
    try {
      domain = new URL(rootUrl).hostname.replace(/^www\./, '')
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }

    const [crawl, ahrefs, crux] = await Promise.all([
      crawlWebsite(rootUrl, 32),
      fetchAhrefsMetrics(domain),
      fetchCoreWebVitals(domain),
    ])

    const brand_name = inferBrandName(rootUrl, crawl)
    const industry = inferIndustry(crawl)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ crawl, ahrefs, crux, brand_name, industry }),
        },
      ],
    }
  }
)

// ─── Tool 2: fetch_ai_visibility ──────────────────────────────────────────────

server.tool(
  'fetch_ai_visibility',
  'Measure how often a brand appears in AI/answer-engine results for unbiased, category-level ' +
  'buyer queries. Generates prompts (brand-name excluded), runs grounded web-search rankings, and ' +
  'returns brand visibility %, average position, per-topic breakdown, and competitor brands. ' +
  'Pass brand and industry from fetch_audit_data when available. Requires OPENAI_API_KEY.',
  {
    url: z.string().url().describe('Full URL to audit'),
    brand: z.string().optional().describe('Brand name (from fetch_audit_data.brand_name)'),
    industry: z.string().optional().describe('Industry/context hint (from fetch_audit_data.industry)'),
  },
  async ({ url, brand, industry }) => {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const brandName = brand ?? domain
    const ind = industry ?? 'general'
    const result = await fetchAiVisibility(domain, brandName, ind)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  }
)

// ─── Tool 3: render_audit_pdf ─────────────────────────────────────────────────
// PDF renderer. Accepts pre-written narratives and AI visibility data from Claude.

const narrativesSchema = z.object({
  executive_readout: z.string()
    .describe('1-2 short paragraphs (separate with a blank line) on overall SEO/AEO health, strengths and critical gaps'),
  highest_impact_gaps: z.array(z.string())
    .describe('4 gaps, each "Label: detail" — the part before the colon is rendered bold'),
  priority_plan: z.object({
    days_0_30: z.array(z.string()).describe('2-4 quick-win actions'),
    days_30_60: z.array(z.string()).describe('2-3 mid-term actions'),
    days_60_90: z.array(z.string()).describe('2-3 longer-term actions'),
  }),
  content_headline: z.string()
    .describe('One insight sentence headline for the Search Demand section, e.g. "Organic visibility is concentrated in a few generic terms"'),
  content_analysis: z.object({
    whats_working: z.array(z.string()).describe('2-3 bullets on what drives current organic performance'),
    limiting_growth: z.array(z.string()).describe('2-3 bullets on the content/keyword gaps limiting growth'),
    content_moves: z.array(z.object({
      title: z.string().describe('Short title, e.g. "Rebuild the news landing page"'),
      body: z.string().describe('1-2 sentence action description'),
    })).describe('3 titled content moves'),
  }),
  technical_headline: z.string()
    .describe('One insight sentence headline for the Technical/AEO section'),
  technical_aeo_findings: z.array(z.string())
    .describe('3-4 findings, each "Lead sentence. detail" — the first sentence is rendered bold'),
  technical_fix_list: z.object({
    indexation: z.array(z.string()).describe('2-3 indexation fixes'),
    on_page: z.array(z.string()).describe('2-3 on-page fixes'),
    aeo_schema: z.array(z.string()).describe('2-3 structured data / schema fixes'),
  }),
  authority_headline: z.string()
    .describe('One insight sentence headline for the Authority section'),
  authority_interpretation: z.string()
    .describe('2-3 sentences interpreting the backlink profile, DR and link quality'),
  authority_actions: z.array(z.string())
    .describe('2-3 link-strategy bullets'),
  roadmap: z.object({
    month_1: z.array(z.string()).describe('2-3 Month 1 deliverables'),
    month_2: z.array(z.string()).describe('2-3 Month 2 deliverables'),
    month_3: z.array(z.string()).describe('2-3 Month 3 deliverables'),
  }),
  expected_outcome: z.string()
    .describe('2-3 sentences on projected improvements if recommendations are implemented'),
  data_limitations: z.string()
    .describe('One sentence on data sources/limitations, e.g. no GSC/GA4 access, audit uses live crawl + Ahrefs'),
  aivisibility_headline: z.string()
    .describe('One insight sentence headline for the AI Visibility section'),
})

const aiVisibilitySchema = z.object({
  domain: z.string().describe('Bare root domain, e.g. example.com'),
  brand_name: z.string(),
  brand_visibility_pct: z.number().int().min(0).max(100)
    .describe('Percentage of queries where brand appeared'),
  avg_position: z.number().nullable()
    .describe('Average rank when brand appeared, or null if never appeared'),
  ranked_in: z.number().int().describe('Number of queries where brand appeared'),
  total_queries: z.number().int().describe('Total queries run (typically 7)'),
  topic_breakdown: z.array(z.object({
    topic: z.string().describe('2-4 word category label'),
    appeared: z.boolean(),
    position: z.number().int().nullable(),
    query: z.string().describe('The exact query used'),
    snippet: z.string().nullable().describe('1-sentence reason the brand was surfaced, or null'),
  })),
  competitor_brands: z.array(z.object({
    brand: z.string(),
    domain: z.string(),
    appearances: z.number().int(),
    avg_position: z.number().nullable(),
  })).describe('Top competitors seen in AI results, sorted by appearances descending'),
  sample_responses: z.array(z.object({
    query: z.string(),
    brand_position: z.number().int().nullable(),
    raw_snippet: z.string().nullable(),
  })).describe('Up to 3 queries where the brand appeared'),
  available: z.boolean().optional().describe('false when AI visibility was not measured (no OPENAI_API_KEY)'),
})

server.tool(
  'render_audit_pdf',
  'Render the completed SEO/AEO audit report as a PDF file. ' +
  'Pass the ahrefs and crawl objects exactly as returned by fetch_audit_data (pass through unchanged), ' +
  'plus the ai_visibility data you gathered via web search ' +
  'and the narratives you wrote based on the data.',
  {
    ahrefs: z.any().describe('The ahrefs object exactly as returned by fetch_audit_data'),
    crawl: z.any().describe('The crawl object exactly as returned by fetch_audit_data'),
    ai_visibility: aiVisibilitySchema.optional(),
    narratives: narrativesSchema,
    crux: z.any().optional().describe('The crux object from fetch_audit_data (pass through; optional)'),
    output_path: z.string().optional()
      .describe('Absolute path for PDF output. Defaults to ~/Desktop/<domain>-seo-audit.pdf'),
  },
  async ({ ahrefs, crawl, ai_visibility, narratives, crux, output_path }) => {
    // z.any() args can arrive as JSON strings over MCP — coerce to objects.
    const ahrefsObj = parseArg<AhrefsMetrics>(ahrefs)
    const crawlObj = parseArg<CrawlResult>(crawl)
    const cruxObj = parseArg<CruxResult | null>(crux) ?? null
    if (!crawlObj || !Array.isArray(crawlObj.pages)) {
      throw new Error('render_audit_pdf: `crawl` must be the full object from fetch_audit_data (with a pages array)')
    }
    const pdfPath = await renderAuditPdf(
      ahrefsObj,
      crawlObj,
      (ai_visibility as AIVisibilityResult | undefined) ?? null,
      narratives as ReportNarratives,
      cruxObj,
      output_path
    )

    return {
      content: [
        {
          type: 'text' as const,
          text: `PDF saved to: ${pdfPath}`,
        },
      ],
    }
  }
)

// ─── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
