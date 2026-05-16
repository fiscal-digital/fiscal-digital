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

// ── Filtros de exclusão (ADR-001 + Ciclo 2 padrões) ──────────────────────────
// Estas regex rejeitam excerpts que mencionam "locação" em contextos que NÃO
// são nova contratação por inexigibilidade — designação de fiscal, aditivo,
// rescisão, programa social, cross-block matching, regime estatal etc.

// (a) Rescisão / encerramento de contrato existente
const RESCISAO_RE = /\b(extrato\s+de\s+)?rescis[ãa]o\b/i

// (b) Portaria de designação de Gestor/Fiscal de Contrato (não é nova contratação)
const DESIGNAR_FISCAL_RE = /\b(designar|nomear|nomeia|designa)\b[\s\S]{0,200}\b(gestor|fiscal)\b[\s\S]{0,300}\b(de\s+|do\s+)?contrato\b/i

// (c) Termo Aditivo / aditamento / prorrogação / ratificação de renovação / apostilamento
const TERMO_ADITIVO_RE = /\b(termo\s+aditivo|aditamento|prorrog\w+|ratific\w+\s+a\s+renova[çc][ãa]o|apostilamento)\b/i

// (d) Aviso de procura/interesse / Edital de chamamento (fase pré-contratual ou modalidade competitiva)
const AVISO_INTERESSE_RE = /\b(aviso\s+de\s+(?:procura|interesse|coleta|cota[çc][ãa]o)|edital\s+de\s+chamamento|chamamento\s+p[úu]blico)\b/i

// (e) Decreto que regulamenta programa/tributo — município é regulador, não locatário
const DECRETO_REGULAMENTA_RE = /\bdecreto\b[\s\S]{0,200}\bregulamenta\b/i

// (f) Anexo de Portaria com rol "CONTRATO FORNECEDOR OBJETO" — listagem documental
const ANEXO_ROL_CONTRATOS_RE = /\bANEXO\b[\s\S]{0,200}\bCONTRATO\s+FORNECEDOR\b/i

// (g) Cross-block: SÚMULA DE CONTRATOS aparece em pdfs com múltiplos atos não relacionados
const SUMULA_CONTRATOS_RE = /\bs[úu]mula\s+de\s+(conv[êe]nios?\s+e\s+)?contratos?\b/i

// (h) Lei 13.303/2016 — empresas estatais (regime próprio, fora do escopo Lei 14.133)
const LEI_13303_RE = /\bLei\s+(n[º°.]?\s*)?13[.,]?303\b/i

// (i) Termo de Fomento / Colaboração (Lei 13.019/2014) confundido com locação
const TERMO_FOMENTO_RE = /\b(termo\s+de\s+(fomento|colabora[çc][ãa]o)|parceria\s+(?:com\s+)?OSC)\b/i

// (j) Rol documental — "cópia do contrato de locação" como item exigido em outro ato
const ROL_DOCUMENTAL_RE = /\bc[óo]pia\s+(do\s+|de\s+)?(contrato\s+de\s+loca[çc][ãa]o|documento\s+similar)/i

// (k) Cláusulas contratuais listadas (manutenção/obrigações com numeração romana)
const CLAUSULA_CONTRATUAL_RE = /(^|\s)(I{1,3}V?|IV|VI{0,3}|IX|X{1,2})\s*[-–]\s+[\s\S]{0,80}\b(manuten[çc][ãa]o|obriga[çc][õo]es|cl[áa]usula|arcar\s+com)\b/im

// (l) Modalidades competitivas — locação por inexigibilidade Art. 74 III tem regime próprio
const MODALIDADE_COMPETITIVA_RE = /\b(preg[ãa]o\s+(eletr[ôo]nico|presencial)|concorr[êe]ncia|tomada\s+de\s+pre[çc]os)\b/i
const MODALIDADE_PERMITIDA_RE = /\b(inexigibilidade|dispensa)\b/i

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
 * Rejeita o excerpt quando ele cita "locação" mas o ato NÃO é nova contratação
 * por inexigibilidade — designação de fiscal, aditivo, rescisão, programa
 * social, cross-block, regime estatal, Termo de Fomento etc.
 *
 * Reduz overmatch sistemático identificado nos Ciclos 1-3 do golden set
 * (precisão pré-patch: 16,0% sobre n=476).
 */
function isExcludedAct(excerpt: string): boolean {
  if (RESCISAO_RE.test(excerpt)) return true
  if (DESIGNAR_FISCAL_RE.test(excerpt)) return true
  if (TERMO_ADITIVO_RE.test(excerpt)) return true
  if (AVISO_INTERESSE_RE.test(excerpt)) return true
  if (DECRETO_REGULAMENTA_RE.test(excerpt)) return true
  if (ANEXO_ROL_CONTRATOS_RE.test(excerpt)) return true
  if (SUMULA_CONTRATOS_RE.test(excerpt)) return true
  if (LEI_13303_RE.test(excerpt)) return true
  if (TERMO_FOMENTO_RE.test(excerpt)) return true
  if (ROL_DOCUMENTAL_RE.test(excerpt)) return true
  if (CLAUSULA_CONTRATUAL_RE.test(excerpt)) return true
  return false
}

/**
 * Locação por inexigibilidade Art. 74 III tem regime próprio. Excerpts que
 * citam apenas modalidades competitivas (Pregão, Concorrência, Tomada de
 * Preços) sem qualquer menção a inexigibilidade/dispensa não pertencem ao
 * escopo deste Fiscal.
 */
function hasOnlyCompetingModality(excerpt: string): boolean {
  return MODALIDADE_COMPETITIVA_RE.test(excerpt) && !MODALIDADE_PERMITIDA_RE.test(excerpt)
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
    // que seja nova contratação por inexigibilidade. Rejeita designação de fiscal,
    // aditivo, rescisão, programa social, cross-block, regime estatal etc.
    const relevantExcerpts = gazette.excerpts.filter(e => {
      const hasLocacao = LOCACAO_RE.test(e)
      const hasContextoImovel =
        IMOVEL_RE.test(e) || ART_74_RE.test(e) || INEX_LOCACAO_RE.test(e)
      if (!hasLocacao || !hasContextoImovel) return false

      // Filtros de exclusão (ADR-001 fiscal-digital-evaluations + padrões Ciclo 2)
      if (isExcludedAct(e)) return false
      if (hasOnlyCompetingModality(e)) return false

      return true
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
