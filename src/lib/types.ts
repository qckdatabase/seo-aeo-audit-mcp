// ─── Crawl ───────────────────────────────────────────────────────────────────

export interface ExtractedPage {
  url: string
  fetch_status: number | null
  title: string | null
  title_length: number | null
  meta_description: string | null
  meta_description_length: number | null
  h1_tags: string[]
  h1_count: number
  schema_types: string[]
  jsonld_blocks: unknown[]
  microdata_detected: boolean
  canonical: string | null
  issues: PageIssue[]
}

export interface PageIssue {
  type: 'missing_title' | 'title_too_long' | 'title_too_short' | 'missing_meta' | 'meta_too_long' |
        'missing_h1' | 'multiple_h1' | 'missing_schema' | 'fetch_error' | 'missing_canonical'
  severity: 'error' | 'warning'
  detail: string
}

export interface CrawlResult {
  domain: string
  root_url: string
  pages_crawled: number
  pages_failed: number
  sitemap_urls_found: number
  pages: ExtractedPage[]
  summary: {
    missing_title: number
    missing_meta: number
    missing_h1: number
    missing_schema: number
    has_faq_schema: boolean
    has_article_schema: boolean
    has_organization_schema: boolean
    has_breadcrumb_schema: boolean
    has_search_action: boolean
  }
}

// ─── Ahrefs ──────────────────────────────────────────────────────────────────

export interface AhrefsMetrics {
  domain: string
  domain_rating: number
  ahrefs_rank: number
  organic_keywords: number
  organic_keywords_top3: number
  organic_traffic: number
  organic_cost: number
  backlinks: number
  referring_domains: number
  all_time_referring_domains: number
  top_keywords: AhrefsKeyword[]
  top_pages: AhrefsPage[]
  top_referring_domains: AhrefsReferringDomain[]
}

export interface AhrefsKeyword {
  keyword: string
  volume: number
  position: number
  traffic: number
  best_url: string
  keyword_difficulty: number
}

export interface AhrefsPage {
  url: string
  traffic: number
  keywords: number
  top_keyword: string
  top_keyword_position: number
}

export interface AhrefsReferringDomain {
  domain: string
  domain_rating: number
  backlinks: number
  is_dofollow: boolean
  is_spam: boolean
}

// ─── AI Visibility ───────────────────────────────────────────────────────────

export interface AIVisibilityResult {
  domain: string
  brand_name: string
  brand_visibility_pct: number
  avg_position: number | null
  ranked_in: number
  total_queries: number
  topic_breakdown: AIVisibilityTopic[]
  competitor_brands: AIVisibilityCompetitor[]
  sample_responses: AIVisibilitySampleResponse[]
}

export interface AIVisibilityTopic {
  topic: string
  appeared: boolean
  position: number | null
  query: string
  snippet: string | null
}

export interface AIVisibilityCompetitor {
  brand: string
  domain: string
  appearances: number
  avg_position: number | null
}

export interface AIVisibilitySampleResponse {
  query: string
  brand_position: number | null
  raw_snippet: string | null
}

// ─── Narratives ───────────────────────────────────────────────────────────────

export interface ReportNarratives {
  executive_readout: string
  highest_impact_gaps: string[]
  priority_plan: { days_0_30: string[]; days_30_60: string[]; days_60_90: string[] }
  content_headline: string
  content_analysis: {
    whats_working: string[]
    limiting_growth: string[]
    content_moves: Array<{ title: string; body: string }>
  }
  technical_headline: string
  technical_aeo_findings: string[]
  technical_fix_list: { indexation: string[]; on_page: string[]; aeo_schema: string[] }
  authority_headline: string
  authority_interpretation: string
  authority_actions: string[]
  roadmap: { month_1: string[]; month_2: string[]; month_3: string[] }
  expected_outcome: string
  data_limitations: string
  aivisibility_headline: string
}
