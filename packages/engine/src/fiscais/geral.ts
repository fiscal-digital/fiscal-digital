import type { Finding } from '../types'

const FISCAL_ID = 'fiscal-geral'

/** Janela default para histórico cross-gazette (12 meses) */
const HISTORICO_JANELA_MESES = 12

// ── Limiares ─────────────────────────────────────────────────────────────────

/** Mínimo de findings apontando o mesmo CNPJ para gerar meta-finding */
const MIN_FINDINGS_MESMO_CNPJ = 3

/** riskScore base do meta-finding padrao_recorrente */
const PADRAO_RECORRENTE_BASE_SCORE = 90

/** Bônus por finding adicional além do mínimo (cap: 100) */
const PADRAO_RECORRENTE_BONUS_POR_FINDING = 2

// ── Tipos internos ────────────────────────────────────────────────────────────

/**
 * Input do Fiscal Geral: findings da gazette atual + (opcional) função de query
 * para histórico cross-gazette.
 */
export interface FiscalGeralInput {
  findings: Finding[]
  cityId: string
  /**
   * Função opcional para consultar findings históricos por CNPJ.
   * Quando presente, FiscalGeral combina findings atuais + histórico para
   * detectar padrao_recorrente cross-gazette (>= 3 findings em 12 meses).
   * Quando ausente, fallback para detecção local (per-gazette).
   */
  queryAlertsByCnpj?: (cnpj: string, sinceISO: string) => Promise<Finding[]>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function narrativaPadraoRecorrente(
  cnpj: string,
  qtdFindings: number,
  tipos: string[],
): string {
  const tiposStr = [...new Set(tipos)].join(', ')
  return (
    `Identificamos ${qtdFindings} ocorrências distintas relacionadas ao fornecedor CNPJ ${cnpj}: ` +
    `${tiposStr}. O documento aponta padrão recorrente de irregularidades que pode indicar ` +
    `contratações sistemáticas em desconformidade com a Lei 14.133/2021.`
  )
}

function consolidarRiskScore(qtdFindings: number): number {
  const bonus = (qtdFindings - MIN_FINDINGS_MESMO_CNPJ) * PADRAO_RECORRENTE_BONUS_POR_FINDING
  return Math.min(100, PADRAO_RECORRENTE_BASE_SCORE + bonus)
}

// ── Fiscal Geral ──────────────────────────────────────────────────────────────

/**
 * Fiscal Geral — orquestrador.
 *
 * Recebe findings já produzidos pelos Fiscais especializados e:
 *  1. Detecta padrão recorrente: >= 3 findings do mesmo CNPJ (em qualquer secretaria)
 *     → emite meta-finding `padrao_recorrente` com riskScore consolidado >= 90.
 *  2. Caso contrário, devolve os findings sem alteração.
 *
 * NÃO duplica lógica de detecção dos Fiscais especializados.
 * NÃO chama LLM nem AWS — processamento local puro.
 */
export const fiscalGeral = {
  id: FISCAL_ID,
  description:
    'Orquestrador: consolida findings dos Fiscais especializados e detecta padrão ' +
    'recorrente (>= 3 findings do mesmo CNPJ → meta-finding padrao_recorrente, riskScore >= 90).',

  /**
   * Consolida findings recebidos dos Fiscais especializados.
   *
   * @param input - findings e cityId
   * @returns findings originais + eventuais meta-findings padrao_recorrente
   */
  consolidar(input: FiscalGeralInput): Finding[] {
    return this.consolidarSync(input)
  },

  /**
   * Versão síncrona (retrocompatível) — usa apenas findings da gazette atual.
   * Útil para testes e código legado.
   */
  consolidarSync(input: FiscalGeralInput): Finding[] {
    const { findings, cityId } = input
    return this._build(findings, cityId)
  },

  /**
   * Versão async — combina findings atuais + histórico cross-gazette.
   * Use no analyzer Lambda quando `queryAlertsByCnpj` estiver disponível.
   *
   * Auditoria 2026-05-02: detecção local (per-gazette) nunca disparava porque
   * 1 gazette típica gera 0-2 findings, raramente 3+ no mesmo CNPJ.
   * Cross-gazette query expande a janela para 12 meses.
   */
  async consolidarAsync(input: FiscalGeralInput): Promise<Finding[]> {
    const { findings, cityId, queryAlertsByCnpj } = input

    if (!queryAlertsByCnpj) {
      // Sem query function: fallback para versão síncrona
      return this._build(findings, cityId)
    }

    // Coletar todos os CNPJs únicos dos findings atuais
    const cnpjsAtuais = [...new Set(findings.map(f => f.cnpj).filter((c): c is string => !!c))]
    if (cnpjsAtuais.length === 0) return findings

    // Janela 12 meses
    const sinceISO = new Date(Date.now() - HISTORICO_JANELA_MESES * 30 * 86400000).toISOString()

    // Buscar histórico cross-gazette para cada CNPJ presente
    const historicoPorCnpj = new Map<string, Finding[]>()
    for (const cnpj of cnpjsAtuais) {
      try {
        const hist = await queryAlertsByCnpj(cnpj, sinceISO)
        historicoPorCnpj.set(cnpj, hist ?? [])
      } catch {
        historicoPorCnpj.set(cnpj, [])
      }
    }

    // Combinar atuais + histórico (deduplicar por id)
    const combinedById = new Map<string, Finding>()
    for (const f of findings) {
      if (f.id) combinedById.set(f.id, f)
    }
    for (const lista of historicoPorCnpj.values()) {
      for (const f of lista) {
        if (f.id && !combinedById.has(f.id)) combinedById.set(f.id, f)
      }
    }
    const combinedFindings = [...combinedById.values(), ...findings.filter(f => !f.id)]

    return this._build(combinedFindings, cityId, findings)
  },

  /**
   * Internal: constrói meta-findings padrão_recorrente.
   * @param all findings combinados (atuais + histórico, se aplicável)
   * @param cityId cidade
   * @param atuais findings da gazette atual (para evidence — opcional)
   */
  _build(all: Finding[], cityId: string, atuais: Finding[] = all): Finding[] {
    if (all.length === 0) return []

    const metaFindings: Finding[] = []

    // Agrupa findings por CNPJ (ignora findings sem CNPJ — são tratados individualmente)
    const porCnpj = new Map<string, Finding[]>()
    for (const f of all) {
      if (!f.cnpj) continue
      const grupo = porCnpj.get(f.cnpj) ?? []
      grupo.push(f)
      porCnpj.set(f.cnpj, grupo)
    }

    for (const [cnpj, grupo] of porCnpj.entries()) {
      if (grupo.length < MIN_FINDINGS_MESMO_CNPJ) continue

      const riskScore = consolidarRiskScore(grupo.length)
      const tipos = grupo.map(f => f.type)
      const todasEvidencias = grupo.flatMap(f => f.evidence ?? [])
      const confidence = Math.min(...grupo.map(f => f.confidence))

      // Secretaria mais frequente (ou undefined se não houver)
      const secretariaFreq = grupo
        .map(f => f.secretaria)
        .filter((s): s is string => s !== undefined)
        .reduce<Record<string, number>>((acc, s) => {
          acc[s] = (acc[s] ?? 0) + 1
          return acc
        }, {})
      const secretariaTop = Object.keys(secretariaFreq).sort(
        (a, b) => (secretariaFreq[b] ?? 0) - (secretariaFreq[a] ?? 0),
      )[0]

      const metaFinding: Finding = {
        fiscalId: FISCAL_ID,
        cityId,
        type: 'padrao_recorrente',
        riskScore,
        confidence,
        evidence: todasEvidencias,
        narrative: narrativaPadraoRecorrente(cnpj, grupo.length, tipos),
        legalBasis: 'Lei 14.133/2021 (múltiplos artigos — ver findings relacionados)',
        cnpj,
        secretaria: secretariaTop,
        createdAt: new Date().toISOString(),
      }

      metaFindings.push(metaFinding)
    }

    // Retorna findings da gazette atual (preserva contrato) + meta-findings novos
    return [...atuais, ...metaFindings]
  },
}
