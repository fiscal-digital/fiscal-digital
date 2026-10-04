import type { Skill, SkillResult } from '../types'
import { createLogger } from '../logger'
import { USER_AGENT } from '../utils/user_agent'

const CGU_API = 'https://api.portaldatransparencia.gov.br/api-de-dados'
const logger = createLogger('check_sanctions')

// Em produção NINGUÉM passa `apiKey` (o contexto do fiscal nem tem o campo),
// então esta skill devolve "não sancionado" para todo CNPJ sem chamar nada, e
// `fornecedor_sancionado` é inalcançável. Era silêncio total. O aviso é uma
// vez por container para não virar ruído por excerpt — mas existe.
let avisouSemApiKey = false

/** Reset do aviso — uso em tests apenas. */
export function _resetCheckSanctionsWarnForTests(): void {
  avisouSemApiKey = false
}

export interface CheckSanctionsInput {
  cnpj: string
  apiKey?: string  // chave-api-dados do Portal da Transparência
}

export interface SanctionRecord {
  type: 'CEIS' | 'CNEP'
  sanction: string
  startDate?: string
  endDate?: string
  organ?: string
}

export interface SanctionResult {
  sanctioned: boolean
  records: SanctionRecord[]
}

/** Registro cru do Portal da Transparência (CEIS e CNEP têm o mesmo shape). */
export interface CGURecord {
  sancionado?: { nome?: string; codigoFormatado?: string }
  pessoa?: { cnpjFormatado?: string; cpfFormatado?: string }
  tipoSancao?: string | { descricaoResumida?: string; descricaoPortal?: string }
  orgaoSancionador?: string | { nome?: string; siglaUf?: string; esfera?: string }
  dataInicioSancao?: string
  dataFimSancao?: string
}

/** CNPJ do sancionado no registro, na mesma normalização do CNPJ consultado. */
export function sancionadoCodigo(item: CGURecord): string {
  const raw = item.sancionado?.codigoFormatado ?? item.pessoa?.cnpjFormatado ?? ''
  return raw.replace(/[.\-/\s]/g, '').toUpperCase()
}

/** `tipoSancao` e `orgaoSancionador` vêm como objeto na API atual; já vieram como string. */
export function normalizeCguRecord(item: CGURecord, type: 'CEIS' | 'CNEP'): SanctionRecord {
  const sanction = typeof item.tipoSancao === 'string'
    ? item.tipoSancao
    : (item.tipoSancao?.descricaoResumida ?? item.tipoSancao?.descricaoPortal ?? '')
  const organ = typeof item.orgaoSancionador === 'string'
    ? item.orgaoSancionador
    : item.orgaoSancionador?.nome
  return {
    type,
    sanction,
    ...(item.dataInicioSancao && { startDate: item.dataInicioSancao }),
    ...(item.dataFimSancao && { endDate: item.dataFimSancao }),
    ...(organ && { organ }),
  }
}

export const checkSanctions: Skill<CheckSanctionsInput, SanctionResult> = {
  name: 'check_sanctions',
  description: 'Verifica se empresa consta no CEIS/CNEP (CGU) — empresas suspensas e multadas',

  async execute(input: CheckSanctionsInput): Promise<SkillResult<SanctionResult>> {
    if (!input.apiKey) {
      if (!avisouSemApiKey) {
        avisouSemApiKey = true
        logger.warn('checkSanctions sem apiKey — sanções CEIS/CNEP NÃO verificadas; fornecedor_sancionado inalcançável até haver chave do Portal da Transparência')
      }
      return { data: { sanctioned: false, records: [] }, source: CGU_API, confidence: 0.0 }
    }

    // Preserva letras (CNPJ alfanumérico — Lei 14.973/2024): remove só
    // máscara/espaços e uppercase. Suporte do Portal da Transparência (CGU)
    // a CNPJ alfanumérico não foi verificado nesta mudança — fora do escopo
    // EVO-024, que cobriu apenas BrasilAPI (`validate_cnpj`). Este fix evita
    // a corrupção do CNPJ antes do envio; não garante que o CEIS/CNEP
    // encontre o registro.
    const clean = input.cnpj.replace(/[.\-/\s]/g, '').toUpperCase()
    const headers = { Accept: 'application/json', 'chave-api-dados': input.apiKey, 'User-Agent': USER_AGENT }

    // `codigoSancionado`, não `cnpjSancionado`: em 03/10/2026 a API ignorava
    // `cnpjSancionado` e devolvia a primeira página do cadastro INTEIRO, o que
    // marcava qualquer CNPJ como sancionado (fiscal-digital#243). Mesmo com o
    // parâmetro certo, nenhum registro é aceito sem o CNPJ do sancionado
    // conferir com o consultado — defesa contra a próxima mudança da API.
    const [ceisRes, cnepRes] = await Promise.allSettled([
      fetch(`${CGU_API}/ceis?codigoSancionado=${clean}&pagina=1`, { headers }),
      fetch(`${CGU_API}/cnep?codigoSancionado=${clean}&pagina=1`, { headers }),
    ])

    const records: SanctionRecord[] = []
    let descartados = 0

    async function collect(res: PromiseSettledResult<Response>, type: 'CEIS' | 'CNEP') {
      if (res.status !== 'fulfilled' || !res.value.ok) return
      const data = await res.value.json() as CGURecord[]
      for (const item of data) {
        if (sancionadoCodigo(item) !== clean) { descartados++; continue }
        records.push(normalizeCguRecord(item, type))
      }
    }

    await Promise.all([collect(ceisRes, 'CEIS'), collect(cnepRes, 'CNEP')])
    if (descartados > 0) {
      logger.warn('CGU devolveu registros de OUTRO sancionado — descartados', { cnpj: clean, descartados })
    }

    const today = new Date().toISOString().split('T')[0]
    const active = records.filter(r => !r.endDate || r.endDate >= today)

    return {
      data: { sanctioned: active.length > 0, records },
      source: `${CGU_API}/ceis,${CGU_API}/cnep`,
      confidence: 0.95,
    }
  },
}
