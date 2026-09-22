import type { Skill, SkillResult, SupplierProfile } from '../types'
import { USER_AGENT } from '../utils/user_agent'
import { RateLimiter } from '../utils/rate_limiter'
import { retryAfterMs, isRetryableStatus, sleep } from '../utils/retry'

const BRASIL_API = 'https://brasilapi.com.br/api/cnpj/v1'

/**
 * Fair use da BrasilAPI (collectors#10): sem limite numérico público, o pedido
 * é que o volume tenha "natureza de uma pessoa real". Até aqui este cliente
 * não tinha limitador, retentativa nem cache — e um 429 lançava direto no
 * `catch { continue }` silencioso do fiscal-fornecedores, que por isso nunca
 * produziu um achado sequer em produção.
 *
 *  - 60 req/min (1/s), instância única do módulo: todos os excerpts de todas
 *    as gazettes do mesmo container disputam este orçamento.
 *  - UMA retentativa em 429/5xx/rede, honrando Retry-After (teto 30 s),
 *    passando pelo limitador de novo. Mesmo desenho do Querido Diário.
 *  - Memo por CNPJ (TTL 1 h, teto de entradas): o mesmo CNPJ aparece em vários
 *    excerpts do mesmo diário e em diários seguidos; dado cadastral muda
 *    raramente. Falha NÃO é memoizada — um 5xx transitório não pode grudar
 *    por uma hora.
 */
const limiter = new RateLimiter(60)
const DEFAULT_MAX_RETRIES = 1
const DEFAULT_RETRY_BACKOFF_MS = 3_000
const MEMO_TTL_MS = 60 * 60_000
const MEMO_MAX_ENTRIES = 1_000

type CnpjResult = SkillResult<Partial<SupplierProfile>>
const memo = new Map<string, { at: number; promise: Promise<CnpjResult> }>()

/** Reset do memo — uso em tests apenas. */
export function _resetValidateCnpjCacheForTests(): void {
  memo.clear()
}

interface BrasilApiCNPJ {
  cnpj: string
  razao_social: string
  situacao_cadastral: number
  data_inicio_atividade: string
  qsa?: Array<{ nome_socio: string }>
}

function situacaoLabel(code: number): string {
  const labels: Record<number, string> = {
    1: 'nula', 2: 'ativa', 3: 'suspensa', 4: 'inapta', 8: 'baixada',
  }
  return labels[code] ?? 'desconhecida'
}

export interface ValidateCNPJInput {
  cnpj: string
}

export const validateCNPJ: Skill<ValidateCNPJInput, Partial<SupplierProfile>> = {
  name: 'validate_cnpj',
  description: 'Valida CNPJ na Receita Federal via BrasilAPI e retorna dados cadastrais',

  async execute(input: ValidateCNPJInput): Promise<CnpjResult> {
    // Preserva letras (CNPJ alfanumérico — Lei 14.973/2024, vigência 07/2026):
    // remove apenas máscara/espaços e uppercase. NUNCA usar /\D/g aqui — isso
    // descartaria os caracteres alfabéticos e corromperia a URL da consulta.
    const clean = input.cnpj.replace(/[.\-/\s]/g, '').toUpperCase()

    const hit = memo.get(clean)
    if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.promise

    if (memo.size >= MEMO_MAX_ENTRIES) {
      const oldest = memo.keys().next().value
      if (oldest !== undefined) memo.delete(oldest)
    }
    const promise = lookup(input.cnpj, clean)
    memo.set(clean, { at: Date.now(), promise })
    // Falha não fica memoizada: o próximo excerpt tenta de novo.
    promise.catch(() => {
      if (memo.get(clean)?.promise === promise) memo.delete(clean)
    })
    return promise
  },
}

async function lookup(cnpj: string, clean: string): Promise<CnpjResult> {
  const url = `${BRASIL_API}/${clean}`
  const isAlphanumeric = /[A-Z]/.test(clean)
  const maxRetries = Number(process.env.BRASILAPI_MAX_RETRIES ?? DEFAULT_MAX_RETRIES)
  const backoffMs = Number(process.env.BRASILAPI_RETRY_BACKOFF_MS ?? DEFAULT_RETRY_BACKOFF_MS)

  let res: Response | undefined
  for (let attempt = 0; ; attempt++) {
    await limiter.acquire()
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } })
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(backoffMs)
        continue
      }
      throw err
    }
    if (!res.ok && isRetryableStatus(res.status) && attempt < maxRetries) {
      await sleep(retryAfterMs(res.headers?.get?.('retry-after'), backoffMs))
      continue
    }
    break
  }
  if (!res) throw new Error('BrasilAPI CNPJ: sem resposta')

  if (res.status === 404) {
    return {
      data: { cnpj: cnpj, situacaoCadastral: 'nao_encontrado' },
      source: url,
      confidence: 0.9,
    }
  }

  if (!res.ok) {
    // Degradação graciosa para CNPJ alfanumérico: em 19/07/2026, teste
    // empírico contra a BrasilAPI em produção mostrou que o endpoint já
    // aceita a *forma* alfanumérica na rota (retorna 404 not_found, não
    // 400 bad_request, para um CNPJ alfanumérico sintático mas
    // inexistente) — mas não há confirmação de um lookup 200
    // bem-sucedido, porque a RFB só começa a emitir CNPJ alfanumérico
    // real a partir de ~27-31/07/2026. O suporte também não está
    // formalmente fechado: BrasilAPI/BrasilAPI PR #792 (aberto em
    // 13/04/2026, ainda não mergeado nesta data) atualiza só a
    // documentação OpenAPI, e o revisor apontou que a doc está "à
    // frente da implementação" — a API delega a validação ao serviço
    // externo minhareceita.org, que segundo o autor do PR já aceita o
    // formato, mas isso não é garantido em produção pela BrasilAPI.
    // Por isso: um erro não mapeado (não 404) para CNPJ alfanumérico não
    // deve derrubar o Fiscal chamador — retorna confidence baixa + flag
    // `consultaDegradada` em vez de lançar. Para CNPJ numérico legado,
    // mantém o comportamento anterior (lança — fonte confiavelmente
    // suportada há anos).
    if (isAlphanumeric) {
      return {
        data: {
          cnpj: cnpj,
          situacaoCadastral: 'consulta_indisponivel',
          consultaDegradada: true,
        },
        source: url,
        confidence: 0.2,
      }
    }
    throw new Error(`BrasilAPI CNPJ ${res.status}: ${res.statusText}`)
  }

  const body = await res.json() as BrasilApiCNPJ

  return {
    data: {
      cnpj: cnpj,
      razaoSocial: body.razao_social,
      situacaoCadastral: situacaoLabel(body.situacao_cadastral),
      dataAbertura: body.data_inicio_atividade,
      socios: body.qsa?.map(s => s.nome_socio) ?? [],
      sanctions: false,  // preenchido por check_sanctions
    },
    source: url,
    confidence: 1.0,
  }
}
