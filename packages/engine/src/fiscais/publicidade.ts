import { extractValues } from '../regex'
import { scoreRisk } from '../skills/score_risk'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput } from './types'

const FISCAL_ID = 'fiscal-publicidade'

// ─── Regex de filtro etapa 1 ──────────────────────────────────────────────────
//
// Termos que indicam contratação/execução de serviços de publicidade institucional,
// propaganda e mídia paga. Escolha conservadora — match exige um dos termos abaixo
// para que a etapa 2 (extração de valor + janela eleitoral) seja executada.

// Calibração 2026-05-02: regex expandida para capturar variantes comuns em gazettes
// brasileiras, como "campanhas educativas", "comunicação social", "agência de propaganda",
// "marketing institucional". Conservador o suficiente para evitar falsos positivos
// (sempre exige CONTRATACAO_RE também na etapa 3).
const PUBLICIDADE_RE =
  /\b(?:publicidade|propaganda|divulga[çc][ãa]o|inser[çc][ãaõo](?:es)?|m[íi]dia|an[úu]ncio(?:s)?|veicula[çc][ãa]o|campanha(?:s)?\s+(?:educativ[ao]s?|publicit[áa]ri[ao]s?|institucion[ai][il]s?|de\s+(?:divulga[çc][ãa]o|comunica[çc][ãa]o))|comunica[çc][ãa]o\s+social|marketing(?:\s+institucional)?|ag[êe]ncia\s+de\s+(?:propaganda|publicidade|comunica[çc][ãa]o)|ve[íi]culo\s+de\s+comunica[çc][ãa]o|spots?\s+publicit[áa]rios?|outdoor(?:s)?|busdoor(?:s)?|painel\s+publicit[áa]rio|jornal\s+oficial|r[áa]dio\s+(?:cidade|comunit[áa]ria)|emissora\s+de\s+(?:r[áa]dio|tv|televis[ãa]o))\b/i

// Indicadores de contratação onerosa — ajuda a separar "publicidade institucional"
// real de menções incidentais (ex: "secretaria de comunicação" sem contrato).
const CONTRATACAO_RE =
  /\b(?:contrata[çc][ãa]o|contrato|empenho|nota\s+de\s+empenho|aditivo|dispensa\s+de\s+licita[çc][ãa]o|inexigibilidade|adjudica[çc][ãa]o|homologa[çc][ãa]o|pagamento|despesa)\b/i

// Menção promocional ao alcaide / prefeito — agrava o risco quando dentro da janela.
// Não dispara sozinho; é fator multiplicador.
const NOME_PREFEITO_RE =
  /\b(?:prefeit[oa](?:\s+municipal)?|alcaide|gest[ãa]o(?:\s+municipal)?|administra[çc][ãa]o\s+do\s+prefeit[oa])\b/i

// ─── Janelas vedadas para publicidade institucional ──────────────────────────
//
// Lei 9.504/97, Art. 73, VI, "b": é vedada a publicidade institucional dos atos,
// programas, obras, serviços e campanhas dos órgãos públicos nos 3 (três) meses
// que antecedem o pleito, exceto comunicações estritamente necessárias por
// grave e urgente necessidade pública (com autorização da Justiça Eleitoral).
//
// Janela vedada: ~3 meses antes da eleição até o final do ano da eleição
// (cobre também o segundo turno e o período de transição até a posse em 1º/01).

interface JanelaVedada {
  inicio: string  // YYYY-MM-DD (inclusive) — 3 meses antes da eleição
  fim: string     // YYYY-MM-DD (inclusive) — 31 de dezembro do ano eleitoral
  eleicao: string // data da eleição (1º turno)
}

/**
 * Janelas vedadas de publicidade institucional para eleições municipais.
 * Hardcoded para 2024, 2026 e 2028 (eleições no 1º domingo de outubro).
 *
 * O início da janela é exatamente "3 meses antes" do 1º turno.
 * O fim é 31/12 do ano eleitoral — após a posse (1º/01) reabre.
 *
 * TODO: parametrizar via config quando cobrir eleições estaduais (anos ímpares).
 */
const JANELAS_VEDADAS_PUBLICIDADE: JanelaVedada[] = [
  { inicio: '2024-07-06', fim: '2024-12-31', eleicao: '2024-10-06' },
  { inicio: '2026-07-04', fim: '2026-12-31', eleicao: '2026-10-04' },
  { inicio: '2028-07-01', fim: '2028-12-31', eleicao: '2028-10-01' },
]

function dentroJanelaVedada(dateISO: string): JanelaVedada | null {
  for (const janela of JANELAS_VEDADAS_PUBLICIDADE) {
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

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Threshold mínimo de valor para disparar finding em janela vedada.
 * Qualquer contratação publicitária acima desse valor na janela é flag.
 *
 * R$ 1,00 efetivamente significa "qualquer contratação onerosa" — calibrado
 * para baixo porque a vedação é absoluta dentro da janela (exceções dependem
 * de autorização específica da Justiça Eleitoral, que não é detectável por
 * regex). Falsos positivos são mitigados pelo filtro CONTRATACAO_RE.
 */
const VALOR_MINIMO_PUBLICIDADE = 1

// ─── Fiscal de Publicidade ────────────────────────────────────────────────────

export const fiscalPublicidade: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta gastos com publicidade institucional dentro da janela vedada (3 meses ' +
    'antes da eleição até 31/12 do ano eleitoral) e menções promocionais ao alcaide ' +
    'em mídia paga no período eleitoral. Base legal: Lei 9.504/97, Art. 73, VI, "b" e VII.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — filtro regex: descarta excerpts sem termos de publicidade
    const relevantExcerpts = gazette.excerpts.filter(e => PUBLICIDADE_RE.test(e))
    if (relevantExcerpts.length === 0) {
      return []
    }

    // Etapa 2 — só faz sentido analisar se a gazette está dentro da janela vedada
    const janela = dentroJanelaVedada(gazette.date)
    if (!janela) {
      return []
    }

    for (const excerpt of relevantExcerpts) {
      // Etapa 3 — exigir indicador de contratação onerosa
      const temContratacao = CONTRATACAO_RE.test(excerpt)
      if (!temContratacao) continue

      // Etapa 4 — extrair valor declarado (se houver). Usa o maior valor
      // mencionado no excerpt como aproximação.
      const valores = extractValues(excerpt)
      const valorMaximo = valores.length > 0 ? Math.max(...valores) : 0

      // Threshold: qualquer contratação publicitária na janela vedada >= R$ 1,00.
      // Quando o valor não está no excerpt, ainda assim disparamos com confidence
      // menor — vedação é absoluta dentro da janela.
      const valorConhecido = valorMaximo >= VALOR_MINIMO_PUBLICIDADE
      const mencionaPrefeito = NOME_PREFEITO_RE.test(excerpt)

      // ── Padrão 1: contratação publicitária em janela vedada (Art. 73, VI, "b")
      const riskFactors: RiskFactor[] = [
        {
          type: 'janela_vedada_publicidade',
          weight: 0.5,
          value: 90,
          description:
            `Gazette de ${formatDate(gazette.date)} dentro da janela vedada ` +
            `(${formatDate(janela.inicio)} – ${formatDate(janela.fim)}, ` +
            `eleição ${formatDate(janela.eleicao)})`,
        },
        {
          type: 'contratacao_publicitaria_detectada',
          weight: 0.3,
          value: 80,
          description: 'Termos de publicidade/propaganda + contratação onerosa presentes no excerpt',
        },
        {
          type: 'valor_publicitario',
          weight: 0.2,
          value: valorConhecido ? Math.min(100, 60 + Math.floor(valorMaximo / 10000)) : 50,
          description: valorConhecido
            ? `Valor identificado: ${formatBRL(valorMaximo)}`
            : 'Valor não identificado no excerpt — fallback informativo',
        },
      ]

      const scoreResult = await scoreRisk.execute({ factors: riskFactors })
      const riskScore = scoreResult.data

      const baseNarrativa =
        `Identificamos contratação ou execução de publicidade institucional em gazette de ` +
        `${formatDate(gazette.date)}, dentro da janela vedada de 3 meses antes da eleição ` +
        `(eleição prevista para ${formatDate(janela.eleicao)}). ` +
        (valorConhecido
          ? `O documento aponta valor de ${formatBRL(valorMaximo)}. `
          : 'O documento não detalha valor explícito no excerpt analisado. ') +
        `Lei 9.504/97, Art. 73, VI, "b" veda publicidade institucional no período, ` +
        `salvo grave e urgente necessidade pública autorizada pela Justiça Eleitoral.`

      const narrativa = mencionaPrefeito
        ? baseNarrativa +
          ' O excerpt menciona o(a) prefeito(a) ou a gestão municipal — ' +
          'Art. 73, VII também veda uso promocional em favor de candidato.'
        : baseNarrativa

      // confidence: alta quando valor é conhecido; reduzida quando inferida.
      const confidence = valorConhecido ? 0.80 : 0.72

      const finding: Finding = {
        fiscalId: FISCAL_ID,
        cityId,
        type: 'publicidade_eleitoral',
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
        legalBasis: mencionaPrefeito
          ? 'Lei 9.504/97, Art. 73, VI, "b" e VII'
          : 'Lei 9.504/97, Art. 73, VI, "b"',
        // LRN-019: NUNCA gravar NULL em GSI keys — usar omissão condicional
        ...(valorConhecido && { value: valorMaximo }),
        createdAt: now.toISOString(),
      }

      findings.push(finding)
    }

    return findings
  },
}
