import { extractEntities as defaultExtractEntities } from '../skills/extract_entities'
import { saveMemory } from '../skills/save_memory'
import { generateNarrative as defaultGenerateNarrative } from '../skills/generate_narrative'
import { scoreRisk } from '../skills/score_risk'
import { getPublishThresholds } from '../thresholds'
import type { Finding, RiskFactor } from '../types'
import { gazetteKey } from '../utils/pdf_cache'
import { LEI_14133_ART_75_I_LIMITE, LEI_14133_ART_75_II_LIMITE } from './legal-constants'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const FISCAL_ID = 'fiscal-licitacoes'
const ALERTS_TABLE_DEFAULT = 'fiscal-digital-alerts-prod'

// Regex de filtro etapa 1
const DISPENSA_RE = /dispensa\s+(de\s+)?licita[çc][ãa]o/i
const ART_75_RE = /art(?:igo)?\.?\s*75/i

// Regex para classificação inciso I (obras/engenharia)
const OBRA_RE = /(obra|engenharia|reforma|constru[çc][ãa]o|pavimenta[çc][ãa]o|edifica[çc][ãa]o|drenagem|terraplenagem|recupera[çc][ãa]o\s+estrutural)/i

// ── Filtros de exclusão (ADR-001 + padrões Ciclo 2) ─────────────────────────
// Atos que pertencem a OUTROS Fiscais (vazamento de escopo):
//   - Locação de imóvel → FiscalLocação (Art. 74 III, sem teto)
//   - Termo Aditivo → FiscalContratos (Art. 125, não nova dispensa)
//   - Designação de Fiscal de Contrato → não é nova contratação

const LOCACAO_IMOVEL_RE = /\bloca[çc][ãa]o\s+de\s+im[óo]vel\b/i
const TERMO_ADITIVO_LICITACOES_RE = /\b(termo\s+aditivo|aditamento|prorrog\w+|apostilamento)\b/i
const DESIGNAR_FISCAL_LICITACOES_RE = /\b(designar|nomear|nomeia|designa)\b[\s\S]{0,200}\b(gestor|fiscal)\b[\s\S]{0,300}\b(de\s+|do\s+)?contrato\b/i

// ── Hipóteses sem teto da Lei 14.133 Art. 75 ────────────────────────────────
// III: fornecedor exclusivo / única fornecedora (notória especialização)
// IV: emergência / calamidade pública / urgência declarada / sanitária
// VIII: insumos / medicamentos / produtos de saúde
// IX: contratação entre entes da administração pública
// XV: ciência/tecnologia (universidade pública, fundação de apoio)

const HIPOTESE_FORNECEDOR_EXCLUSIVO_RE =
  /\b(fornecedor\s+exclusivo|[úu]nica\s+(?:fornecedora|fabricante)|not[óo]ria\s+especializa[çc][ãa]o|exclusividade\s+comprovada)\b/i
const HIPOTESE_EMERGENCIA_RE =
  /\b(emerg[êe]ncia|calamidade(\s+p[úu]blica)?|urg[êe]ncia\s+(?:declarada|sanit[áa]ria)|estado\s+de\s+(?:emerg[êe]ncia|calamidade)\s+p[úu]blica|contrata[çc][ãa]o\s+emergencial)\b/i
const HIPOTESE_INSUMOS_SAUDE_RE =
  /\b(medicamento|insumo\s+(?:m[ée]dico|hospitalar|farmac[êe]utico|de\s+sa[úu]de)|[óo]rtese|pr[óo]tese|vacina|imunobiol[óo]gico|equipamento\s+hospitalar)\b/i
const HIPOTESE_ENTES_PUBLICOS_RE =
  /\b(?:art(?:igo)?\.?\s*75\s*(?:,|\s)?\s*(?:inciso\s+)?IX|Art\.\s*75\s+IX)\b|\bcontrata[çc][ãa]o\s+entre\s+entes\s+da\s+administra[çc][ãa]o\b/i
const HIPOTESE_CIENCIA_TECNOLOGIA_RE =
  /\b(?:art(?:igo)?\.?\s*75\s*(?:,|\s)?\s*(?:inciso\s+)?XV|Art\.\s*75\s+XV)\b|\b(?:universidade|funda[çc][ãa]o\s+de\s+(?:apoio|pesquisa|ensino))\b[\s\S]{0,80}\b(p[úu]blica|estadual|federal|municipal)\b/i

function isVazamentoEscopo(excerpt: string): boolean {
  if (LOCACAO_IMOVEL_RE.test(excerpt)) return true
  if (TERMO_ADITIVO_LICITACOES_RE.test(excerpt)) return true
  if (DESIGNAR_FISCAL_LICITACOES_RE.test(excerpt)) return true
  return false
}

function isHipoteseSemTeto(excerpt: string): boolean {
  if (HIPOTESE_FORNECEDOR_EXCLUSIVO_RE.test(excerpt)) return true
  if (HIPOTESE_EMERGENCIA_RE.test(excerpt)) return true
  if (HIPOTESE_INSUMOS_SAUDE_RE.test(excerpt)) return true
  if (HIPOTESE_ENTES_PUBLICOS_RE.test(excerpt)) return true
  if (HIPOTESE_CIENCIA_TECNOLOGIA_RE.test(excerpt)) return true
  return false
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function narrativaFactual(
  gazetteDate: string,
  valor: number,
  teto: number,
  inciso: 'I' | 'II',
): string {
  return (
    `Identificamos dispensa publicada em ${formatDate(gazetteDate)} no valor de ` +
    `R$ ${formatBRL(valor)}, acima do limite legal de R$ ${formatBRL(teto)} ` +
    `(Lei 14.133/2021, Art. 75, ${inciso}).`
  )
}

function classificarInciso(excerpt: string, subtype?: string | null): 'I' | 'II' {
  if (subtype === 'obra_engenharia') return 'I'
  if (subtype === 'servico' || subtype === 'compra') return 'II'
  // Fallback: heurística regex quando LLM não classificou
  return OBRA_RE.test(excerpt) ? 'I' : 'II'
}

async function generateNarrativaDispensa(
  finding: Finding,
  context: FiscalContext,
  valor: number,
  teto: number,
  inciso: 'I' | 'II',
  gazetteDate: string,
): Promise<string> {
  const { riskThreshold } = await getPublishThresholds()
  if (finding.riskScore >= riskThreshold) {
    const genNarr = context.generateNarrative
    if (genNarr) {
      return genNarr(finding)
    }
    // Use the default generateNarrative skill
    const result = await defaultGenerateNarrative.execute({ finding })
    return result.data
  }
  return narrativaFactual(gazetteDate, valor, teto, inciso)
}

export const fiscalLicitacoes: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta dispensas de licitação com valor acima dos tetos da Lei 14.133/2021, Art. 75, ' +
    'e fracionamento de contrato (Art. 75, §1º). Valores 2026 conforme Decreto 12.807/2025.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const alertsTable = context.alertsTable ?? ALERTS_TABLE_DEFAULT
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM)
    // Triagem com filtros de vazamento de escopo (ADR-001):
    //   - Locação de imóvel → FiscalLocação (Art. 74 III, sem teto)
    //   - Termo Aditivo → FiscalContratos (Art. 125)
    //   - Designação de Fiscal de Contrato → não é nova contratação
    const relevantExcerpts = gazette.excerpts.filter(e => {
      if (!(DISPENSA_RE.test(e) || ART_75_RE.test(e))) return false
      if (isVazamentoEscopo(e)) return false
      return true
    })

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
      const { cnpjs, values, secretaria, supplier, legalBasis } = entities

      if (values.length === 0) continue

      const valor = values[0]
      const cnpj = cnpjs[0] ?? undefined

      // Etapa 3 — Classificação Art. 75 I vs II
      const inciso: 'I' | 'II' = classificarInciso(excerpt, entities.subtype)
      const teto = inciso === 'I' ? LEI_14133_ART_75_I_LIMITE : LEI_14133_ART_75_II_LIMITE
      const legalBasisStr = `Lei 14.133/2021, Art. 75, ${inciso}`

      // Para histórico de fracionamento: persistir todas as dispensas (mesmo legais)
      // com actType='dispensa', sem findingType.
      // IMPORTANTE: omitir campos null. Atributos indexados em GSI (cnpj, secretaria)
      // rejeitam NULL — devem estar ausentes ou ser String válida.
      const dispensaItem: Record<string, unknown> = {
        fiscalId: FISCAL_ID,
        cityId,
        actType: 'dispensa',
        ...(cnpj && { cnpj }),
        ...(secretaria && { secretaria }),
        ...(supplier && { supplier }),
        valor,
        inciso,
        gazetteUrl: gazette.url,
        gazetteDate: gazette.date,
        createdAt: now.toISOString(),
      }

      const dispensaPk = `DISPENSA#${gazetteKey(gazette.url) ?? gazette.id}#${cnpj ?? 'NOCNPJ'}#${valor}`

      const saveMemoryFn = context.saveMemory ?? saveMemory
      await saveMemoryFn.execute({
        pk: dispensaPk,
        table: alertsTable,
        item: dispensaItem,
      })

      // Etapa 9 — Confidence final (calculado aqui para uso em ambos os blocos abaixo)
      const hasAllFields = !!(cnpj && valor && gazette.date)

      // Etapa 4 — Detecção dispensa irregular
      // ADR-001: pular se o ato cita hipótese sem teto (Art. 75 III/IV/VIII/IX/XV).
      // Ex: emergência sanitária + agulhas hospitalares = legal mesmo acima de R$ 50k.
      if (valor > teto && !isHipoteseSemTeto(excerpt)) {
        // Etapa 5 — RiskFactors
        const legalBasisCitada =
          (legalBasis?.includes('75') && legalBasis.includes('14.133')) ? 80 : 50

        const riskFactors: RiskFactor[] = [
          {
            type: 'excede_teto',
            weight: 0.6,
            value: Math.min(100, ((valor - teto) / teto) * 100 + 60),
            description: `Valor R$ ${formatBRL(valor)} excede teto Art. 75 ${inciso} de R$ ${formatBRL(teto)}`,
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
            description: 'Base legal Art. 75 / Lei 14.133 explicitamente citada',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data
        const confidence = Math.min(
          extractResult.confidence,
          hasAllFields ? 0.9 : 0.65,
        )

        const finding: Finding = {
          fiscalId: FISCAL_ID,
          cityId,
          type: 'dispensa_irregular',
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
          legalBasis: legalBasisStr,
          cnpj,
          secretaria: secretaria ?? undefined,
          value: valor,
          createdAt: now.toISOString(),
        }

        // Etapa 6 — Narrativa
        finding.narrative = await generateNarrativaDispensa(
          finding,
          context,
          valor,
          teto,
          inciso,
          gazette.date,
        )

        findings.push(finding)
      }

      // Etapa 8 — Fracionamento
      if (cnpj && context.queryAlertsByCnpj) {
        const twelveMonthsAgo = new Date(now)
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
        const sinceISO = twelveMonthsAgo.toISOString().slice(0, 10)

        const historico = await context.queryAlertsByCnpj(cnpj, sinceISO)

        // Filtrar por mesma cidade e actType=dispensa
        const dispensasHistorico = historico.filter(
          f => f.cityId === cityId && (f as unknown as Record<string, unknown>)['actType'] === 'dispensa',
        )

        // Fracionamento requer pelo menos 1 dispensa anterior para o mesmo CNPJ
        const somaHistorico = dispensasHistorico.reduce((s, f) => s + (f.value ?? 0), 0)
        const somaTotal = somaHistorico + valor

        // TODO: analisar fracionamento por inciso I também (atualmente só compara com teto II)
        if (dispensasHistorico.length >= 1 && somaTotal > LEI_14133_ART_75_II_LIMITE) {
          const n = dispensasHistorico.length + 1 // inclui a atual

          // Calcular dias entre primeira e última dispensa para janela temporal
          const allDates = dispensasHistorico
            .map(f => f.evidence?.[0]?.date ?? gazette.date)
            .concat([gazette.date])
            .sort()
          const primeiraData = new Date(allDates[0])
          const ultimaData = new Date(allDates[allDates.length - 1])
          const diasEntrePrimeiraUltima = Math.max(
            1,
            (ultimaData.getTime() - primeiraData.getTime()) / (1000 * 60 * 60 * 24),
          )

          const fracaoExcesso = Math.min(100, ((somaTotal - LEI_14133_ART_75_II_LIMITE) / LEI_14133_ART_75_II_LIMITE) * 100 + 60)

          const riskFactorsFrac: RiskFactor[] = [
            {
              type: 'soma_excede_teto',
              weight: 0.5,
              value: fracaoExcesso,
              description: `Soma R$ ${formatBRL(somaTotal)} excede teto Art. 75 II de R$ ${formatBRL(LEI_14133_ART_75_II_LIMITE)}`,
            },
            {
              type: 'quantidade_dispensas',
              weight: 0.3,
              value: Math.min(100, n * 25),
              description: `${n} dispensas para o mesmo CNPJ nos últimos 12 meses`,
            },
            {
              type: 'janela_temporal',
              weight: 0.2,
              value: Math.max(0, 100 - diasEntrePrimeiraUltima / 3.65),
              description: `${Math.round(diasEntrePrimeiraUltima)} dias entre primeira e última dispensa`,
            },
          ]

          const scoreFracResult = await scoreRisk.execute({ factors: riskFactorsFrac })
          const riskScoreFrac = scoreFracResult.data

          const confidenceFrac = hasAllFields ? 0.9 : 0.65

          const narrativaFrac =
            `Identificamos ${n} dispensas para o fornecedor CNPJ ${cnpj} nos últimos 12 meses, ` +
            `totalizando R$ ${formatBRL(somaTotal)}, acima do limite legal de R$ ${formatBRL(LEI_14133_ART_75_II_LIMITE)} ` +
            `(Lei 14.133/2021, Art. 75, §1º). O documento aponta possível fracionamento de contrato.`

          const findingFrac: Finding = {
            fiscalId: FISCAL_ID,
            cityId,
            type: 'fracionamento',
            riskScore: riskScoreFrac,
            confidence: confidenceFrac,
            evidence: [
              {
                source: gazette.url,
                excerpt,
                date: gazette.date,
              },
              ...dispensasHistorico.flatMap(f => f.evidence ?? []),
            ],
            narrative: narrativaFrac,
            legalBasis: 'Lei 14.133/2021, Art. 75, §1º',
            cnpj,
            secretaria: secretaria ?? undefined,
            value: somaTotal,
            createdAt: now.toISOString(),
          }

          findings.push(findingFrac)
        }
      }
    }

    return findings
  },
}
