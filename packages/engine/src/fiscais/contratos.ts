import { extractEntities as defaultExtractEntities } from '../skills/extract_entities'
import { saveMemory } from '../skills/save_memory'
import { generateNarrative as defaultGenerateNarrative } from '../skills/generate_narrative'
import { scoreRisk } from '../skills/score_risk'
import type { Finding, RiskFactor } from '../types'
import {
  LEI_14133_ART_125_LIMITE_GERAL,
  LEI_14133_ART_125_LIMITE_REFORMA,
  LEI_14133_ART_107_VIGENCIA_MAXIMA_ANOS,
} from './legal-constants'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const FISCAL_ID = 'fiscal-contratos'
const ALERTS_TABLE_DEFAULT = 'fiscal-digital-alerts-prod'

// Regex de filtro etapa 1
const ADITIVO_RE = /\b(?:termo\s+)?aditivo(?:\s+n[°º.]?\s*\d+)?/i
const PRORROG_RE = /\bprorroga[çc][ãa]o(?:\s+contratual)?/i
const ART_125_RE = /art(?:igo)?\.?\s*125/i
const ART_107_RE = /art(?:igo)?\.?\s*107/i

// Regex para classificação reforma (Art. 125 §1º II)
const REFORMA_RE = /reforma|edif[íi]cio|equipamento/i

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/** Retorna true se o aditivo for de reforma de edifício ou equipamento (inciso II do Art. 125 §1º) */
function isReformaEdificio(excerpt: string, subtype?: string | null): boolean {
  if (subtype === 'obra_engenharia' && REFORMA_RE.test(excerpt)) return true
  return false
}

function narrativaAditivo(
  gazetteDate: string,
  valorAditivo: number,
  valorOriginal: number,
  ratioPercent: number,
  limitePercent: number,
  inciso: 'I' | 'II',
): string {
  return (
    `Identificamos aditivo publicado em ${formatDate(gazetteDate)} no valor de ` +
    `R$ ${formatBRL(valorAditivo)} (${ratioPercent.toFixed(1)}% do contrato original de ` +
    `R$ ${formatBRL(valorOriginal)}), acima do limite legal de ${limitePercent}% ` +
    `(Lei 14.133/2021, Art. 125, §1º, ${inciso}).`
  )
}

function narrativaProrrogacao(
  gazetteDate: string,
  vigenciaInicialDate: string,
): string {
  return (
    `Identificamos prorrogação publicada em ${formatDate(gazetteDate)} de contrato ` +
    `firmado em ${formatDate(vigenciaInicialDate)}, ultrapassando o limite decenal ` +
    `(Lei 14.133/2021, Art. 107).`
  )
}

async function generateNarrativaFinding(
  finding: Finding,
  context: FiscalContext,
  fallbackNarr: string,
): Promise<string> {
  if (finding.riskScore >= 60) {
    const genNarr = context.generateNarrative
    if (genNarr) {
      return genNarr(finding)
    }
    const result = await defaultGenerateNarrative.execute({ finding })
    return result.data || fallbackNarr
  }
  return fallbackNarr
}

export const fiscalContratos: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta aditivos abusivos (Lei 14.133/2021, Art. 125, §1º: excede 25% do valor original ' +
    'em geral ou 50% em reforma de edifício/equipamento) e prorrogações excessivas ' +
    '(Art. 107: vigência total acima de 10 anos).',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const alertsTable = context.alertsTable ?? ALERTS_TABLE_DEFAULT
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM)
    const relevantExcerpts = gazette.excerpts.filter(
      e =>
        ADITIVO_RE.test(e) ||
        PRORROG_RE.test(e) ||
        ART_125_RE.test(e) ||
        ART_107_RE.test(e),
    )

    if (relevantExcerpts.length === 0) {
      return []
    }

    const extractFn = context.extractEntities ?? defaultExtractEntities

    for (const excerpt of relevantExcerpts) {
      // Etapa 2 — Extração
      const extractResult = await extractFn.execute({
        text: excerpt,
        gazetteUrl: gazette.url,
      })

      const entities = extractResult.data
      const { cnpjs, values, dates, contractNumbers, secretaria, supplier, subtype } = entities

      const cnpj = cnpjs[0] ?? undefined
      const contractNumber = contractNumbers[0] ?? undefined

      // ── Detecção de ADITIVO ──────────────────────────────────────────────────
      if (ADITIVO_RE.test(excerpt) || ART_125_RE.test(excerpt)) {
        if (values.length === 0) continue

        const valorAditivo = values[0]

        // Etapa 3 — Descoberta valor original (Opção C combo)
        let valorOriginal: number | undefined

        // 3.a Lookup histórico em alerts-prod
        if (contractNumber && cnpj && context.queryAlertsByCnpj) {
          const fiveYearsAgo = new Date(now)
          fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
          const sinceISO = fiveYearsAgo.toISOString().slice(0, 10)

          const historico = await context.queryAlertsByCnpj(cnpj, sinceISO)
          const contratoOriginal = historico.find(
            item =>
              (item as unknown as Record<string, unknown>)['actType'] === 'contrato' &&
              item.contractNumber === contractNumber &&
              item.cityId === cityId,
          )
          if (contratoOriginal?.value !== undefined) {
            valorOriginal = contratoOriginal.value
          }
        }

        // 3.b Fallback: valorOriginalContrato do LLM
        if (valorOriginal === undefined && entities.valorOriginalContrato !== undefined) {
          valorOriginal = entities.valorOriginalContrato
        }

        // 3.c Skip silencioso se nenhuma fonte disponível
        if (valorOriginal === undefined) {
          // Persistir aditivo para histórico mesmo sem emitir finding
          await persistAditivo({
            context, alertsTable, gazette, cityId, now,
            cnpj, contractNumber, secretaria, supplier, valorAditivo,
          })
          continue
        }

        // Etapa 4 — Classificação reforma (Art. 125 §1º II)
        const reforma = isReformaEdificio(excerpt, subtype)
        const limite = reforma ? LEI_14133_ART_125_LIMITE_REFORMA : LEI_14133_ART_125_LIMITE_GERAL
        const inciso: 'I' | 'II' = reforma ? 'II' : 'I'
        const legalBasisStr = `Lei 14.133/2021, Art. 125, §1º, ${inciso}`

        // Persistir aditivo para histórico (independente se é abusivo ou não)
        await persistAditivo({
          context, alertsTable, gazette, cityId, now,
          cnpj, contractNumber, secretaria, supplier, valorAditivo,
        })

        // Etapa 5 — Detecção aditivo abusivo
        const ratio = valorAditivo / valorOriginal
        if (ratio > limite) {
          const limitePercent = limite * 100

          // Etapa 7 — RiskFactors
          const legalBasisCitada =
            (entities.legalBasis?.includes('125') && entities.legalBasis.includes('14.133')) ? 80 : 50

          const excessoValue = Math.min(100, ((ratio - limite) / limite) * 100 + 60)

          const riskFactors: RiskFactor[] = [
            {
              type: 'excede_limite',
              weight: 0.6,
              value: excessoValue,
              description: `Aditivo de ${(ratio * 100).toFixed(1)}% excede limite Art. 125 ${inciso} de ${limitePercent}%`,
            },
            {
              type: 'confianca_extracao',
              weight: 0.2,
              value: extractResult.confidence * 100,
              description: 'Confiança da extração de entidades',
            },
            {
              type: 'base_legal_citada',
              weight: 0.2,
              value: legalBasisCitada,
              description: 'Base legal Art. 125 / Lei 14.133 explicitamente citada',
            },
          ]

          const scoreResult = await scoreRisk.execute({ factors: riskFactors })
          const riskScore = scoreResult.data

          const ratioPercent = ratio * 100
          const fallbackNarr = narrativaAditivo(
            gazette.date, valorAditivo, valorOriginal, ratioPercent, limitePercent, inciso,
          )

          const finding: Finding = {
            fiscalId: FISCAL_ID,
            cityId,
            type: 'aditivo_abusivo',
            riskScore,
            confidence: extractResult.confidence,
            evidence: [
              {
                source: gazette.url,
                excerpt,
                date: gazette.date,
              },
            ],
            narrative: '',
            legalBasis: legalBasisStr,
            cnpj,
            secretaria: secretaria ?? undefined,
            value: valorAditivo,
            contractNumber,
            createdAt: now.toISOString(),
          }

          // Etapa 8 — Narrativa
          finding.narrative = await generateNarrativaFinding(finding, context, fallbackNarr)

          findings.push(finding)
        }
      }

      // ── Detecção de PRORROGAÇÃO ──────────────────────────────────────────────
      if (PRORROG_RE.test(excerpt) || ART_107_RE.test(excerpt)) {
        // Etapa 6 — Prorrogação excessiva (Art. 107)
        if (!cnpj || !context.queryAlertsByCnpj) continue

        const fiveYearsAgo = new Date(now)
        fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
        const sinceISO = fiveYearsAgo.toISOString().slice(0, 10)

        const historico = await context.queryAlertsByCnpj(cnpj, sinceISO)

        // Filtrar por mesmo contrato e actType contrato/prorrogacao
        const contratoHistorico = historico.filter(item => {
          const actType = (item as unknown as Record<string, unknown>)['actType']
          const sameContract = contractNumber
            ? item.contractNumber === contractNumber
            : true
          return (
            item.cityId === cityId &&
            (actType === 'contrato' || actType === 'prorrogacao') &&
            sameContract
          )
        })

        if (contratoHistorico.length === 0) continue

        // Calcular vigência inicial
        const allDates = contratoHistorico
          .map(f => f.evidence?.[0]?.date ?? '')
          .filter(d => d !== '')

        // Also consider dates extracted from current excerpt
        if (dates.length > 0) allDates.push(...dates)

        if (allDates.length === 0) continue

        allDates.sort()
        const vigenciaInicialISO = allDates[0]
        const vigenciaInicial = new Date(vigenciaInicialISO)
        const anosVigencia = (now.getTime() - vigenciaInicial.getTime()) / (1000 * 60 * 60 * 24 * 365.25)

        if (anosVigencia > LEI_14133_ART_107_VIGENCIA_MAXIMA_ANOS) {
          const legalBasisStr = 'Lei 14.133/2021, Art. 107, caput'

          const riskFactors: RiskFactor[] = [
            {
              type: 'excede_limite',
              weight: 0.6,
              value: Math.min(100, ((anosVigencia - LEI_14133_ART_107_VIGENCIA_MAXIMA_ANOS) / LEI_14133_ART_107_VIGENCIA_MAXIMA_ANOS) * 100 + 60),
              description: `Vigência de ${anosVigencia.toFixed(1)} anos excede limite decenal (Art. 107)`,
            },
            {
              type: 'confianca_extracao',
              weight: 0.2,
              value: extractResult.confidence * 100,
              description: 'Confiança da extração de entidades',
            },
            {
              type: 'base_legal_citada',
              weight: 0.2,
              value: entities.legalBasis?.includes('107') && entities.legalBasis.includes('14.133') ? 80 : 50,
              description: 'Base legal Art. 107 / Lei 14.133 explicitamente citada',
            },
          ]

          const scoreResult = await scoreRisk.execute({ factors: riskFactors })
          const riskScore = scoreResult.data

          const fallbackNarr = narrativaProrrogacao(gazette.date, vigenciaInicialISO)

          const finding: Finding = {
            fiscalId: FISCAL_ID,
            cityId,
            type: 'prorrogacao_excessiva',
            riskScore,
            confidence: extractResult.confidence,
            evidence: [
              {
                source: gazette.url,
                excerpt,
                date: gazette.date,
              },
              ...contratoHistorico.flatMap(f => f.evidence ?? []),
            ],
            narrative: '',
            legalBasis: legalBasisStr,
            cnpj,
            secretaria: secretaria ?? undefined,
            contractNumber,
            createdAt: now.toISOString(),
          }

          finding.narrative = await generateNarrativaFinding(finding, context, fallbackNarr)

          findings.push(finding)
        }
      }
    }

    return findings
  },
}

// ── Helper interno ────────────────────────────────────────────────────────────

interface PersistAditivoArgs {
  context: FiscalContext
  alertsTable: string
  gazette: { id: string; url: string; date: string }
  cityId: string
  now: Date
  cnpj: string | undefined
  contractNumber: string | undefined
  secretaria: string | undefined
  supplier: string | undefined
  valorAditivo: number
}

async function persistAditivo(args: PersistAditivoArgs): Promise<void> {
  const {
    context, alertsTable, gazette, cityId, now,
    cnpj, contractNumber, secretaria, supplier, valorAditivo,
  } = args

  // IMPORTANTE: omitir campos null. Atributos indexados em GSI (cnpj, secretaria)
  // rejeitam NULL — devem estar ausentes ou ser String válida.
  const aditivoItem: Record<string, unknown> = {
    fiscalId: FISCAL_ID,
    cityId,
    actType: 'aditivo',
    ...(cnpj && { cnpj }),
    ...(contractNumber && { contractNumber }),
    ...(secretaria && { secretaria }),
    ...(supplier && { supplier }),
    valor: valorAditivo,
    gazetteUrl: gazette.url,
    gazetteDate: gazette.date,
    createdAt: now.toISOString(),
  }

  const aditivoPk = `ADITIVO#${gazette.id}#${cnpj ?? 'NOCNPJ'}#${valorAditivo}`

  const saveMemoryFn = context.saveMemory ?? saveMemory
  await saveMemoryFn.execute({
    pk: aditivoPk,
    table: alertsTable,
    item: aditivoItem,
  })
}
