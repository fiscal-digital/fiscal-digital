import { extractEntities as defaultExtractEntities } from '../skills/extract_entities'
import { saveMemory } from '../skills/save_memory'
import { generateNarrative as defaultGenerateNarrative } from '../skills/generate_narrative'
import { scoreRisk } from '../skills/score_risk'
import { getPublishThresholds } from '../thresholds'
import type { Finding, RiskFactor } from '../types'
import { gazetteKey } from '../utils/pdf_cache'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const FISCAL_ID = 'fiscal-locacao'
const ALERTS_TABLE_DEFAULT = 'fiscal-digital-alerts-prod'

// ── Limiares ─────────────────────────────────────────────────────────────────

/**
 * Limite anual de referência para locação considerada de "valor relevante" (R$ 240.000/ano,
 * equivalente a R$ 20.000/mês). Acima deste piso, o Fiscal eleva o riskScore — abaixo,
 * apenas a ausência de termos de validação dispara o alerta indiciário.
 *
 * TODO(legal-constants): Lei 14.133/2021 não fixa teto de locação; este piso é heurístico
 * e deve ser calibrado por cidade quando coletarmos média de m²/região via cruzamento IPTU.
 */
const LOCACAO_VALOR_RELEVANTE_ANUAL = 240_000

/**
 * Quando o excerpt não diferencia "mês" vs "ano", o Fiscal assume valor mensal e
 * estima anual = mensal × 12 para comparação contra o piso. Marcador é apenas para
 * aumentar a faixa indiciária do riskScore (55-70).
 */
const LOCACAO_VALOR_MENSAL_RELEVANTE = 20_000

// ── Filtros etapa 1 (regex) ──────────────────────────────────────────────────

const LOCACAO_RE = /\b(loca[çc][ãa]o|aluguel)\b/i
const IMOVEL_RE = /\bim[óo]vel\b/i
const ART_74_RE = /art(?:igo)?\.?\s*74/i
const INEX_LOCACAO_RE = /inexigibilidade.*loca[çc][ãa]o/i

// ── Termos de validação (Art. 74 III exige justificativa) ────────────────────

const LAUDO_AVALIACAO_RE = /laudo\s+(de\s+)?avalia[çc][ãa]o/i
const VALOR_MERCADO_RE = /valor\s+(de\s+)?mercado/i
const JUSTIFICATIVA_RE = /justificativa(\s+(da|de)\s+escolha)?/i
const RAZAO_ESCOLHA_RE = /raz[ãa]o\s+(da|de)\s+escolha/i

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Detecta se o excerpt cita pelo menos um dos termos de validação exigidos
 * pela Lei 14.133/2021, Art. 74 III (laudo de avaliação, valor de mercado,
 * justificativa de escolha, razão da escolha do locador).
 */
function temTermosValidacao(excerpt: string): boolean {
  return (
    LAUDO_AVALIACAO_RE.test(excerpt) ||
    VALOR_MERCADO_RE.test(excerpt) ||
    JUSTIFICATIVA_RE.test(excerpt) ||
    RAZAO_ESCOLHA_RE.test(excerpt)
  )
}

/**
 * Detecta se o excerpt indica explicitamente periodicidade mensal do valor
 * (ex.: "R$ 25.000,00 mensais", "valor mensal de R$ X", "por mês").
 */
function isValorMensal(excerpt: string): boolean {
  return /\b(mensa(l|is)|por\s+m[êe]s|ao\s+m[êe]s|\/m[êe]s)\b/i.test(excerpt)
}

function narrativaFactual(
  gazetteDate: string,
  valor: number | undefined,
  valorMensal: boolean,
): string {
  const valorStr =
    valor !== undefined
      ? ` no valor de R$ ${formatBRL(valor)}${valorMensal ? '/mês' : ''}`
      : ''
  return (
    `Identificamos contratação por inexigibilidade para locação de imóvel ` +
    `publicada em ${formatDate(gazetteDate)}${valorStr} sem menção explícita ` +
    `a laudo de avaliação prévia ou justificativa da escolha do locador, ` +
    `conforme exigido pela Lei 14.133/2021, Art. 74, III.`
  )
}

async function generateNarrativaLocacao(
  finding: Finding,
  context: FiscalContext,
  gazetteDate: string,
  valor: number | undefined,
  valorMensal: boolean,
): Promise<string> {
  const { riskThreshold } = await getPublishThresholds()
  if (finding.riskScore >= riskThreshold) {
    const genNarr = context.generateNarrative
    if (genNarr) {
      return genNarr(finding)
    }
    const result = await defaultGenerateNarrative.execute({ finding })
    return result.data
  }
  return narrativaFactual(gazetteDate, valor, valorMensal)
}

// ── Fiscal ───────────────────────────────────────────────────────────────────

export const fiscalLocacao: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta locação de imóvel pelo município por inexigibilidade (Lei 14.133/2021, ' +
    'Art. 74, III) sem menção a laudo de avaliação prévia ou justificativa da escolha ' +
    'do locador. Eleva risco quando o valor excede R$ 240k/ano (R$ 20k/mês). ' +
    'Não cruza com IPTU no MVP — escopo futuro.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const alertsTable = context.alertsTable ?? ALERTS_TABLE_DEFAULT
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM): excerpts com indício de locação de imóvel
    const relevantExcerpts = gazette.excerpts.filter(e => {
      const hasLocacao = LOCACAO_RE.test(e)
      const hasContextoImovel =
        IMOVEL_RE.test(e) || ART_74_RE.test(e) || INEX_LOCACAO_RE.test(e)
      return hasLocacao && hasContextoImovel
    })

    if (relevantExcerpts.length === 0) {
      return []
    }

    const extractFn = context.extractEntities ?? defaultExtractEntities

    for (const excerpt of relevantExcerpts) {
      // Etapa 2 — Extração via Haiku
      const extractResult = await extractFn.execute({
        text: excerpt,
        gazetteUrl: gazette.url,
      })

      const entities = extractResult.data
      const { cnpjs, values, secretaria, supplier } = entities

      const cnpj = cnpjs[0] ?? undefined
      const valor = values[0]
      const valorMensal = valor !== undefined && isValorMensal(excerpt)
      const valorAnualEstimado = valor !== undefined
        ? (valorMensal ? valor * 12 : valor)
        : undefined

      // Etapa 3 — Persistir histórico de locações (mesmo as legais)
      // IMPORTANTE: omitir campos null em GSI keys (LRN-019).
      const locacaoItem: Record<string, unknown> = {
        fiscalId: FISCAL_ID,
        cityId,
        actType: 'locacao',
        ...(cnpj && { cnpj }),
        ...(secretaria && { secretaria }),
        ...(supplier && { supplier }),
        ...(valor !== undefined && { valor }),
        ...(valorMensal && { valorMensal: true }),
        gazetteUrl: gazette.url,
        gazetteDate: gazette.date,
        createdAt: now.toISOString(),
      }

      const locacaoPk = `LOCACAO#${gazetteKey(gazette.url) ?? gazette.id}#${cnpj ?? 'NOCNPJ'}#${valor ?? 'NOVAL'}`

      const saveMemoryFn = context.saveMemory ?? saveMemory
      await saveMemoryFn.execute({
        pk: locacaoPk,
        table: alertsTable,
        item: locacaoItem,
      })

      // Etapa 4 — Heurística de validação: se cita termos de avaliação/justificativa,
      // assumimos que o ato observa o Art. 74 III → não emite alerta.
      if (temTermosValidacao(excerpt)) {
        continue
      }

      // Etapa 5 — RiskFactors
      // (a) ausência de termos de validação é o gatilho principal
      const ausenciaValidacao = 70 // valor base sempre que dispara

      // (b) valor relevante eleva o risco
      let valorRelevanteValue = 30 // default neutro quando valor desconhecido
      let valorAcimaPiso = false
      if (valorAnualEstimado !== undefined) {
        if (valorAnualEstimado > LOCACAO_VALOR_RELEVANTE_ANUAL) {
          valorAcimaPiso = true
          // Quanto excede o piso ⇒ até 100
          const excessoPct =
            ((valorAnualEstimado - LOCACAO_VALOR_RELEVANTE_ANUAL) /
              LOCACAO_VALOR_RELEVANTE_ANUAL) *
            100
          valorRelevanteValue = Math.min(100, 60 + excessoPct)
        } else if (valorMensal && valor !== undefined && valor > LOCACAO_VALOR_MENSAL_RELEVANTE) {
          valorAcimaPiso = true
          valorRelevanteValue = 65
        } else {
          valorRelevanteValue = 35 // valor presente mas dentro do piso
        }
      }

      // (c) confiança da extração
      const confiancaExtracao = extractResult.confidence * 100

      const riskFactors: RiskFactor[] = [
        {
          type: 'ausencia_termos_validacao',
          weight: 0.55,
          value: ausenciaValidacao,
          description:
            'Excerpt não cita laudo de avaliação, valor de mercado, ' +
            'justificativa ou razão da escolha do locador',
        },
        {
          type: 'valor_relevante',
          weight: 0.30,
          value: valorRelevanteValue,
          description: valorAcimaPiso
            ? `Valor estimado anual R$ ${formatBRL(valorAnualEstimado ?? 0)} excede piso de R$ ${formatBRL(LOCACAO_VALOR_RELEVANTE_ANUAL)}`
            : 'Valor da locação dentro do piso de referência ou não identificado',
        },
        {
          type: 'confianca_extracao',
          weight: 0.15,
          value: confiancaExtracao,
          description: 'Confiança da extração de entidades',
        },
      ]

      const scoreResult = await scoreRisk.execute({ factors: riskFactors })
      let riskScore = scoreResult.data

      // Faixa indiciária MVP: clamp em 55-70 quando ainda não temos cruzamento IPTU.
      // Se valor > piso, permitimos passar de 70 para subir a prioridade.
      if (!valorAcimaPiso) {
        riskScore = Math.max(55, Math.min(70, riskScore))
      } else {
        riskScore = Math.max(60, Math.min(85, riskScore))
      }

      const hasAllFields = !!(cnpj && valor !== undefined && gazette.date)
      const confidence = Math.min(
        extractResult.confidence,
        hasAllFields ? 0.85 : 0.65,
      )

      const finding: Finding = {
        fiscalId: FISCAL_ID,
        cityId,
        type: 'locacao_sem_justificativa',
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
        legalBasis: 'Lei 14.133/2021, Art. 74, III',
        ...(cnpj && { cnpj }),
        ...(secretaria && { secretaria }),
        ...(valor !== undefined && { value: valor }),
        createdAt: now.toISOString(),
      }

      // Etapa 6 — Narrativa (LLM se riskScore >= 60, senão template factual)
      finding.narrative = await generateNarrativaLocacao(
        finding,
        context,
        gazette.date,
        valor,
        valorMensal,
      )

      findings.push(finding)
    }

    return findings
  },
}
