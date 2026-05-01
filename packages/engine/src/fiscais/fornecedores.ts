import { extractEntities as defaultExtractEntities } from '../skills/extract_entities'
import { scoreRisk } from '../skills/score_risk'
import { validateCNPJ as defaultValidateCNPJ } from '../skills/validate_cnpj'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const FISCAL_ID = 'fiscal-fornecedores'

// ── Limiares ─────────────────────────────────────────────────────────────────

/** CNPJ com menos de 6 meses de existência na data do contrato → risco de qualificação */
const CNPJ_JOVEM_MESES = 6

/**
 * Concentração heurística: >= 3 contratos do mesmo CNPJ na mesma secretaria
 * no mesmo excerpt (MVP sem lookup DynamoDB).
 * TODO(concentracao): substituir pela query real via queryAlertsByCnpj quando
 * a chave GSI secretaria-cnpj estiver disponível (depende MIT-02).
 */
const CONCENTRACAO_MIN_CONTRATOS = 3

/** Limite percentual de concentração por secretaria (40%) */
const CONCENTRACAO_LIMITE = 0.40

// Regex de filtro etapa 1 — termos indicativos de contratação
const CONTRATO_RE = /\b(?:contrat[oaou]|conven[çc][ãa]o|credenciamento|adesão\s+de\s+ata)\b/i
const DISPENSA_RE = /dispensa\s+(de\s+)?licita[çc][ãa]o/i
const PREGAO_RE = /\bpreg[ãa]o\s+(?:eletr[ôo]nico|presencial)/i
const CNPJ_RE = /\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Calcula quantos meses inteiros decorrem entre duas datas ISO (YYYY-MM-DD).
 * Retorna valor positivo se dataFim > dataInicio.
 */
function mesesEntre(dataInicio: string, dataFim: string): number {
  const inicio = new Date(dataInicio)
  const fim = new Date(dataFim)
  return (
    (fim.getFullYear() - inicio.getFullYear()) * 12 +
    (fim.getMonth() - inicio.getMonth())
  )
}

function narrativaCnpjJovem(
  gazetteDate: string,
  cnpj: string,
  dataAbertura: string,
  meses: number,
  valor: number | undefined,
): string {
  const valorStr = valor !== undefined ? ` no valor de R$ ${formatBRL(valor)}` : ''
  return (
    `Identificamos contratação publicada em ${formatDate(gazetteDate)}${valorStr} ` +
    `com empresa CNPJ ${cnpj}, constituída em ${formatDate(dataAbertura)} ` +
    `(${meses} ${meses === 1 ? 'mês' : 'meses'} de existência na data do ato). ` +
    `O documento aponta possível ausência de qualificação técnica e econômico-financeira ` +
    `(Lei 14.133/2021, Art. 67).`
  )
}

function narrativaConcentracao(
  secretaria: string,
  cnpj: string,
  qtdContratos: number,
): string {
  return (
    `Identificamos ${qtdContratos} contratos com o fornecedor CNPJ ${cnpj} ` +
    `na ${secretaria} em curto período. ` +
    `O documento aponta possível concentração de fornecedor acima do limite de ` +
    `${(CONCENTRACAO_LIMITE * 100).toFixed(0)}% por secretaria ` +
    `(Lei 14.133/2021, Art. 11, §2º).`
  )
}

// ── Fiscal ────────────────────────────────────────────────────────────────────

export const fiscalFornecedores: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta CNPJ com menos de 6 meses de existência na data da contratação ' +
    '(Lei 14.133/2021, Art. 67) e concentração de fornecedor acima de 40% por ' +
    'secretaria em janela de 12 meses (MVP: heurística por excerpt).',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM): retém excerpts com indício de contratação
    const relevantExcerpts = gazette.excerpts.filter(
      e => (CONTRATO_RE.test(e) || DISPENSA_RE.test(e) || PREGAO_RE.test(e)) && CNPJ_RE.test(e),
    )

    if (relevantExcerpts.length === 0) {
      return []
    }

    const extractFn = context.extractEntities ?? defaultExtractEntities
    const validateFn = context.validateCNPJ ?? defaultValidateCNPJ.execute.bind(defaultValidateCNPJ)

    for (const excerpt of relevantExcerpts) {
      // Etapa 2 — Extração de entidades via Haiku
      const extractResult = await extractFn.execute({
        text: excerpt,
        gazetteUrl: gazette.url,
      })

      const entities = extractResult.data
      const { cnpjs, values, secretaria } = entities

      if (cnpjs.length === 0) continue

      const valor = values[0]

      // ── Detecção CNPJ Jovem ────────────────────────────────────────────────

      for (const cnpj of cnpjs) {
        // Etapa 3 — Consulta BrasilAPI via validateCNPJ
        let dataAbertura: string | undefined
        let situacaoCadastral: string | undefined

        try {
          const cnpjResult = await validateFn({ cnpj })
          dataAbertura = cnpjResult.data.dataAbertura
          situacaoCadastral = cnpjResult.data.situacaoCadastral
        } catch {
          // Falha de rede: skip silencioso — não bloqueia análise
          continue
        }

        // CNPJ não encontrado na Receita: skip silencioso (empresa pode estar em processo
        // de regularização ou houve erro de OCR no CNPJ)
        if (!dataAbertura || situacaoCadastral === 'nao_encontrado') {
          continue
        }

        // Etapa 4 — Calcular idade do CNPJ na data do ato (gazette.date)
        const meses = mesesEntre(dataAbertura, gazette.date)

        if (meses < CNPJ_JOVEM_MESES) {
          // Etapa 5 — RiskFactors cnpj_jovem
          const idadeValue = Math.max(0, 100 - (meses / CNPJ_JOVEM_MESES) * 40)

          const riskFactors: RiskFactor[] = [
            {
              type: 'cnpj_age_months',
              weight: 0.60,
              value: idadeValue,
              description: `CNPJ com ${meses} ${meses === 1 ? 'mês' : 'meses'} de existência (mínimo esperado: ${CNPJ_JOVEM_MESES} meses)`,
            },
            {
              type: 'confianca_extracao',
              weight: 0.25,
              value: extractResult.confidence * 100,
              description: 'Confiança da extração de entidades',
            },
            {
              type: 'dados_completos',
              weight: 0.15,
              value: (cnpj && gazette.date && dataAbertura) ? 90 : 50,
              description: 'Completude dos dados para análise',
            },
          ]

          const scoreResult = await scoreRisk.execute({ factors: riskFactors })
          const riskScore = scoreResult.data
          const confidence = Math.min(extractResult.confidence, 0.90)

          const finding: Finding = {
            fiscalId: FISCAL_ID,
            cityId,
            type: 'cnpj_jovem',
            riskScore,
            confidence,
            evidence: [
              {
                source: gazette.url,
                excerpt,
                date: gazette.date,
              },
            ],
            narrative: narrativaCnpjJovem(gazette.date, cnpj, dataAbertura, meses, valor),
            legalBasis: 'Lei 14.133/2021, Art. 67 (qualificação técnica e econômico-financeira)',
            cnpj,
            secretaria: secretaria ?? undefined,
            value: valor,
            createdAt: now.toISOString(),
          }

          findings.push(finding)
        }
      }

      // ── Detecção Concentração (heurística MVP) ────────────────────────────
      // TODO(concentracao-lookup): substituir heurística abaixo por consulta real ao
      // DynamoDB via context.queryAlertsByCnpj quando o GSI secretaria-cnpj estiver
      // disponível (MIT-02). A heurística atual só detecta concentração dentro do
      // mesmo excerpt — útil para publicações em lote, mas não para série temporal.
      //
      // Lógica MVP: se houver >= CONCENTRACAO_MIN_CONTRATOS do mesmo CNPJ para a
      // mesma secretaria dentro do mesmo excerpt, emite concentracao_fornecedor.

      if (secretaria && cnpjs.length >= CONCENTRACAO_MIN_CONTRATOS) {
        // Conta ocorrências do CNPJ mais frequente
        const contagem: Record<string, number> = {}
        for (const cnpj of cnpjs) {
          contagem[cnpj] = (contagem[cnpj] ?? 0) + 1
        }

        for (const [cnpj, qtd] of Object.entries(contagem)) {
          if (qtd >= CONCENTRACAO_MIN_CONTRATOS) {
            const riskFactorsConc: RiskFactor[] = [
              {
                type: 'concentracao_quantidade',
                weight: 0.55,
                value: Math.min(100, qtd * 20),
                description: `${qtd} contratos do CNPJ ${cnpj} na ${secretaria} no mesmo período`,
              },
              {
                type: 'confianca_extracao',
                weight: 0.25,
                value: extractResult.confidence * 100,
                description: 'Confiança da extração de entidades',
              },
              {
                type: 'dados_completos',
                weight: 0.20,
                value: secretaria ? 80 : 40,
                description: 'Secretaria identificada no excerpt',
              },
            ]

            const scoreResultConc = await scoreRisk.execute({ factors: riskFactorsConc })
            const riskScoreConc = scoreResultConc.data

            const findingConc: Finding = {
              fiscalId: FISCAL_ID,
              cityId,
              type: 'concentracao_fornecedor',
              riskScore: riskScoreConc,
              confidence: Math.min(extractResult.confidence, 0.75),
              evidence: [
                {
                  source: gazette.url,
                  excerpt,
                  date: gazette.date,
                },
              ],
              narrative: narrativaConcentracao(secretaria, cnpj, qtd),
              legalBasis: 'Lei 14.133/2021, Art. 11, §2º (competição e isonomia)',
              cnpj,
              secretaria,
              createdAt: now.toISOString(),
            }

            findings.push(findingConc)
          }
        }
      }
    }

    return findings
  },
}
