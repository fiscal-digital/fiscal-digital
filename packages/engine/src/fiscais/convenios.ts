import { extractEntities as defaultExtractEntities } from '../skills/extract_entities'
import { saveMemory } from '../skills/save_memory'
import { generateNarrative as defaultGenerateNarrative } from '../skills/generate_narrative'
import { scoreRisk } from '../skills/score_risk'
import { getPublishThresholds } from '../thresholds'
import type { Finding, RiskFactor } from '../types'
import { gazetteKey } from '../utils/pdf_cache'
import {
  LEI_13019_CONVENIO_VALOR_REFERENCIA,
  LEI_13019_REPASSE_RECORRENTE_MINIMO,
} from './legal-constants'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const FISCAL_ID = 'fiscal-convenios'
const ALERTS_TABLE_DEFAULT = 'fiscal-digital-alerts-prod'

// ── Regex de filtro etapa 1 — sem LLM ────────────────────────────────────────
// Convênios e instrumentos congêneres da Lei 13.019/2014.
const TERMO_FOMENTO_RE = /termo\s+de\s+fomento/i
const TERMO_COLABORACAO_RE = /termo\s+de\s+colabora[çc][ãa]o/i
const ACORDO_COOPERACAO_RE = /acordo\s+de\s+coopera[çc][ãa]o/i
const CONVENIO_RE = /conv[êe]nio(?!\s+de\s+coopera[çc][ãa]o\s+t[ée]cnica)/i
const OSC_RE = /\b(OSC|OSCIP|organiza[çc][ãa]o\s+(?:da\s+sociedade\s+civil|social))\b/i
const REPASSE_RE = /repasse|transfer[êe]ncia\s+volunt[áa]ria/i

// ── Regex de evidência de regularidade — quando presentes, NÃO disparam ─────
// Chamamento público é regra geral (Lei 13.019, Art. 24).
const CHAMAMENTO_RE = /chamamento\s+p[úu]blico/i
// Dispensa fundamentada em Art. 29 (urgência, calamidade, etc.).
const DISPENSA_ART29_RE = /art(?:igo)?\.?\s*29[^0-9]|dispensa\s+de\s+chamamento/i
// Inexigibilidade fundamentada em Art. 30 (singularidade do objeto).
const INEXIGIBILIDADE_ART30_RE = /art(?:igo)?\.?\s*30[^0-9]|inexigibilidade\s+de\s+chamamento/i

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Acordo de cooperação não envolve repasse financeiro (Lei 13.019, Art. 2º, VIII-A).
 * Está fora de escopo deste Fiscal — não emite finding por valor.
 */
function isAcordoCooperacaoSemRepasse(excerpt: string): boolean {
  return ACORDO_COOPERACAO_RE.test(excerpt) && !TERMO_FOMENTO_RE.test(excerpt) && !TERMO_COLABORACAO_RE.test(excerpt)
}

/**
 * Detecta evidência textual de chamamento público, dispensa Art. 29 ou
 * inexigibilidade Art. 30. Quando presente, o convênio é considerado regular
 * e não dispara o alerta `convenio_sem_chamamento`.
 */
function temFundamentoRegular(excerpt: string): boolean {
  return (
    CHAMAMENTO_RE.test(excerpt) ||
    DISPENSA_ART29_RE.test(excerpt) ||
    INEXIGIBILIDADE_ART30_RE.test(excerpt)
  )
}

function narrativaConvenioSemChamamento(
  gazetteDate: string,
  valor: number,
  supplier: string | undefined,
  cnpj: string | undefined,
): string {
  const fornecedorTrecho = supplier
    ? `com a OSC ${supplier}${cnpj ? ` (CNPJ ${cnpj})` : ''}`
    : cnpj
      ? `com a OSC de CNPJ ${cnpj}`
      : 'com OSC'
  return (
    `Identificamos convênio publicado em ${formatDate(gazetteDate)} ${fornecedorTrecho} ` +
    `no valor de R$ ${formatBRL(valor)}, acima do limiar de referência de ` +
    `R$ ${formatBRL(LEI_13019_CONVENIO_VALOR_REFERENCIA)}. ` +
    `O documento aponta ausência de chamamento público, dispensa (Art. 29) ou inexigibilidade (Art. 30) ` +
    `expressamente fundamentada (Lei 13.019/2014, Art. 24).`
  )
}

function narrativaRepasseRecorrente(
  cnpj: string,
  qtdRepasses: number,
  somaTotal: number,
): string {
  return (
    `Identificamos ${qtdRepasses} repasses ao mesmo CNPJ ${cnpj} nos últimos 12 meses, ` +
    `totalizando R$ ${formatBRL(somaTotal)}, sem evidência de nova celebração formal de ` +
    `termo de fomento ou colaboração no período. O documento aponta possível continuidade ` +
    `fática de parceria fora do instrumento jurídico (Lei 13.019/2014, Art. 33 e 35).`
  )
}

async function generateNarrativaFinding(
  finding: Finding,
  context: FiscalContext,
  fallbackNarr: string,
): Promise<string> {
  const { riskThreshold } = await getPublishThresholds()
  if (finding.riskScore >= riskThreshold) {
    const genNarr = context.generateNarrative
    if (genNarr) {
      return genNarr(finding)
    }
    const result = await defaultGenerateNarrative.execute({ finding })
    return result.data || fallbackNarr
  }
  return fallbackNarr
}

export const fiscalConvenios: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta convênios (termo de fomento, termo de colaboração) com OSC firmados sem chamamento ' +
    'público, dispensa fundamentada (Art. 29) ou inexigibilidade (Art. 30) — Lei 13.019/2014. ' +
    'Detecta também repasses recorrentes ao mesmo OSC sem renovação contratual formal.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const alertsTable = context.alertsTable ?? ALERTS_TABLE_DEFAULT
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM)
    const relevantExcerpts = gazette.excerpts.filter(
      e =>
        TERMO_FOMENTO_RE.test(e) ||
        TERMO_COLABORACAO_RE.test(e) ||
        ACORDO_COOPERACAO_RE.test(e) ||
        CONVENIO_RE.test(e) ||
        OSC_RE.test(e) ||
        REPASSE_RE.test(e),
    )

    if (relevantExcerpts.length === 0) {
      return []
    }

    const extractFn = context.extractEntities ?? defaultExtractEntities

    for (const excerpt of relevantExcerpts) {
      // Acordo de cooperação puro (sem repasse) está fora de escopo.
      if (isAcordoCooperacaoSemRepasse(excerpt)) {
        continue
      }

      // Etapa 2 — Extração via skill (cached extractor disponível em context)
      const extractResult = await extractFn.execute({
        text: excerpt,
        gazetteUrl: gazette.url,
      })

      const entities = extractResult.data
      const { cnpjs, values, secretaria, supplier } = entities

      const cnpj = cnpjs[0] ?? undefined
      const valor = values[0]

      // Persistência sempre — útil para detecção futura de repasse recorrente,
      // independente de o convênio individual ser irregular ou não.
      // IMPORTANTE: omitir campos null. Atributos indexados em GSI (cnpj, secretaria)
      // rejeitam NULL — devem estar ausentes ou ser String válida (LRN-019).
      if (valor !== undefined) {
        const convenioItem: Record<string, unknown> = {
          fiscalId: FISCAL_ID,
          cityId,
          actType: 'convenio',
          ...(cnpj && { cnpj }),
          ...(secretaria && { secretaria }),
          ...(supplier && { supplier }),
          valor,
          gazetteUrl: gazette.url,
          gazetteDate: gazette.date,
          createdAt: now.toISOString(),
        }

        const convenioPk = `CONVENIO#${gazetteKey(gazette.url) ?? gazette.id}#${cnpj ?? 'NOCNPJ'}#${valor}`

        const saveMemoryFn = context.saveMemory ?? saveMemory
        await saveMemoryFn.execute({
          pk: convenioPk,
          table: alertsTable,
          item: convenioItem,
        })
      }

      const hasAllFields = !!(cnpj && valor && gazette.date)

      // ── Padrão A — Convênio sem chamamento público ─────────────────────────
      // Requer: valor extraído, valor > limiar, sem evidência de fundamento regular.
      if (
        valor !== undefined &&
        valor > LEI_13019_CONVENIO_VALOR_REFERENCIA &&
        !temFundamentoRegular(excerpt)
      ) {
        // Etapa de RiskFactors
        const excessoValue = Math.min(
          100,
          ((valor - LEI_13019_CONVENIO_VALOR_REFERENCIA) / LEI_13019_CONVENIO_VALOR_REFERENCIA) * 100 + 60,
        )

        const fundamentoAusenteValue = 80 // peso forte por ausência de chamamento

        const riskFactors: RiskFactor[] = [
          {
            type: 'excede_referencia',
            weight: 0.4,
            value: excessoValue,
            description:
              `Valor R$ ${formatBRL(valor)} acima do limiar de referência ` +
              `R$ ${formatBRL(LEI_13019_CONVENIO_VALOR_REFERENCIA)} (Lei 13.019/2014)`,
          },
          {
            type: 'ausencia_fundamento',
            weight: 0.4,
            value: fundamentoAusenteValue,
            description: 'Ausência de chamamento público, Art. 29 ou Art. 30 no excerpt',
          },
          {
            type: 'confianca_extracao',
            weight: 0.2,
            value: extractResult.confidence * 100,
            description: 'Confiança da extração de entidades',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data
        const confidence = Math.min(extractResult.confidence, hasAllFields ? 0.9 : 0.65)

        const fallbackNarr = narrativaConvenioSemChamamento(gazette.date, valor, supplier, cnpj)

        const finding: Finding = {
          fiscalId: FISCAL_ID,
          cityId,
          type: 'convenio_sem_chamamento',
          riskScore,
          confidence,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: '',
          legalBasis: 'Lei 13.019/2014, Art. 24',
          ...(cnpj && { cnpj }),
          ...(secretaria && { secretaria }),
          value: valor,
          createdAt: now.toISOString(),
        }

        finding.narrative = await generateNarrativaFinding(finding, context, fallbackNarr)

        findings.push(finding)
      }

      // ── Padrão B — Repasse recorrente ao mesmo OSC ─────────────────────────
      // Requer: CNPJ identificado + queryAlertsByCnpj injetado (DynamoDB GSI).
      if (cnpj && context.queryAlertsByCnpj) {
        const twelveMonthsAgo = new Date(now)
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
        const sinceISO = twelveMonthsAgo.toISOString().slice(0, 10)

        const historico = await context.queryAlertsByCnpj(cnpj, sinceISO)

        // Filtrar por mesma cidade e actType=convenio
        const conveniosHistorico = historico.filter(
          f =>
            f.cityId === cityId &&
            (f as unknown as Record<string, unknown>)['actType'] === 'convenio',
        )

        const totalRepasses = conveniosHistorico.length + 1 // inclui atual

        if (totalRepasses >= LEI_13019_REPASSE_RECORRENTE_MINIMO) {
          const somaHistorico = conveniosHistorico.reduce((s, f) => s + (f.value ?? 0), 0)
          const somaTotal = somaHistorico + (valor ?? 0)

          const riskFactorsRec: RiskFactor[] = [
            {
              type: 'quantidade_repasses',
              weight: 0.5,
              value: Math.min(100, totalRepasses * 25),
              description: `${totalRepasses} repasses ao mesmo CNPJ nos últimos 12 meses`,
            },
            {
              type: 'soma_total',
              weight: 0.3,
              value: Math.min(
                100,
                (somaTotal / LEI_13019_CONVENIO_VALOR_REFERENCIA) * 50 + 30,
              ),
              description: `Soma total R$ ${formatBRL(somaTotal)} ao mesmo CNPJ`,
            },
            {
              type: 'confianca_extracao',
              weight: 0.2,
              value: extractResult.confidence * 100,
              description: 'Confiança da extração de entidades',
            },
          ]

          const scoreRecResult = await scoreRisk.execute({ factors: riskFactorsRec })
          const riskScoreRec = scoreRecResult.data
          const confidenceRec = hasAllFields ? 0.9 : 0.65

          const fallbackRec = narrativaRepasseRecorrente(cnpj, totalRepasses, somaTotal)

          const findingRec: Finding = {
            fiscalId: FISCAL_ID,
            cityId,
            type: 'repasse_recorrente_osc',
            riskScore: riskScoreRec,
            confidence: confidenceRec,
            evidence: [
              {
                source: gazette.url,
                excerpt,
                date: gazette.date,
              },
              ...conveniosHistorico.flatMap(f => f.evidence ?? []),
            ],
            narrative: '',
            legalBasis: 'Lei 13.019/2014, Art. 33 e 35',
            cnpj,
            ...(secretaria && { secretaria }),
            value: somaTotal,
            createdAt: now.toISOString(),
          }

          findingRec.narrative = await generateNarrativaFinding(findingRec, context, fallbackRec)

          findings.push(findingRec)
        }
      }
    }

    return findings
  },
}
