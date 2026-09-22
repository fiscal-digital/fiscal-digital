import { RateLimiter } from '../utils/rate_limiter'
import { USER_AGENT } from '../utils/user_agent'
import { retryAfterMs, isRetryableStatus, sleep } from '../utils/retry'
import type { Gazette, Skill, SkillResult } from '../types'

// Host da API do Querido Diário. Em 2026-08 a OKFN migrou a API de
// `api.queridodiario.ok.org.br` para `api.queridodiario.org.br`: o host antigo
// passou a responder 404 para todas as cidades (24, 26 e 31/08) e desde 01/09
// nem conecta ("fetch failed"). O collector engolia a falha por cidade e a
// Lambda terminava "ok", então a coleta ficou 3 semanas parada em silêncio.
// `QD_API_URL` permite trocar o host por deploy (canary ou nova migração) sem
// republicar o engine. O host dos PDFs (`data.queridodiario.ok.org.br`) NÃO
// mudou — ver `utils/pdf_cache.ts`.
export const DEFAULT_QD_API_URL = 'https://api.queridodiario.org.br'
export function qdApiUrl(): string {
  return (process.env.QD_API_URL ?? DEFAULT_QD_API_URL).replace(/\/+$/, '')
}
// 60/min e a referencia que o Querido Diario documenta ("bom senso ... para
// manter taxa de requisicao baixa"). Instancia unica do modulo: todas as
// cidades do collector, rodando em paralelo, disputam este mesmo orcamento.
// Ver rate_limiter.ts para por que a versao anterior nao limitava nada.
const limiter = new RateLimiter(60)

/**
 * Uma nova tentativa quando a fonte esta momentaneamente fora (#Querido Diario
 * instavel em 14-15/09/2026: 503 "no available server" e 520 intermitentes).
 *
 * UMA, nao varias: cada retentativa e carga em cima de quem ja esta caido.
 * Sem retry, um 503 transitorio perde a cidade pelo dia inteiro; com uma,
 * recupera a maioria dos casos medidos (9 de 12 requisicoes espacadas
 * passavam durante a instabilidade). A retentativa passa pelo limiter de
 * novo — respeita a taxa como qualquer outra chamada.
 *
 * `Retry-After` e honrado quando vier (segundos ou HTTP-date), com teto para
 * nao segurar a Lambda ate o timeout. Sem o header, espera `backoffMs`.
 */
const DEFAULT_MAX_RETRIES = 1
const DEFAULT_RETRY_BACKOFF_MS = 3_000

// Logica de retentativa compartilhada com validate_cnpj (utils/retry.ts);
// re-exportada aqui para os consumidores e testes que ja importavam deste modulo.
export { retryAfterMs, isRetryableStatus } from '../utils/retry'

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
  /** Texto integral extraído pelo QD (mesmo path do PDF, extensão .txt). */
  txt_url?: string
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

    const url = `${qdApiUrl()}/gazettes?${params}`
    const maxRetries = Number(process.env.QD_MAX_RETRIES ?? DEFAULT_MAX_RETRIES)
    const backoffMs = Number(process.env.QD_RETRY_BACKOFF_MS ?? DEFAULT_RETRY_BACKOFF_MS)

    let body: QDResponse | undefined
    for (let attempt = 0; ; attempt++) {
      await limiter.acquire()

      let res: Response
      try {
        res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } })
      } catch (err) {
        // Falha de rede (DNS, conexao recusada, "fetch failed"): mesma classe
        // transitoria que um 503. Uma retentativa, depois propaga.
        if (attempt < maxRetries) {
          await sleep(backoffMs)
          continue
        }
        throw err
      }

      if (res.ok) {
        body = await res.json() as QDResponse
        break
      }

      if (isRetryableStatus(res.status) && attempt < maxRetries) {
        const header = (res as { headers?: { get(name: string): string | null } }).headers?.get('retry-after')
        await sleep(retryAfterMs(header, backoffMs))
        continue
      }

      throw new Error(`Querido Diário API ${res.status}: ${res.statusText}`)
    }

    const gazettes: Gazette[] = body.gazettes.map(g => ({
      id: `${g.territory_id}#${g.date}#${g.edition ?? '1'}`,
      territory_id: g.territory_id,
      date: g.date,
      url: g.url,
      excerpts: g.excerpts,
      edition: g.edition,
      is_extra: g.is_extra,
      // Omitido quando ausente (nunca null — LRN-20260502-019): a gazette
      // vira item de DynamoDB no collector.
      ...(g.txt_url && { txt_url: g.txt_url }),
    }))

    return {
      data: { gazettes, total: body.total_gazettes },
      source: url,
      confidence: 1.0,
    }
  },
}
