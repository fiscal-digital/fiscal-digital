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

// ── BUG-FSC-005: exceção legal ALEGADA (informar, não suprimir) ───────────────
// A exceção do Art. 73, VI, "b" (grave e urgente necessidade pública) só afasta
// a vedação quando "assim reconhecida pela Justiça Eleitoral" — o texto oficial
// lido no legal-corpus (lei-9504-1997/art-73.md). Um contrato que apenas INVOCA
// caráter emergencial/calamidade ou campanha de saúde NÃO comprova a exceção;
// suprimir por essas palavras geraria falso-negativo (violação disfarçada).
// Decisão do Diego 2026-07-21: manter o finding e anotar a exceção na narrativa.
// Nota: o golden set de fiscal-digital-evaluations rotula estes casos como
// no_finding citando "Art. 73 §3º" — o §3º trata da esfera administrativa em
// disputa, não cria exceção de saúde/calamidade (mis-citação; ADR à parte).
const EXCECAO_EMERGENCIAL_RE =
  /\b(?:calamidade\s+p[úu]blica|estado\s+de\s+emerg[êe]ncia|contrata[çc][ãa]o\s+emergencial|car[áa]ter\s+emergencial)\b/i
const EXCECAO_SAUDE_RE =
  /\bcampanha\s+(?:educativa|informativa|de\s+orienta[çc][ãa]o(?:\s+social)?)\b[\s\S]{0,120}\b(?:sa[úu]de|vacina[çc][ãa]o|vacine|SUS|UBS|dengue|influenza|sarampo|HPV|imuniza[çc][ãa]o)\b/i

/** Retorna o tipo de exceção alegada no excerpt, ou null. */
function excecaoAlegada(excerpt: string): 'emergencial' | 'saude' | null {
  if (EXCECAO_EMERGENCIAL_RE.test(excerpt)) return 'emergencial'
  if (EXCECAO_SAUDE_RE.test(excerpt)) return 'saude'
  return null
}

// ── Filtros de exclusão (ADR-001 — patch 2026-05-10) ────────────────────────
// Padrões identificados nos 6 FPs originais (Ciclo 1+2, universo esgotado n=23).
// Reduz overmatch sistemático em "divulgação", header do DO, designação fiscal,
// publicação legal obrigatória, concessão patrimonial.

const STOPWORDS_PUBLICIDADE: ReadonlyArray<RegExp> = [
  // Cabeçalho do Diário Oficial (não é contratação).
  // Nota: \b não funciona antes de "Órgão" porque "Ó" não está na classe word
  // ASCII do JavaScript — usar (?:^|\s|[.,;:-]) como boundary alternativo.
  //
  // BUG-FSC-004: a versão anterior exigia "divulgação do município" e deixava
  // passar o boilerplate real "Órgão de divulgação oficial dos atos do
  // Município" (golden set SYN-PUB-FP-005/104..113 — todos escapavam; era a
  // maior fonte dos ~11 FPs da avaliação Ciclo 4 §4.2).
  /(?:^|[\s.,;:-])[óo]rg[ãa]o\s+de\s+divulga[çc][ãa]o\s+(?:oficial\s+)?(?:d[oa]s?\s+atos\s+)?d[oe]\s+(?:munic[íi]pio|estado)/i,
  /\bjornal\s+oficial\s+n[º°]/i,
  /\bpublica[çc][ãa]o\s+di[áa]ria\b/i,
  // Designação de Fiscal de Contrato (não é contratação publicitária)
  /\bdesigna(?:r|m)?\b[\s\S]{0,80}\bfiscal\s+(?:de\s+)?contrato\b/i,
  /\bDESIGNA\b[\s\S]{0,200}\bfiscalizar\b/i,
  /\bnomear\b[\s\S]{0,80}\bfiscal\s+de\s+contrato\b/i,
  // Publicação legal / obrigatória (Lei Orgânica, editais)
  /\ban[úu]ncios?\s+de\s+car[áa]ter\s+legal\b/i,
  /\bpublica[çc][ãa]o\s+(de\s+)?editais\b/i,
  /\bpublica[çc][ãa]o\s+legal\b/i,
  /\bin[sçc][êe]r[çc][õo]es?\s+em\s+di[áa]rios?\s+oficia[il]s?\b/i,
  /\bpresta[çc][ãa]o\s+de\s+contas\s+(trimestral|semestral|anual)\b/i,
  /\brelat[óo]rio\s+(trimestral|semestral|anual)\b/i,
  // Concessão patrimonial: município RECEBE outorga (operação inversa)
  /\bconcess[ãa]o\b[\s\S]{0,80}\boutdoor\b/i,
  /\boutorga\s+fixa\b/i,
  /\bBRASIL\s+OUTDOOR\b/i,
  // Atribuição funcional ("organização da divulgação do serviço")
  /\bdivulga[çc][ãa]o\s+do\s+servi[çc]o\b/i,
  // Outro padrão C2: "Fiscal" como cargo/sobrenome, não contratação publicitária
  /\bfiscais?\s+de\s+impress[ãa]o\b/i,
  // ── BUG-FSC-004 (avaliação Ciclo 4 §4.2 — vazamento de contexto) ──────────
  // Decreto orçamentário: "Abre crédito ..." com linha "Publicidade Oficial" é
  // remanejamento de dotação, não contratação (golden set SYN-PUB-FP-104..113).
  /\babre\s+cr[ée]dito\s+(?:suplementar|especial|adicional|extraordin[áa]rio)\b/i,
  /\bdota[çc][ãa]o\s+or[çc]ament[áa]ri/i,
  /\b(?:elemento|natureza)\s+d[ea]\s+despesa\b/i,
  // Sumário/índice do diário: lista de seções cita "Publicidade" com nº de página
  /\bsum[áa]rio\b[\s\S]{0,200}\bp[áa]g(?:\.|ina)/i,
  // Seleção/processo seletivo de agentes de saúde (SESA/SGTES) — "divulgação"
  // do edital, não contratação publicitária
  /\b(?:processo\s+seletivo|sele[çc][ãa]o\s+p[úu]blica|edital\s+de\s+chamamento)\b[\s\S]{0,160}\bagentes?\s+(?:comunit[áa]rios?\s+)?de\s+sa[úu]de\b/i,
  // Concessão de exploração de jogos/loteria (município outorga, não contrata mídia)
  /\bconcess[ãa]o\b[\s\S]{0,100}\b(?:jogos|loteria)\b/i,
  // Concessão de mobiliário urbano p/ exploração publicitária: o município
  // RECEBE outorga (receita patrimonial), não contrata mídia — polaridade
  // invertida (golden set SYN-PUB-FP-094..099). O filtro `concessão…outdoor`
  // acima tem alcance de 80 chars e não cobre "mobiliário urbano … outdoors".
  /\bmobili[áa]rio\s+urbano\b/i,
  /\breceita\s+patrimonial\b/i,
]

function isPublicidadeExcluida(excerpt: string): boolean {
  return STOPWORDS_PUBLICIDADE.some(re => re.test(excerpt))
}

// ─── Janelas vedadas para publicidade institucional ──────────────────────────
//
// Lei 9.504/97, Art. 73, VI, "b": é vedada a publicidade institucional dos atos,
// programas, obras, serviços e campanhas dos órgãos públicos nos 3 (três) meses
// que antecedem o pleito, exceto comunicações estritamente necessárias por
// grave e urgente necessidade pública (com autorização da Justiça Eleitoral).
//
// Janela vedada: os 3 meses que ANTECEDEM o pleito — [inicio, eleicao).
//
// BUG-FSC-003: a janela ia até 31/12 do ano eleitoral ("cobre segundo turno e
// transição"), mas o texto legal veda publicidade nos meses que antecedem o
// pleito — gazettes de nov/dez pós-eleição viravam FP com narrativa afirmando
// "dentro da janela de 3 meses antes da eleição" (avaliação Ciclo 4 §4.2).

interface JanelaVedada {
  inicio: string  // YYYY-MM-DD (inclusive) — 3 meses antes da eleição
  eleicao: string // data da eleição (1º turno) — fim EXCLUSIVO da janela
}

/**
 * Janelas vedadas de publicidade institucional para eleições municipais.
 * Hardcoded para 2024, 2026 e 2028 (eleições no 1º domingo de outubro).
 *
 * O início da janela é exatamente "3 meses antes" do 1º turno; o fim é a
 * véspera do pleito (a vedação alcança o período que ANTECEDE a eleição).
 *
 * TODO: parametrizar via config quando cobrir eleições estaduais (anos ímpares).
 */
const JANELAS_VEDADAS_PUBLICIDADE: JanelaVedada[] = [
  { inicio: '2024-07-06', eleicao: '2024-10-06' },
  { inicio: '2026-07-04', eleicao: '2026-10-04' },
  { inicio: '2028-07-01', eleicao: '2028-10-01' },
]

function dentroJanelaVedada(dateISO: string): JanelaVedada | null {
  for (const janela of JANELAS_VEDADAS_PUBLICIDADE) {
    if (dateISO >= janela.inicio && dateISO < janela.eleicao) {
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
    'Detecta gastos com publicidade institucional dentro da janela vedada (os 3 meses ' +
    'que antecedem o pleito) e menções promocionais ao alcaide em mídia paga no ' +
    'período eleitoral. Base legal: Lei 9.504/97, Art. 73, VI, "b" e VII.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — filtro regex: descarta excerpts sem termos de publicidade
    // e excerpts identificados como FP sistemático (ADR-001):
    //   - Header do Diário Oficial ("Órgão de divulgação", "Jornal Oficial nº")
    //   - Designação de Fiscal de Contrato
    //   - Publicação legal/obrigatória (anúncios de caráter legal, editais)
    //   - Concessão patrimonial (município recebe outorga, operação inversa)
    //   - Atribuição funcional ("organização da divulgação do serviço")
    const relevantExcerpts = gazette.excerpts.filter(e => {
      if (!PUBLICIDADE_RE.test(e)) return false
      if (isPublicidadeExcluida(e)) return false
      return true
    })
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
            `(${formatDate(janela.inicio)} até a véspera da eleição de ` +
            `${formatDate(janela.eleicao)})`,
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

      // BUG-FSC-005: exceção alegada → informar, não suprimir. A exceção do
      // Art. 73, VI, "b" só afasta a vedação se reconhecida pela Justiça
      // Eleitoral; o documento invocá-la não a comprova.
      const excecao = excecaoAlegada(excerpt)
      const notaExcecao = excecao === 'emergencial'
        ? ' O documento invoca caráter emergencial ou de calamidade pública. ' +
          'A exceção do Art. 73, VI, "b" só afasta a vedação quando a grave e urgente ' +
          'necessidade pública é reconhecida pela Justiça Eleitoral — recomenda-se ' +
          'verificar a existência dessa autorização específica.'
        : excecao === 'saude'
          ? ' O documento descreve campanha educativa de saúde pública. ' +
            'Campanhas dessa natureza podem ser admitidas, mas a exceção depende de ' +
            'reconhecimento pela Justiça Eleitoral e de ausência de promoção pessoal ' +
            '(Art. 73, §1º) — recomenda-se verificação.'
          : ''

      const narrativa = (mencionaPrefeito
        ? baseNarrativa +
          ' O excerpt menciona o(a) prefeito(a) ou a gestão municipal — ' +
          'Art. 73, VII também veda uso promocional em favor de candidato.'
        : baseNarrativa) + notaExcecao

      // confidence: alta quando valor é conhecido; reduzida quando inferida.
      // BUG-FSC-005: exceção alegada fixa a confiança logo ABAIXO do gate de
      // publicação (DEFAULT 0.70). O finding é persistido e visível na API/feed
      // com a narrativa completa (não-supressão), mas não AUTO-publica um caso
      // limítrofe — revisão humana decide. Equilíbrio "não acusar / informar".
      const confidenceBase = valorConhecido ? 0.80 : 0.72
      const confidence = excecao ? 0.69 : confidenceBase

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
