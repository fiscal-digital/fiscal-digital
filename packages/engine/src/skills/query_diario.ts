import { RateLimiter } from '../utils/rate_limiter'
import type { Gazette, Skill, SkillResult } from '../types'

const QD_API = 'https://api.queridodiario.ok.org.br'
const limiter = new RateLimiter(60)

export interface QueryDiarioInput {
  territory_id: string
  keywords?: string[]
  since?: string   // YYYY-MM-DD
  until?: string   // YYYY-MM-DD
  size?: number
  offset?: number
}

interface QDGazette {
  territory_id: string
  date: string
  url: string
  excerpts: string[]
  edition?: string
  is_extra?: boolean
}

interface QDResponse {
  total_gazettes: number
  gazettes: QDGazette[]
}

export const queryDiario: Skill<QueryDiarioInput, { gazettes: Gazette[]; total: number }> = {
  name: 'query_diario',
  description: 'Busca gazettes na API do Querido Diário por território e palavras-chave',

  async execute(input: QueryDiarioInput): Promise<SkillResult<{ gazettes: Gazette[]; total: number }>> {
    const params = new URLSearchParams({
      territory_ids: input.territory_id,
      size: String(input.size ?? 50),
      offset: String(input.offset ?? 0),
      excerpt_size: '300',
      number_of_excerpts: '5',
    })

    if (input.keywords?.length) params.set('querystring', input.keywords.join(' OR '))
    if (input.since) params.set('published_since', input.since)
    if (input.until) params.set('published_until', input.until)

    await limiter.acquire()

    const url = `${QD_API}/gazettes?${params}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })

    if (!res.ok) {
      throw new Error(`Querido Diário API ${res.status}: ${res.statusText}`)
    }

    const body = await res.json() as QDResponse

    const gazettes: Gazette[] = body.gazettes.map(g => ({
      id: `${g.territory_id}#${g.date}#${g.edition ?? '1'}`,
      territory_id: g.territory_id,
      date: g.date,
      url: g.url,
      excerpts: g.excerpts,
      edition: g.edition,
      is_extra: g.is_extra,
    }))

    return {
      data: { gazettes, total: body.total_gazettes },
      source: url,
      confidence: 1.0,
    }
  },
}
