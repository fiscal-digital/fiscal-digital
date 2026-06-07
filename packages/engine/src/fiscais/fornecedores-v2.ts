/**
 * FiscalFornecedores v2 — Concentração 12m via GSI2 (feature-flagged OFF por default).
 *
 * Diferenças em relação à v1:
 *
 * 1. **Concentração real por secretaria** (12 meses)
 *    v1 conta CNPJs duplicados no mesmo excerpt (heurística MVP — útil só em lotes).
 *    v2 consulta GSI2 `GSI2_ConcentracaoSecretaria` em `fiscal-digital-suppliers-prod`,
 *    agrega valores por CNPJ nos últimos 12 meses e dispara se ≥40% da secretaria.
 *    Isso captura fornecedor recorrente entre gazettes distintas — série temporal real.
 *
 * 2. **Score recalibrado**
 *    v1 usa apenas `concentracao_quantidade` (contratos). v2 adiciona o peso
 *    do valor financeiro (`concentracao_valor`) — fornecedor que domina 40% em
 *    valor é mais relevante do que 40% em número de contratos pequenos.
 *
 * 3. **Cache profile RFB**
 *    Mantém LRN-20260502-021: somente campos LLM-derived são cacheados; campos
 *    locais/regex (cnpj, valor, data) são sempre recomputados no cache hit.
 *    Nenhuma regressão — o código de cache já está em `extract_entities_cached.ts`.
 *
 * Ativação: somente quando SSM `/fiscal-digital/prod/enable-fiscal-fornecedores-v2 = true`.
 * Ativação via CLI (produção — APENAS após validação Ciclo 4 + canary Caxias):
 *   aws ssm put-parameter --overwrite \
 *     --name /fiscal-digital/prod/enable-fiscal-fornecedores-v2 --value true --type String
 *
 * LRN relevantes:
 *   - LRN-20260502-019: GSI key nunca ?? null — usar ...(value && { field: value })
 *   - LRN-20260502-021: cache merge LLM-derived only
 *   - LRN-20260503-022: requireEnv() em vez de process.env.X!
 */

import { extractEntities as defaultExtractEntities } from '../skills/extract_entities'
import { scoreRisk } from '../skills/score_risk'
import { validateCNPJ as defaultValidateCNPJ } from '../skills/validate_cnpj'
import { checkSanctions as defaultCheckSanctions } from '../skills/check_sanctions'
import { queryIndex } from '../utils/dynamodb'
import { createLogger } from '../logger'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const logger = createLogger('fiscal-fornecedores-v2')

const FISCAL_ID = 'fiscal-fornecedores'

// ── Limiares ─────────────────────────────────────────────────────────────────

const CNPJ_JOVEM_MESES = 12
const SITUACOES_IRREGULARES = new Set(['suspensa', 'inapta', 'baixada', 'nula'])

/** Janela de análise de concentração: últimos 12 meses */
const CONCENTRACAO_JANELA_MESES = 12

/** Limite percentual de concentração por secretaria (40%) */
const CONCENTRACAO_LIMITE = 0.40

/** Tabela de contratos por fornecedor — fonte para query GSI2 */
const SUPPLIERS_TABLE = process.env.SUPPLIERS_TABLE ?? 'fiscal-digital-suppliers-prod'

/**
 * Nome do GSI2 criado em feat/gsi2-concentracao-12m (Sonnet B).
 * Schema: hash_key=secretariaId, range_key=mesCNPJ (formato `YYYY-MM#CNPJ14`)
 */
const GSI2_NAME = 'GSI2_ConcentracaoSecretaria'

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

function mesesEntre(dataInicio: string, dataFim: string): number {
  const inicio = new Date(dataInicio)
  const fim = new Date(dataFim)
  return (
    (fim.getFullYear() - inicio.getFullYear()) * 12 +
    (fim.getMonth() - inicio.getMonth())
  )
}

/** Retorna `YYYY-MM` para o mês de início da janela (gazetteDate - 12 meses). */
function inicioJanela12m(gazetteDate: string): string {
  const d = new Date(gazetteDate)
  d.setMonth(d.getMonth() - CONCENTRACAO_JANELA_MESES)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

// ── GSI2 query ────────────────────────────────────────────────────────────────

export interface SecretariaContrato {
  cnpj14: string
  mesCNPJ: string   // YYYY-MM#CNPJ14
  valueAmount: number
  contractedAt: string
}

/**
 * Consulta GSI2 para listar todos os contratos de uma secretaria nos últimos 12m.
 *
 * GSI2_ConcentracaoSecretaria: hash_key=secretariaId, range_key=mesCNPJ (YYYY-MM#CNPJ14)
 * Retorna array de registros — ordenados por range_key (cronológico natural).
 *
 * LRN-20260502-019: secretariaId é PK do GSI2 — nunca pode ser undefined/null.
 * Caller DEVE garantir secretariaId não-vazio antes de chamar.
 */
export async function queryConcentracaoGSI2(
  secretariaId: string,
  gazetteDate: string,
  table: string = SUPPLIERS_TABLE,
): Promise<SecretariaContrato[]> {
  const inicio = inicioJanela12m(gazetteDate)
  const fimMes = gazetteDate.slice(0, 7) // YYYY-MM

  // Range: todos os mesCNPJ entre "YYYY-MM#" (inicio) e "YYYY-MM~" (fim).
  // O caractere `~` tem code point > todos os dígitos/letras de CNPJ,
  // garantindo que o range inclua todos os CNPJs do mês-fim.
  try {
    const items = await queryIndex(
      table,
      GSI2_NAME,
      '#secretariaId = :sid AND #mesCNPJ BETWEEN :inicio AND :fim',
      {
        '#secretariaId': 'secretariaId',
        '#mesCNPJ': 'mesCNPJ',
      },
      {
        ':sid': secretariaId,
        ':inicio': `${inicio}#`,
        ':fim': `${fimMes}~`,
      },
    )

    return items.map(item => ({
      cnpj14: String(item.cnpj14 ?? item.cnpj ?? ''),
      mesCNPJ: String(item.mesCNPJ ?? ''),
      valueAmount: typeof item.valueAmount === 'number' ? item.valueAmount : Number(item.valueAmount ?? 0),
      contractedAt: String(item.contractedAt ?? ''),
    })).filter(r => r.cnpj14.length > 0)
  } catch (err) {
    logger.warn('GSI2 query falhou — fallback sem dados históricos', {
      secretariaId,
      err: (err as Error).message,
    })
    return []
  }
}

/**
 * Agrega contratos por CNPJ (valor total e contagem) e calcula porcentagem
 * sobre o total da secretaria.
 *
 * Retorna mapa CNPJ14 → { totalValor, totalContratos, percentualValor }.
 * Exportada para facilitar testes unitários.
 */
export function agregarConcentracao(
  contratos: SecretariaContrato[],
): Map<string, { totalValor: number; totalContratos: number; percentualValor: number }> {
  const totalSecretaria = contratos.reduce((acc, c) => acc + c.valueAmount, 0)
  const porCnpj = new Map<string, { totalValor: number; totalContratos: number }>()

  for (const c of contratos) {
    const cur = porCnpj.get(c.cnpj14) ?? { totalValor: 0, totalContratos: 0 }
    cur.totalValor += c.valueAmount
    cur.totalContratos += 1
    porCnpj.set(c.cnpj14, cur)
  }

  const resultado = new Map<string, { totalValor: number; totalContratos: number; percentualValor: number }>()
  for (const [cnpj14, agg] of porCnpj) {
    resultado.set(cnpj14, {
      ...agg,
      percentualValor: totalSecretaria > 0 ? agg.totalValor / totalSecretaria : 0,
    })
  }
  return resultado
}

// ── Narrativas ────────────────────────────────────────────────────────────────

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

function narrativaConcentracao12m(
  secretaria: string,
  cnpj: string,
  totalContratos: number,
  totalValor: number,
  percentualValor: number,
): string {
  return (
    `Identificamos que o fornecedor CNPJ ${cnpj} recebeu R$ ${formatBRL(totalValor)} ` +
    `em ${totalContratos} ${totalContratos === 1 ? 'contrato' : 'contratos'} pela ${secretaria} ` +
    `nos últimos 12 meses, representando ${(percentualValor * 100).toFixed(1)}% do volume contratado ` +
    `pela secretaria no período. O documento aponta possível concentração de fornecedor acima ` +
    `do limite de ${(CONCENTRACAO_LIMITE * 100).toFixed(0)}% por secretaria ` +
    `(Lei 14.133/2021, Art. 11, §2º).`
  )
}

function narrativaSituacaoIrregular(
  gazetteDate: string,
  cnpj: string,
  situacao: string,
  razaoSocial: string | undefined,
  valor: number | undefined,
): string {
  const valorStr = valor !== undefined ? ` no valor de R$ ${formatBRL(valor)}` : ''
  const razaoStr = razaoSocial ? ` (${razaoSocial})` : ''
  return (
    `Identificamos contratação publicada em ${formatDate(gazetteDate)}${valorStr} ` +
    `com empresa CNPJ ${cnpj}${razaoStr} cuja situação cadastral na Receita Federal ` +
    `consta como "${situacao.toUpperCase()}" na data desta consulta. ` +
    `O documento aponta possível contratação com fornecedor em situação cadastral ` +
    `irregular, contrariando o Art. 14 da Lei 14.133/2021 que exige regularidade ` +
    `fiscal e trabalhista para habilitação.`
  )
}

function narrativaSancionado(
  gazetteDate: string,
  cnpj: string,
  razaoSocial: string | undefined,
  valor: number | undefined,
): string {
  const valorStr = valor !== undefined ? ` no valor de R$ ${formatBRL(valor)}` : ''
  const razaoStr = razaoSocial ? ` (${razaoSocial})` : ''
  return (
    `Identificamos contratação publicada em ${formatDate(gazetteDate)}${valorStr} ` +
    `com empresa CNPJ ${cnpj}${razaoStr} listada em base nacional de sanções ` +
    `(CEIS/CNEP — Cadastro de Empresas Inidôneas e Suspensas / Cadastro Nacional ` +
    `de Empresas Punidas, mantidos pela CGU). ` +
    `O documento aponta possível contratação com empresa impedida de contratar ` +
    `com a administração pública (Lei 12.846/2013, Lei 8.666/1993 Art. 87).`
  )
}

// ── FiscalContext v2 extension ─────────────────────────────────────────────────

/**
 * Extensão de FiscalContext para v2 — permite injetar queryConcentracaoGSI2 em testes.
 * Compatível com FiscalContext base (somente campos opcionais).
 */
export interface FiscalContextV2 extends FiscalContext {
  queryConcentracaoGSI2?: (
    secretariaId: string,
    gazetteDate: string,
    table?: string,
  ) => Promise<SecretariaContrato[]>
}

// ── Fiscal v2 ─────────────────────────────────────────────────────────────────

export const fiscalFornecedoresV2: Fiscal = {
  id: FISCAL_ID,
  description:
    'FiscalFornecedores v2: concentração 12m via GSI2_ConcentracaoSecretaria (secretariaId/mesCNPJ) ' +
    'em vez de heurística intra-excerpt. Score recalibrado com peso de valor financeiro. ' +
    'Feature flag: /fiscal-digital/prod/enable-fiscal-fornecedores-v2.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const contextV2 = context as FiscalContextV2
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex: excerpts com indício de contratação
    const relevantExcerpts = gazette.excerpts.filter(
      e => (CONTRATO_RE.test(e) || DISPENSA_RE.test(e) || PREGAO_RE.test(e)) && CNPJ_RE.test(e),
    )

    if (relevantExcerpts.length === 0) {
      return []
    }

    const extractFn = context.extractEntities ?? defaultExtractEntities
    const validateFn = context.validateCNPJ ?? defaultValidateCNPJ.execute.bind(defaultValidateCNPJ)
    const checkSanctionsFn = context.checkSanctions ?? defaultCheckSanctions.execute.bind(defaultCheckSanctions)

    // Acumula secretarias processadas para deduplicar queries GSI2 por gazette
    const secretariasProcessadas = new Set<string>()

    for (const excerpt of relevantExcerpts) {
      // Etapa 2 — Extração de entidades via LLM
      const extractResult = await extractFn.execute({
        text: excerpt,
        gazetteUrl: gazette.url,
      })

      const entities = extractResult.data
      const { cnpjs, values, secretaria } = entities

      if (cnpjs.length === 0) continue

      const valor = values[0]

      // ── Detecção CNPJ Jovem + Situação Irregular + Sanção ─────────────────
      // Idêntico à v1 — sem regressão nesses checks.

      for (const cnpj of cnpjs) {
        let dataAbertura: string | undefined
        let situacaoCadastral: string | undefined
        let razaoSocial: string | undefined

        try {
          const cnpjResult = await validateFn({ cnpj })
          dataAbertura = cnpjResult.data.dataAbertura
          situacaoCadastral = cnpjResult.data.situacaoCadastral
          razaoSocial = cnpjResult.data.razaoSocial
        } catch {
          // Falha de rede: skip silencioso
          continue
        }

        if (!dataAbertura || situacaoCadastral === 'nao_encontrado') {
          continue
        }

        // Situação Irregular (Lei 14.133, Art. 14)
        if (situacaoCadastral && SITUACOES_IRREGULARES.has(situacaoCadastral)) {
          findings.push({
            fiscalId: FISCAL_ID,
            cityId,
            type: 'cnpj_situacao_irregular',
            riskScore: 88,
            confidence: 0.92,
            evidence: [{ source: gazette.url, excerpt, date: gazette.date }],
            narrative: narrativaSituacaoIrregular(gazette.date, cnpj, situacaoCadastral, razaoSocial, valor),
            legalBasis: 'Lei 14.133/2021, Art. 14 (regularidade fiscal e trabalhista)',
            cnpj,
            ...(secretaria && { secretaria }),
            ...(valor !== undefined && { value: valor }),
            createdAt: now.toISOString(),
          })
        }

        // Sanção CGU (CEIS/CNEP)
        try {
          const sanctionResult = await checkSanctionsFn({ cnpj })
          if (sanctionResult.data?.sanctioned === true) {
            findings.push({
              fiscalId: FISCAL_ID,
              cityId,
              type: 'fornecedor_sancionado',
              riskScore: 95,
              confidence: 0.95,
              evidence: [{ source: gazette.url, excerpt, date: gazette.date }],
              narrative: narrativaSancionado(gazette.date, cnpj, razaoSocial, valor),
              legalBasis: 'Lei 12.846/2013 + Lei 8.666/1993 Art. 87 (CEIS/CNEP — CGU)',
              cnpj,
              ...(secretaria && { secretaria }),
              ...(valor !== undefined && { value: valor }),
              createdAt: now.toISOString(),
            })
          }
        } catch {
          // CGU offline: skip silencioso
        }

        // CNPJ Jovem (Lei 14.133, Art. 67)
        const meses = mesesEntre(dataAbertura, gazette.date)
        if (meses < CNPJ_JOVEM_MESES) {
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

          findings.push({
            fiscalId: FISCAL_ID,
            cityId,
            type: 'cnpj_jovem',
            riskScore: scoreResult.data,
            confidence: Math.min(extractResult.confidence, 0.90),
            evidence: [{ source: gazette.url, excerpt, date: gazette.date }],
            narrative: narrativaCnpjJovem(gazette.date, cnpj, dataAbertura, meses, valor),
            legalBasis: 'Lei 14.133/2021, Art. 67 (qualificação técnica e econômico-financeira)',
            cnpj,
            secretaria: secretaria ?? undefined,
            value: valor,
            createdAt: now.toISOString(),
          })
        }
      }

      // ── Detecção Concentração v2: query GSI2 (12 meses, série temporal real) ──
      //
      // v1 contava CNPJs repetidos no mesmo excerpt (heurística intra-gazette).
      // v2 consulta o DynamoDB suppliers-prod via GSI2_ConcentracaoSecretaria,
      // agregando o valor financeiro total por CNPJ nos últimos 12 meses.
      // Flag se percentual de valor >= CONCENTRACAO_LIMITE (40%).
      //
      // LRN-20260502-019: secretariaId é PK do GSI2 — nunca pode ser null/undefined.
      // Omitimos a query se secretaria não foi extraída pelo LLM.

      if (secretaria && !secretariasProcessadas.has(secretaria)) {
        secretariasProcessadas.add(secretaria)

        // Permite injeção de mock via context para testes (ver FiscalContextV2)
        const queryFn = contextV2.queryConcentracaoGSI2 ?? queryConcentracaoGSI2

        const contratos = await queryFn(secretaria, gazette.date, SUPPLIERS_TABLE)

        if (contratos.length > 0) {
          const concentracao = agregarConcentracao(contratos)
          const totalSecretaria = contratos.reduce((acc, c) => acc + c.valueAmount, 0)

          for (const [cnpj14, agg] of concentracao) {
            if (agg.percentualValor >= CONCENTRACAO_LIMITE) {
              // Score v2 recalibrado: concentracao_valor (novo, peso 0.50) é o
              // sinal dominante. concentracao_quantidade (0.30) e confianca_historico
              // (0.20) complementam. Essa calibração aumenta recall de fornecedores
              // que concentram valor sem necessariamente ter muitos contratos.
              const riskFactorsConc: RiskFactor[] = [
                {
                  type: 'concentracao_valor',
                  weight: 0.50,
                  value: Math.min(100, agg.percentualValor * 200), // 40% → 80, 50% → 100
                  description: `${(agg.percentualValor * 100).toFixed(1)}% do volume da ${secretaria} para CNPJ ${cnpj14} em 12 meses`,
                },
                {
                  type: 'concentracao_quantidade',
                  weight: 0.30,
                  value: Math.min(100, agg.totalContratos * 15),
                  description: `${agg.totalContratos} contratos do CNPJ ${cnpj14} na ${secretaria} em 12 meses`,
                },
                {
                  type: 'confianca_historico',
                  weight: 0.20,
                  value: Math.min(100, contratos.length * 10), // mais registros históricos = mais confiança
                  description: `Base histórica: ${contratos.length} registros na secretaria (12 meses)`,
                },
              ]

              const scoreResultConc = await scoreRisk.execute({ factors: riskFactorsConc })

              // LRN-20260502-019: todos os campos de GSI key (secretaria) nunca ?? null.
              // secretaria já foi validado como truthy acima (guard clause no if externo).
              findings.push({
                fiscalId: FISCAL_ID,
                cityId,
                type: 'concentracao_fornecedor',
                riskScore: scoreResultConc.data,
                confidence: Math.min(extractResult.confidence, 0.80),
                evidence: [{ source: gazette.url, excerpt: '', date: gazette.date }],
                narrative: narrativaConcentracao12m(
                  secretaria,
                  cnpj14,
                  agg.totalContratos,
                  agg.totalValor,
                  agg.percentualValor,
                ),
                legalBasis: 'Lei 14.133/2021, Art. 11, §2º (competição e isonomia)',
                cnpj: cnpj14,
                secretaria,
                value: totalSecretaria,
                createdAt: now.toISOString(),
              })

              logger.info('concentracao_fornecedor v2', {
                cityId,
                secretaria,
                cnpj14,
                percentualValor: agg.percentualValor,
                totalContratos: agg.totalContratos,
                totalValor: agg.totalValor,
              })
            }
          }
        }
      }
    }

    return findings
  },
}
