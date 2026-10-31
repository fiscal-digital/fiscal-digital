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
  /** Data em que a sanção precisa estar vigente (YYYY-MM-DD) — a data do ato. Default: hoje. */
  referenceDate?: string
}

export interface SanctionRecord {
  type: 'CEIS' | 'CNEP'
  sanction: string
  /** YYYY-MM-DD. A API devolve DD/MM/AAAA; normalizado aqui. */
  startDate?: string
  /** YYYY-MM-DD. Ausente quando a API diz "Sem informação". */
  endDate?: string
  organ?: string
  organUf?: string
  organSphere?: string
  /** `abrangenciaDefinidaDecisaoJudicial`, literal da API. */
  scope?: string
  cguId?: number
}

export interface SanctionResult {
  /** true só se algum registro IMPEDE contratar com o município na data de referência. */
  sanctioned: boolean
  records: SanctionRecord[]
  /** Subconjunto de `records` que sustenta `sanctioned`. */
  blocking: SanctionRecord[]
}

/** Registro cru do Portal da Transparência (CEIS e CNEP têm o mesmo shape). */
export interface CGURecord {
  sancionado?: { nome?: string; codigoFormatado?: string }
  pessoa?: { cnpjFormatado?: string; cpfFormatado?: string }
  tipoSancao?: string | { descricaoResumida?: string; descricaoPortal?: string }
  orgaoSancionador?: string | { nome?: string; siglaUf?: string; esfera?: string }
  dataInicioSancao?: string
  dataFimSancao?: string
  abrangenciaDefinidaDecisaoJudicial?: string
  id?: number
}

/**
 * Datas da API vêm como DD/MM/AAAA, ou "Sem informação" (66 de 150 registros
 * amostrados em 31/10/2026). Comparar o texto cru com YYYY-MM-DD dava
 * "ativa para sempre" a toda sanção com fim nos dias 21–31 e a todo
 * "Sem informação" — foi o que publicou uma multa estadual como impedimento
 * de contratar. ISO é aceito porque registros antigos/fixtures usam.
 */
export function parseCguDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim())
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim())
  return iso ? iso[1] : undefined
}

// Tipos que tiram a empresa de licitações e contratos. Multa, publicação
// extraordinária da decisão, dissolução e interdição de atividades são
// sanções reais, mas não são "impedida de contratar" — que é o que a
// narrativa de `fornecedor_sancionado` afirma.
const TIPO_IMPEDE_CONTRATAR = /impedimento|proibi[çc][ãa]o de contratar|inidoneidade|^suspens[ãa]o$/i

// Única abrangência que alcança qualquer município sem saber qual ente
// sancionou. "No órgão sancionador", "Na Esfera e no Poder…", "Em todos os
// Poderes da Esfera…" e "Sem Informação" ficam de fora: provar que a esfera
// do sancionador é a deste município exigiria um mapeamento que não temos, e
// errar aqui é acusar alguém em público.
const ABRANGENCIA_NACIONAL = /^todas as esferas em todos os poderes$/i

/** O registro impede contratar com um município na data `ref` (YYYY-MM-DD)? */
export function impedeContratar(r: SanctionRecord, ref: string): boolean {
  if (!TIPO_IMPEDE_CONTRATAR.test(r.sanction.trim())) return false
  if (!r.scope || !ABRANGENCIA_NACIONAL.test(r.scope.trim())) return false
  if (r.startDate && r.startDate > ref) return false
  if (r.endDate) return r.endDate >= ref
  // Sem data de fim: vigente só se o próprio tipo diz que não tem prazo.
  return /sem prazo/i.test(r.sanction)
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
  const orgao = typeof item.orgaoSancionador === 'string' ? undefined : item.orgaoSancionador
  const organ = typeof item.orgaoSancionador === 'string' ? item.orgaoSancionador : orgao?.nome
  const startDate = parseCguDate(item.dataInicioSancao)
  const endDate = parseCguDate(item.dataFimSancao)
  return {
    type,
    sanction,
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(organ && { organ }),
    ...(orgao?.siglaUf && { organUf: orgao.siglaUf }),
    ...(orgao?.esfera && { organSphere: orgao.esfera }),
    ...(item.abrangenciaDefinidaDecisaoJudicial && { scope: item.abrangenciaDefinidaDecisaoJudicial }),
    ...(item.id !== undefined && { cguId: item.id }),
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
      return { data: { sanctioned: false, records: [], blocking: [] }, source: CGU_API, confidence: 0.0 }
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

    const ref = input.referenceDate ?? new Date().toISOString().split('T')[0]
    const blocking = records.filter(r => impedeContratar(r, ref))
    if (records.length > 0 && blocking.length === 0) {
      // Rastro para "por que não virou alerta": sanção existe, mas não impede contratar aqui.
      logger.info('sanções encontradas, nenhuma impede contratar com o município', {
        cnpj: clean,
        ref,
        registros: records.map(r => ({ sanction: r.sanction, scope: r.scope, endDate: r.endDate })),
      })
    }

    return {
      data: { sanctioned: blocking.length > 0, records, blocking },
      source: `${CGU_API}/ceis,${CGU_API}/cnep`,
      confidence: 0.95,
    }
  },
}
