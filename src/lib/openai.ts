import OpenAI from 'openai'

export interface RankEntry {
  rank: number | null
  brand: string
  domain: string
  reason: string
  url: string
}

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return client
}

// Tolerant JSON extraction (handles models that wrap JSON in prose/fences).
function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1)) as T
    throw new Error('Could not parse JSON from model output')
  }
}

// Structured chat completion (no web search) — used for prompt generation.
export async function chatJSON<T>(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  schemaName: string
): Promise<T> {
  const res = await getClient().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
  })
  return parseJsonLoose<T>(res.choices[0]?.message?.content ?? '{}')
}

// Grounded structured call via web search — returns parsed JSON of type T.
export async function groundedJSON<T>(instruction: string): Promise<T> {
  const res = await getClient().responses.create({
    model: 'gpt-4o',
    tools: [{ type: 'web_search_preview' }],
    input: instruction,
  })
  return parseJsonLoose<T>((res as any).output_text ?? '')
}

// Grounded brand discovery via web search — returns a ranked list.
export async function groundedRanking(query: string): Promise<RankEntry[]> {
  const system =
    'Use web search to identify the top ~10 brands or sites a buyer would be recommended today ' +
    "for the query. For each return: brand name, the brand's ROOT domain (no protocol/path), the " +
    'source URL, and a one-sentence reason. Rank purely on relevance and authority. Do not bias ' +
    'toward any particular brand. Respond ONLY with JSON: {"rankings":[{"rank","brand","domain","reason","url"}]}.'
  const res = await getClient().responses.create({
    model: 'gpt-4o',
    tools: [{ type: 'web_search_preview' }],
    input: `${system}\n\nQuery: ${query}`,
  })
  const text = (res as any).output_text ?? ''
  const parsed = parseJsonLoose<{ rankings?: RankEntry[] }>(text)
  return (parsed.rankings ?? [])
    .filter((r) => r && r.domain)
    .map((r) => ({ ...r, rank: Number((r as any).rank) || null, reason: r.reason ?? '' }))
}
