import { scoreRisk } from '../skills/score_risk'
import { cityBucket, populationOf, type CityBucket } from '../cities/populations'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput } from './types'

const FISCAL_ID = 'fiscal-pessoal'

// ─── Regex de filtro etapa 1 ──────────────────────────────────────────────────

const NOMEACAO_RE = /nome(a[çc][ãa]o|ando|ado)|designa[çc][ãa]o|exonera[çc][ãa]o/i
const COMISSAO_RE = /cargo\s+(em\s+)?comiss[ãa]o/i

// ─── Regex de contagem (etapa 3 — pico) ──────────────────────────────────────

const ATO_RE =
  /\b(?:nomeia|nomeando|nomeado|nomeação|designa[çc][ãa]o|designa[çc][oõ]es|exonera[çc][ãa]o|exonera[çc][oõ]es|exonera(?:ndo|do)|cargo\s+(?:em\s+)?comiss[ãa]o)\b/gi

// ─── Regex de rotatividade (etapa 4) ─────────────────────────────────────────

// Detecta "exoneração ... cargo ... nomeação" ou "cargo ... exoneração ... nomeação"
// dentro do mesmo excerpt para um mesmo cargo comissionado com 2+ titulares distintos.
const EXONERACAO_NOMEACAO_PAR_RE =
  /(?:exonera[çc][ãa]o|exonera(?:ndo|do)).*?(?:cargo\s+(?:em\s+)?comiss[ãa]o|[Cc]hegada de).*?(?:nome[ao]|designa[çc][ãa]o)/is

// ─── Janelas eleitorais municipais ───────────────────────────────────────────

interface JanelaEleitoral {
  inicio: string  // YYYY-MM-DD (inclusive)
  fim: string     // YYYY-MM-DD (inclusive)
  eleicao: string // data da eleição (referência)
}

/**
 * Janelas eleitorais municipais: 3 meses antes da eleição (julho–outubro).
 * Hardcoded para eleições de 2024, 2026 e 2028.
 * TODO: parametrizar via config ou DynamoDB quando cobrir mais cidades/estados.
 */
const JANELAS_ELEITORAIS: JanelaEleitoral[] = [
  { inicio: '2024-07-01', fim: '2024-10-06', eleicao: '2024-10-06' },
  { inicio: '2026-07-01', fim: '2026-10-04', eleicao: '2026-10-04' },
  { inicio: '2028-07-01', fim: '2028-10-01', eleicao: '2028-10-01' },
]

function dentroJanelaEleitoral(dateISO: string): JanelaEleitoral | null {
  for (const janela of JANELAS_ELEITORAIS) {
    if (dateISO >= janela.inicio && dateISO <= janela.fim) {
      return janela
    }
  }
  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function contarAtos(excerpt: string): number {
  const matches = excerpt.match(ATO_RE)
  return matches ? matches.length : 0
}

/**
 * Threshold dinâmico de atos por gazette para disparar `pico_nomeacoes`.
 *
 * Calibração 2026-05-06 — auditoria identificou ~50% de ruído em capitais
 * por aplicar o mesmo limiar em SP (11M hab) e Caxias (460k hab). Cidades
 * grandes têm cadência administrativa naturalmente maior; o anômalo
 * absoluto difere por porte.
 *
 * Eleitoral: cap. 10/5/3 (large/medium/small)
 * Fora janela: cap. 20/10/7 (large/medium/small)
 *
 * Cidades small (<100k): limiar baixo porque admin enxuto raramente publica
 * múltiplos atos no mesmo dia — qualquer pico tende a ser sinal real.
 */
function thresholdFor(bucket: CityBucket, isEleitoral: boolean): number {
  if (isEleitoral) {
    if (bucket === 'large')  return 10
    if (bucket === 'medium') return 5
    return 3
  } else {
    if (bucket === 'large')  return 20
    if (bucket === 'medium') return 10
    return 7
  }
}

/**
 * Detecta rotatividade anormal: exoneração + nomeação para cargo comissionado
 * no mesmo excerpt, indicando ao menos 2 pessoas distintas no mesmo cargo.
 *
 * Heurística MVP — opera em excerpt único.
 * TODO: detecção cross-gazette exige schema de personas em DynamoDB (não implementado).
 */
function detectarRotatividadeNoExcerpt(excerpt: string): boolean {
  if (!COMISSAO_RE.test(excerpt)) return false

  // Conta pares exoneração+nomeação no mesmo excerpt
  const exoneracoes = (excerpt.match(/exonera[çc][ãa]o|exonera(?:ndo|do)/gi) ?? []).length
  const nomeacoes = (excerpt.match(/nome[ao]|nomeação|nomeando/gi) ?? []).length

  // Exige ao menos 1 exoneração E 1 nomeação no mesmo excerpt com cargo em comissão
  return exoneracoes >= 1 && nomeacoes >= 1 && EXONERACAO_NOMEACAO_PAR_RE.test(excerpt)
}

// ─── Fiscal de Pessoal ────────────────────────────────────────────────────────

export const fiscalPessoal: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta picos de nomeação em janelas eleitorais (Lei 9.504/97, Art. 73, V) e ' +
    'rotatividade anormal de cargos comissionados (CF, Art. 37, V). ' +
    'MVP opera em excerpt único; histórico cross-gazette requer schema de personas em DynamoDB.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM): descarta excerpts sem termos de pessoal
    const relevantExcerpts = gazette.excerpts.filter(
      e => NOMEACAO_RE.test(e) || COMISSAO_RE.test(e),
    )

    if (relevantExcerpts.length === 0) {
      return []
    }

    // ── Padrão 1: Pico de nomeações (CALIBRAÇÃO: por gazette, não por excerpt) ──
    // Auditoria 2026-05-02 (LRN-019): threshold por excerpt nunca disparava
    // (excerpts são windows de 300 chars; raramente cabem 5 atos).
    // Agora soma todos os excerpts da MESMA gazette antes de testar.
    //
    // Calibração 2026-05-06 — auditoria de 296 findings em prod identificou
    // ~50% ruído (5 atos em capital de 2M hab é cadência administrativa
    // normal). Threshold agora é dinâmico por porte da cidade:
    // small (<100k) / medium (100k-1M) / large (>1M).
    const totalAtos = relevantExcerpts.reduce((sum, e) => sum + contarAtos(e), 0)
    const janela = dentroJanelaEleitoral(gazette.date)
    const emJanela = janela !== null
    const bucket = cityBucket(cityId)

    {
      const countAtos = totalAtos
      const excerpt = relevantExcerpts.join('\n---\n') // representação da gazette inteira para evidence

      const limiar = thresholdFor(bucket, emJanela)
      const dispara = countAtos >= limiar

      if (dispara) {
        // riskScore: janela eleitoral → alto (60–85); fora → informativo (40–59)
        const baseRisco = emJanela ? 70 : 45
        const excesso = Math.min(30, (countAtos - limiar) * 3)
        const riskValue = Math.min(100, baseRisco + excesso)

        const riskFactors: RiskFactor[] = [
          {
            type: 'volume_atos_pessoal',
            weight: 0.6,
            value: riskValue,
            description: `${countAtos} atos de nomeação/exoneração detectados (limiar ${limiar} para porte ${bucket})`,
          },
          {
            type: 'janela_eleitoral',
            weight: 0.4,
            value: emJanela ? 80 : 20,
            description: emJanela
              ? `Gazette em janela eleitoral (eleição ${formatDate(janela!.eleicao)})`
              : 'Gazette fora de janela eleitoral',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data

        const narrativa = emJanela
          ? `Identificamos ${countAtos} atos de nomeação, exoneração e designação de cargos comissionados ` +
            `em gazette de ${formatDate(gazette.date)}, dentro da janela eleitoral municipal ` +
            `(eleição prevista para ${formatDate(janela!.eleicao)}). ` +
            `O documento aponta volume acima do limiar de ${limiar} atos por publicação para uma cidade de porte ${bucket}. ` +
            `Lei 9.504/97, Art. 73, V, veda nomeações para cargos em comissão no período eleitoral, salvo exceções.`
          : `Identificamos ${countAtos} atos de nomeação, exoneração e designação de cargos comissionados ` +
            `em gazette de ${formatDate(gazette.date)}, acima do limiar de ${limiar} atos por publicação para uma cidade de porte ${bucket} fora de período eleitoral. ` +
            `Registro informativo para monitoramento de tendências.`

        const finding: Finding = {
          fiscalId: FISCAL_ID,
          cityId,
          type: 'pico_nomeacoes',
          riskScore,
          confidence: 0.75,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: narrativa,
          legalBasis: 'Lei 9.504/97, Art. 73, V; CF, Art. 37, V',
          createdAt: now.toISOString(),
        }

        findings.push(finding)
      }

    }

    // ── Padrão 2: Rotatividade anormal de cargo comissionado ─────────────────
    // Mantido per-excerpt: detecta exoneração+nomeação no MESMO ato (300 chars).
    for (const excerpt of relevantExcerpts) {
      if (detectarRotatividadeNoExcerpt(excerpt)) {
        const riskFactors: RiskFactor[] = [
          {
            type: 'rotatividade_cargo_comissao',
            weight: 0.7,
            value: 72,
            description: 'Exoneração + nomeação para cargo comissionado no mesmo ato',
          },
          {
            type: 'cargo_comissao_detectado',
            weight: 0.3,
            value: 80,
            description: 'Termo "cargo em comissão" explicitamente presente no excerpt',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data

        const narrativa =
          `Identificamos exoneração e nomeação para cargo comissionado na gazette de ` +
          `${formatDate(gazette.date)}. O documento aponta troca de titular no mesmo ato. ` +
          `Rotatividade elevada em cargos comissionados pode indicar uso político do funcionalismo (CF, Art. 37, V). ` +
          `Análise cross-gazette de histórico completo requer schema de personas (TODO).`

        const finding: Finding = {
          fiscalId: FISCAL_ID,
          cityId,
          type: 'rotatividade_anormal',
          riskScore,
          confidence: 0.70,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: narrativa,
          legalBasis: 'CF, Art. 37, V; Lei 9.504/97, Art. 73, V',
          createdAt: now.toISOString(),
        }

        findings.push(finding)
      }
    }

    return findings
  },
}

