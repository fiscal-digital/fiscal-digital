import type { Finding } from '../types'

const FISCAL_ID = 'fiscal-geral'

// ── Limiares ─────────────────────────────────────────────────────────────────

/** Mínimo de findings apontando o mesmo CNPJ para gerar meta-finding */
const MIN_FINDINGS_MESMO_CNPJ = 3

/** riskScore base do meta-finding padrao_recorrente */
const PADRAO_RECORRENTE_BASE_SCORE = 90

/** Bônus por finding adicional além do mínimo (cap: 100) */
const PADRAO_RECORRENTE_BONUS_POR_FINDING = 2

// ── Tipos internos ────────────────────────────────────────────────────────────

/** Input do Fiscal Geral: lista de findings já produzidos pelos demais Fiscais */
export interface FiscalGeralInput {
  findings: Finding[]
  cityId: string
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
    const { findings, cityId } = input

    if (findings.length === 0) return []

    const metaFindings: Finding[] = []

    // Agrupa findings por CNPJ (ignora findings sem CNPJ — são tratados individualmente)
    const porCnpj = new Map<string, Finding[]>()
    for (const f of findings) {
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

    return [...findings, ...metaFindings]
  },
}
