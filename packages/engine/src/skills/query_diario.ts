import { RateLimiter } from '../utils/rate_limiter'
import type { Gazette, Skill, SkillResult } from '../types'

const QD_API = 'https://api.queridodiario.ok.org.br'
const USER_AGENT = 'FiscalDigital/0.1.1 (+https://fiscaldigital.org)'
const limiter = new RateLimiter(60)

/**
 * Janela de texto pedida ao Querido Diário por excerpt (#166).
 *
 * O valor 300 era hardcoded e é a raiz de dois gargalos medidos em prod
 * (2026-07-31): dos 595 findings sem CNPJ, **zero** tinha sequer padrão de CNPJ
 * no excerpt; e só 11 de 791 textos traziam rótulo de data de assinatura. Não
 * era falha de extração — o dado ficava fora da janela.
 *
 * A API aceita bem mais (testado: `excerpt_size=4000` devolve 4.015 chars).
 * Ganho medido em 60 gazettes de 5 cidades, 300 → 2000:
 *   texto por gazette  1.498 → 9.321 chars
 *   com CNPJ              23% → 48%
 *   com rótulo de assinatura 8% → 28%
 *
 * ⚠️ Aumentar NÃO é mudança neutra. Os Fiscais contam ocorrências DENTRO do
 * excerpt (`contarAtos` do fiscal-pessoal) e aplicam filtros de exclusão em
 * janelas relativas — os thresholds foram calibrados contra ~300 chars. Canary
 * em 2 cidades mostrou o efeito nos DOIS sentidos: Aparecida 0 → 3 findings,
 * Joinville 1 → 0. Por isso o default permanece 300: subir exige recalibração
 * com amostra estatisticamente significativa (ver #166).
 *
 * Custo NÃO é o impeditivo — medido: a extração (Nova Lite) custa R$ 0,03/mês
 * contra R$ 57/mês da conta. Mesmo 6× de texto é desprezível.
 */
const DEFAULT_EXCERPT_SIZE = '300'
const DEFAULT_NUMBER_OF_EXCERPTS = '5'

export interface QueryDiarioInput {
  territory_id: string
  keywords?: string[]
  since?: string   // YYYY-MM-DD
  until?: string   // YYYY-MM-DD
  /** Janela de texto por excerpt (#166). Default 300 — ver nota acima antes de subir. */
  excerptSize?: number
  /** Quantos excerpts por gazette. Default 5. */
  numberOfExcerpts?: number
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
      // Ordem de precedência: parâmetro da chamada > env > default.
      // O env permite canary por deploy (uma Lambda com valor diferente) sem
      // tocar em código; o parâmetro permite scripts de replay compararem
      // janelas lado a lado.
      excerpt_size: String(input.excerptSize ?? process.env.QD_EXCERPT_SIZE ?? DEFAULT_EXCERPT_SIZE),
      number_of_excerpts: String(
        input.numberOfExcerpts ?? process.env.QD_NUMBER_OF_EXCERPTS ?? DEFAULT_NUMBER_OF_EXCERPTS,
      ),
    })

    if (input.keywords?.length) params.set('querystring', input.keywords.join(' OR '))
    if (input.since) params.set('published_since', input.since)
    if (input.until) params.set('published_until', input.until)

    await limiter.acquire()

    const url = `${QD_API}/gazettes?${params}`
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } })

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
