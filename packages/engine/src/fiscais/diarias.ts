import { saveMemory } from '../skills/save_memory'
import { scoreRisk } from '../skills/score_risk'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const FISCAL_ID = 'fiscal-diarias'
const ALERTS_TABLE_DEFAULT = 'fiscal-digital-alerts-prod'

// ─── Limiar configurável ──────────────────────────────────────────────────────
//
// Threshold de valor de diária acima do qual é gerado finding por excesso.
// Referência: diárias municipais típicas variam de R$ 100 a R$ 800/dia.
// Valor acima de R$ 1.500/dia (sem destino justificado) é tratado como indício.
// TODO(diarias): parametrizar por cidade quando regulamentação local estiver
// catalogada (Decretos Municipais variam — Caxias do Sul, Porto Alegre, etc.).
export const DIARIA_VALOR_LIMITE = 1500.00

// ─── Regex etapa 1 (filtro sem LLM) ───────────────────────────────────────────

const DIARIA_RE = /\b(di[áa]ria(?:s)?|viagem|deslocamento)\b/i

// ─── Regex de extração ────────────────────────────────────────────────────────

// Data brasileira DD/MM/YYYY ou DD/MM/YY
const DATA_BR_RE = /\b(\d{2})\/(\d{2})\/(\d{2,4})\b/g

// Valores em reais. Aceita "R$ 1.500,00", "R$1500", "R$ 1.500,50".
const VALOR_RE = /R\$\s*([\d.]+(?:,\d{1,2})?)/gi

// ─── Calendário de feriados nacionais (2024–2028) ─────────────────────────────
//
// Hardcoded para evitar dependência externa. Inclui feriados fixos e variáveis
// (Carnaval = segunda+terça, Sexta da Paixão, Páscoa, Corpus Christi).
// TODO(diarias): atualizar tabela em janeiro de cada ano para manter cobertura.
//
// Páscoa (referência) — todas as datas variáveis derivam dela:
//   2024: 31/03 | 2025: 20/04 | 2026: 05/04 | 2027: 28/03 | 2028: 16/04
//
// Carnaval (segunda + terça antes da Quarta-feira de Cinzas = 47 dias antes da Páscoa)
// Sexta da Paixão = 2 dias antes da Páscoa
// Corpus Christi = 60 dias depois da Páscoa
//
// Datas em formato YYYY-MM-DD para comparação direta com gazette.date.
export const FERIADOS_NACIONAIS: ReadonlySet<string> = new Set<string>([
  // 2024
  '2024-01-01', // Confraternização Universal
  '2024-02-12', // Carnaval (segunda)
  '2024-02-13', // Carnaval (terça)
  '2024-03-29', // Sexta da Paixão
  '2024-04-21', // Tiradentes
  '2024-05-01', // Dia do Trabalho
  '2024-05-30', // Corpus Christi
  '2024-09-07', // Independência
  '2024-10-12', // N. Sra. Aparecida
  '2024-11-02', // Finados
  '2024-11-15', // Proclamação da República
  '2024-11-20', // Dia da Consciência Negra (Lei 14.759/2023)
  '2024-12-25', // Natal

  // 2025
  '2025-01-01',
  '2025-03-03', // Carnaval (segunda)
  '2025-03-04', // Carnaval (terça)
  '2025-04-18', // Sexta da Paixão
  '2025-04-21', // Tiradentes
  '2025-05-01',
  '2025-06-19', // Corpus Christi
  '2025-09-07',
  '2025-10-12',
  '2025-11-02',
  '2025-11-15',
  '2025-11-20',
  '2025-12-25',

  // 2026
  '2026-01-01',
  '2026-02-16', // Carnaval (segunda)
  '2026-02-17', // Carnaval (terça)
  '2026-04-03', // Sexta da Paixão
  '2026-04-21',
  '2026-05-01',
  '2026-06-04', // Corpus Christi
  '2026-09-07',
  '2026-10-12',
  '2026-11-02',
  '2026-11-15',
  '2026-11-20',
  '2026-12-25',

  // 2027
  '2027-01-01',
  '2027-02-08', // Carnaval (segunda)
  '2027-02-09', // Carnaval (terça)
  '2027-03-26', // Sexta da Paixão
  '2027-04-21',
  '2027-05-01',
  '2027-05-27', // Corpus Christi
  '2027-09-07',
  '2027-10-12',
  '2027-11-02',
  '2027-11-15',
  '2027-11-20',
  '2027-12-25',

  // 2028
  '2028-01-01',
  '2028-02-28', // Carnaval (segunda)
  '2028-02-29', // Carnaval (terça)
  '2028-04-14', // Sexta da Paixão
  '2028-04-21',
  '2028-05-01',
  '2028-06-15', // Corpus Christi
  '2028-09-07',
  '2028-10-12',
  '2028-11-02',
  '2028-11-15',
  '2028-11-20',
  '2028-12-25',
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Converte data brasileira (DD/MM/YYYY ou DD/MM/YY) para ISO (YYYY-MM-DD).
 * Retorna null se inválida (mês > 12, dia > 31, ano < 2000 ou > 2099 em formato 4d).
 * Se ano vier com 2 dígitos, assume século XXI (20YY).
 */
export function parseDataBR(dia: string, mes: string, ano: string): string | null {
  const d = Number(dia)
  const m = Number(mes)
  let y = Number(ano)

  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null
  if (m < 1 || m > 12) return null
  if (d < 1 || d > 31) return null

  if (ano.length === 2) y = 2000 + y
  if (y < 2000 || y > 2099) return null

  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
}

/**
 * Detecta se uma data ISO (YYYY-MM-DD) é fim de semana (sábado/domingo).
 * Usa getUTCDay para evitar drift de timezone.
 */
export function isFimDeSemana(dataISO: string): boolean {
  const dia = new Date(`${dataISO}T12:00:00.000Z`).getUTCDay()
  return dia === 0 || dia === 6
}

/**
 * Detecta se uma data ISO é feriado nacional reconhecido (calendário hardcoded).
 */
export function isFeriadoNacional(dataISO: string): boolean {
  return FERIADOS_NACIONAIS.has(dataISO)
}

/**
 * Extrai todas as datas brasileiras de um excerpt em formato ISO.
 */
function extrairDatas(excerpt: string): string[] {
  const matches = [...excerpt.matchAll(DATA_BR_RE)]
  const datas: string[] = []
  for (const m of matches) {
    const iso = parseDataBR(m[1], m[2], m[3])
    if (iso) datas.push(iso)
  }
  return datas
}

/**
 * Extrai o maior valor monetário (R$) do excerpt — heurística para diária com valor.
 * Retorna 0 se nenhum valor for encontrado.
 */
function extrairMaiorValor(excerpt: string): number {
  const matches = [...excerpt.matchAll(VALOR_RE)]
  let max = 0
  for (const m of matches) {
    // "1.500,50" → "1500.50"
    const numStr = m[1].replace(/\./g, '').replace(',', '.')
    const v = Number(numStr)
    if (Number.isFinite(v) && v > max) max = v
  }
  return max
}

/**
 * Heurística simples: presença de termo de justificativa para diária em FdS/feriado.
 * Não é definitiva — apenas reduz risco quando explicitamente justificada.
 */
function temJustificativaExplicita(excerpt: string): boolean {
  return /\b(justifica(?:tiv[ao]|do|da)|emerg[êe]ncia|plant[ãa]o|urg[êe]ncia|inadi[áa]vel)\b/i.test(
    excerpt,
  )
}

// ─── Fiscal de Diárias ────────────────────────────────────────────────────────

export const fiscalDiarias: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta pagamento de diárias em finais de semana ou feriados sem justificativa explícita ' +
    'e diárias com valor acima do limite indiciário (R$ 1.500/dia). ' +
    'Base legal: Lei 8.112/90, Art. 58 (servidores federais — aplicável análoga municipal).',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const alertsTable = context.alertsTable ?? ALERTS_TABLE_DEFAULT
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM)
    const relevantExcerpts = gazette.excerpts.filter(e => DIARIA_RE.test(e))
    if (relevantExcerpts.length === 0) return []

    for (const excerpt of relevantExcerpts) {
      // Etapa 2 — Extração de datas e valor
      const datas = extrairDatas(excerpt)
      const valor = extrairMaiorValor(excerpt)
      const dataReferencia = datas[0] ?? gazette.date

      const fimDeSemana = isFimDeSemana(dataReferencia)
      const feriado = isFeriadoNacional(dataReferencia)
      const fdsOuFeriado = fimDeSemana || feriado
      const justificada = temJustificativaExplicita(excerpt)
      const acimaLimite = valor > DIARIA_VALOR_LIMITE

      // Sem nenhum dos gatilhos → não persiste, não emite finding
      if (!fdsOuFeriado && !acimaLimite) continue

      // Persistência base — todas as diárias rastreadas vão para o histórico
      // (útil para futura análise de concentração por servidor).
      // Nunca grava NULL em GSI keys (LRN-019): omitir campos ausentes.
      const diariaItem: Record<string, unknown> = {
        fiscalId: FISCAL_ID,
        cityId,
        actType: 'diaria',
        dataReferencia,
        ...(valor > 0 && { valor }),
        fimDeSemana,
        feriado,
        justificada,
        gazetteUrl: gazette.url,
        gazetteDate: gazette.date,
        createdAt: now.toISOString(),
      }

      const diariaPk = `DIARIA#${gazette.id}#${dataReferencia}#${valor || 'NOVAL'}`

      const saveMemoryFn = context.saveMemory ?? saveMemory
      await saveMemoryFn.execute({
        pk: diariaPk,
        table: alertsTable,
        item: diariaItem,
      })

      // ── Detecção 1: diária em fim de semana / feriado sem justificativa ────
      if (fdsOuFeriado && !justificada) {
        const motivo = feriado ? 'feriado nacional' : (isFimDeSemana(dataReferencia) ? (new Date(`${dataReferencia}T12:00:00.000Z`).getUTCDay() === 0 ? 'domingo' : 'sábado') : 'fim de semana')

        const riskFactors: RiskFactor[] = [
          {
            type: 'data_nao_util',
            weight: 0.6,
            value: feriado ? 75 : 65,
            description: `Diária com data de referência em ${motivo} (${formatDate(dataReferencia)})`,
          },
          {
            type: 'sem_justificativa',
            weight: 0.4,
            value: 60,
            description: 'Excerpt não cita justificativa, emergência ou plantão',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data
        const confidence = datas.length > 0 ? 0.75 : 0.6

        const valorTexto = valor > 0 ? ` no valor de R$ ${formatBRL(valor)}` : ''
        const narrativa =
          `Identificamos pagamento de diária${valorTexto} com data de referência em ` +
          `${formatDate(dataReferencia)} (${motivo}), publicada na gazette de ` +
          `${formatDate(gazette.date)}. O documento não aponta justificativa explícita ` +
          `(emergência, plantão ou inadiável). Diária é compensação por deslocamento em serviço ` +
          `(Lei 8.112/90, Art. 58, aplicada por analogia em âmbito municipal).`

        findings.push({
          fiscalId: FISCAL_ID,
          cityId,
          type: 'diaria_irregular',
          riskScore,
          confidence,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: narrativa,
          legalBasis: 'Lei 8.112/90, Art. 58',
          ...(valor > 0 && { value: valor }),
          createdAt: now.toISOString(),
        })
      }

      // ── Detecção 2: valor acima do limite indiciário ───────────────────────
      if (acimaLimite) {
        const excessoPct = ((valor - DIARIA_VALOR_LIMITE) / DIARIA_VALOR_LIMITE) * 100

        const riskFactors: RiskFactor[] = [
          {
            type: 'valor_acima_limite',
            weight: 0.7,
            value: Math.min(100, 60 + excessoPct),
            description:
              `Valor R$ ${formatBRL(valor)} excede limite indiciário de ` +
              `R$ ${formatBRL(DIARIA_VALOR_LIMITE)}/diária`,
          },
          {
            type: 'data_referencia',
            weight: 0.3,
            value: fdsOuFeriado ? 80 : 50,
            description: fdsOuFeriado
              ? 'Data de referência em dia não útil agrava o indício'
              : 'Data de referência em dia útil',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data
        const confidence = 0.7

        const narrativa =
          `Identificamos pagamento de diária no valor de R$ ${formatBRL(valor)}, ` +
          `acima do limite indiciário de R$ ${formatBRL(DIARIA_VALOR_LIMITE)}, ` +
          `com data de referência ${formatDate(dataReferencia)}. ` +
          `O documento aponta gasto que requer verificação do Decreto Municipal de diárias ` +
          `(limites variam por cidade). Lei 8.112/90, Art. 58 aplicada por analogia.`

        findings.push({
          fiscalId: FISCAL_ID,
          cityId,
          type: 'diaria_irregular',
          riskScore,
          confidence,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: narrativa,
          legalBasis: 'Lei 8.112/90, Art. 58',
          value: valor,
          createdAt: now.toISOString(),
        })
      }
    }

    return findings
  },
}

// Re-export para uso em testes (evitar ambiguidade de import)
export type { FiscalContext }
