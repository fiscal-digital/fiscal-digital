import { scoreRisk } from '../skills/score_risk'
import { cityBucket, populationOf, type CityBucket } from '../cities/populations'
import { invokeModel, NARRATIVE_MODEL } from '../utils/bedrock'
import { getCityOrFallback } from '../cities'
import { createLogger } from '../logger'
import { getPublishThresholds } from '../thresholds'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput } from './types'

const FISCAL_ID = 'fiscal-pessoal'
const logger = createLogger(FISCAL_ID)

// ─── Regex de filtro etapa 1 ──────────────────────────────────────────────────

const NOMEACAO_RE = /nome(a[çc][ãa]o|ando|ado|ia)|designa[çc][ãa]o|exonera[çc][ãa]o/i
const COMISSAO_RE = /cargo\s+(?:em\s+)?comiss[ãa]o|cargo\s+comissionado/i

// ─── Filtros de exclusão (ADR-001 + padrões Ciclo 3) ─────────────────────────
// Padrões de FP descobertos no Ciclo 2/3 (n=708 amostras totais, 572 rotuladas).
// O Fiscal pula o excerpt ANTES de contar atos quando detecta qualquer um deles.

const STOPWORDS_PESSOAL: ReadonlyArray<RegExp> = [
  // (a) Comunicado de convocação para vaga — não é nomeação consumada (C3)
  /\bcomunicado\b[\s\S]{0,80}\bnomea[çc][ãa]o\s+sem\s+v[íi]nculo\s+efetivo\b/i,
  /\bcomunicado\s+de\s+convoca[çc][ãa]o\b/i,
  // (b) Vaga decorrente de exoneração/substituição individual — turnover normal (C3)
  /\bvaga\s+decorrente\s+(?:da\s+|de\s+)?exonera[çc][ãa]o\s+de\b/i,
  /\bsubstitui[çc][ãa]o\s+individual\b/i,
  // (c) Texto normativo mencionando "nomeação" como conceito jurídico (C3)
  /\bVEDA\s+A\s+NOMEA[ÇC][ÃA]O\s+PELA\s+ADMINISTRA[ÇC][ÃA]O\b/i,
  /\bLei\s+Maria\s+da\s+Penha\b/i,
  /\bC[óo]digo\s+de\s+\w+\s+veda\s+nomea[çc][ãa]o\b/i,
  // (d) Ratificação retroativa de ato antigo (ADR-001 GS-071)
  /\bratifica[çc][ãa]o\s+(retroativa|com\s+efeito\s+retroativo)\b/i,
  /\bratific\w+\b[\s\S]{0,40}\ba\s+contar\s+de\s+\d{1,2}\/\d{1,2}\/(?:19\d{2}|200[0-9]|201[0-9]|202[0-3])\b/i,
  // (e) Lei Complementar criando quadro funcional (C3)
  /\bLei\s+Complementar\s+n[º°.]?\s*\d+[\s\S]{0,100}\b(cria|disp[õo]e\s+sobre)\s+(?:o\s+)?quadro\s+(?:de\s+)?(funcion[áa]rios?|servidores?|cargos)\b/i,
  /\bOrganiza[çc][ãa]o\s+da\s+Administra[çc][ãa]o\s+Direta\s+do\s+Poder\s+Executivo\b/i,
  // (f) "Tornar sem efeito" — anulação em massa, não nova nomeação (C3)
  /\btornar\s+sem\s+efeito\b[\s\S]{0,80}\b(nomea[çc][õo]es?|portaria(?:s)?)\b/i,
  // (g) FG (Função Gratificada) / GIP — não é cargo comissionado (C3)
  /\bcargo\s+de\s+(?:Fun[çc][ãa]o\s+Gratificada|FG|GIP|Gratifica[çc][ãa]o)\b/i,
  // (h) Concurso público regular (não comissionado) — C3
  /\bconcurso\s+p[úu]blico\b[\s\S]{0,80}\bhomologa(?:[çc][ãa]o|do|da)\b/i,
  /\bnomea[çc][ãa]o\s+(?:em\s+)?car[áa]ter\s+(?:efetivo|permanente)\b/i,
  // (i) Exoneração "a pedido" individual — sem indicação de pico (C2)
  /\bexonerar?,?\s+a\s+pedido,?\s+(?:do\s+|da\s+)?(?:sr\.?|sra\.?|servidor[a]?)?\b/i,
]

function isExcludedPessoal(excerpt: string): boolean {
  return STOPWORDS_PESSOAL.some(re => re.test(excerpt))
}

// ─── Transição de mandato municipal (janeiro pós-eleição) ────────────────────
// Janeiro do ano seguinte à eleição municipal tem volume legítimo alto de
// nomeações/exonerações por transição de gestão. ADR-001 fiscal-pessoal item 5.

const JANEIROS_TRANSICAO: ReadonlySet<string> = new Set([
  '2025-01', '2029-01', '2033-01', // pós-eleições 2024/2028/2032
])

function isJaneiroTransicao(dateISO: string): boolean {
  const ym = dateISO.slice(0, 7)
  return JANEIROS_TRANSICAO.has(ym)
}

// ─── Regex de contagem (etapa 3 — pico) ──────────────────────────────────────

const ATO_RE =
  /\b(?:nomeia|nomeando|nomeado|nomeação|designa[çc][ãa]o|designa[çc][oõ]es|exonera[çc][ãa]o|exonera[çc][oõ]es|exonera(?:ndo|do)|cargo\s+(?:em\s+)?comiss[ãa]o)\b/gi

// ─── Regex de rotatividade (etapa 4) ─────────────────────────────────────────

// Detecta "exoneração ... cargo ... nomeação" ou "cargo ... exoneração ... nomeação"
// dentro do mesmo excerpt para um mesmo cargo comissionado com 2+ titulares distintos.
const EXONERACAO_NOMEACAO_PAR_RE =
  /(?:exonera[çc][ãa]o|exonera(?:ndo|do)).*?(?:cargo\s+(?:em\s+)?comiss[ãa]o|[Cc]hegada de).*?(?:nome[ao]|designa[çc][ãa]o)/is

// ─── Janelas eleitorais municipais ───────────────────────────────────────────

interface JanelaEleitoral {
  inicio: string  // YYYY-MM-DD (inclusive)
  fim: string     // YYYY-MM-DD (inclusive)
  eleicao: string // data da eleição (referência)
}

/**
 * Janelas eleitorais municipais: 3 meses antes da eleição (julho–outubro).
 * Hardcoded para eleições de 2024, 2026 e 2028.
 * TODO: parametrizar via config ou DynamoDB quando cobrir mais cidades/estados.
 */
const JANELAS_ELEITORAIS: JanelaEleitoral[] = [
  { inicio: '2024-07-01', fim: '2024-10-06', eleicao: '2024-10-06' },
  { inicio: '2026-07-01', fim: '2026-10-04', eleicao: '2026-10-04' },
  { inicio: '2028-07-01', fim: '2028-10-01', eleicao: '2028-10-01' },
]

function dentroJanelaEleitoral(dateISO: string): JanelaEleitoral | null {
  for (const janela of JANELAS_ELEITORAIS) {
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

function contarAtos(excerpt: string): number {
  const matches = excerpt.match(ATO_RE)
  return matches ? matches.length : 0
}

// ─── Pessoas únicas ──────────────────────────────────────────────────────────

/**
 * Verbo de ato (nomear/exonerar/designar) seguido de nome próprio em
 * Title Case ou ALL CAPS. Cobre padrões comuns em diários oficiais BR:
 *   "NOMEIA Maria da Silva"   "Nomear MARIA DA SILVA"
 *   "EXONERA o sr. João Lima" "Designar o servidor João Lima"
 *
 * Conector (de/da/do/...) aceito em qualquer caixa para suportar nomes
 * em CAPS LOCK comuns em portarias. Captura 2–5 palavras.
 *
 * Validado em fixtures cobrindo: 7 pessoas distintas, rotatividade
 * (exoneração + nomeação no mesmo excerpt), CAPS LOCK, Title Case,
 * sem nome (nomeação genérica).
 */
const PESSOA_NOMEADA_RE =
  /\b(?:nomeia|nomear|nomeando|nomeada|nomeado|exonera|exonerar|exonerando|exonerado|exonerada|designa|designar|designando|designado|designada)\b\s+(?:o[s]?\s+|a[s]?\s+)?(?:sr\.?\s+|sra\.?\s+|servidor[a]?\s+)?((?:[A-ZÀ-Ü][\wÀ-ÿ]+)(?:\s+(?:de|da|do|dos|das|e|DE|DA|DO|DOS|DAS|E)\s+[A-ZÀ-Ü][\wÀ-ÿ]+|\s+[A-ZÀ-Ü][\wÀ-ÿ]+){1,4})/gi

const STOP_PATTERN_PESSOA = /\b(para|do cargo|da diretoria|no cargo|na secretaria|sob a|com efeito|como|a partir|em comiss)\b/i

/**
 * Conta pessoas únicas (não ocorrências de palavra). Resolve falso positivo
 * comum: "NOMEIA Maria da Silva para Diretor, Coordenador, Chefe" — o
 * `contarAtos` antigo conta 4 atos (1 verbo + 3 cargos), mas é 1 pessoa só.
 *
 * Heurística: extrai nomes próprios após verbos de ato, normaliza, aplica
 * Set. Cortar no primeiro stop-word (`para`, `do cargo`, `na secretaria`...)
 * para evitar capturar palavras-ruído como parte do nome.
 */
function contarPessoasUnicas(excerpts: string[]): number {
  const text = excerpts.join('\n')
  const pessoas = new Set<string>()
  for (const m of text.matchAll(PESSOA_NOMEADA_RE)) {
    let raw = m[1].trim()
    const stop = raw.search(STOP_PATTERN_PESSOA)
    if (stop > 0) raw = raw.slice(0, stop).trim()
    const nome = raw.replace(/[.,;:]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
    // Filtro mínimo: nome com 2+ palavras + 6+ chars (evita falsos curtos)
    if (nome.split(/\s+/).length >= 2 && nome.length >= 6) {
      pessoas.add(nome)
    }
  }
  return pessoas.size
}

// ─── Extração de contexto (cargos + secretarias) ─────────────────────────────

const SECRETARIA_RE =
  /[Ss]ecretaria\s+(?:[Mm]unicipal\s+)?(?:de|da|do|DE|DA|DO)\s+([A-ZÀ-Ü][\wÀ-ÿ]+(?:\s+(?:e|de|da|do|E|DE|DA|DO)\s+[A-ZÀ-Ü][\wÀ-ÿ]+){0,4})/g

const CARGO_RE =
  /(?:para|do|no)\s+(?:o\s+)?cargo\s+(?:em\s+)?comiss[ãa]o\s+de\s+([A-ZÀ-Ü][\wÀ-ÿ]+(?:\s+(?:de|da|do)\s+[\wÀ-ÿ]+){0,3})/g

const FUNCAO_RE =
  /(?:Diretor[a]?|Coordenador[a]?|Chefe|Assessor[a]?|Secret[áa]rio[a]?|Superintendente|Gerente|Procurador[a]?)\s+(?:de|da|do)\s+([A-ZÀ-Ü][\wÀ-ÿ]+(?:\s+[\wÀ-ÿ]+){0,3})/g

interface ContextoAtos {
  secretarias: string[]
  cargos: string[]
  funcoes: string[]
}

/**
 * Extrai secretarias, cargos comissionados e funções mencionadas nos excerpts.
 * Usado para enriquecer a narrativa via Haiku — substitui template genérico
 * por texto que cita órgãos específicos. Privacidade: NÃO extrai nomes
 * próprios de pessoas físicas (regra do Fiscal de Pessoal — Lei 12.527 obriga
 * publicar atos, não consolidar dossiês).
 */
function extrairContextoAtos(excerpts: string[]): ContextoAtos {
  const text = excerpts.join('\n')
  const secretarias = new Set<string>()
  const cargos = new Set<string>()
  const funcoes = new Set<string>()

  for (const m of text.matchAll(SECRETARIA_RE)) {
    secretarias.add(m[1].trim())
  }
  for (const m of text.matchAll(CARGO_RE)) {
    cargos.add(m[1].trim())
  }
  for (const m of text.matchAll(FUNCAO_RE)) {
    funcoes.add(m[1].trim())
  }

  // Top 5 de cada categoria — limita ruído de extração
  return {
    secretarias: Array.from(secretarias).slice(0, 5),
    cargos: Array.from(cargos).slice(0, 5),
    funcoes: Array.from(funcoes).slice(0, 5),
  }
}

// ─── Narrativa via Haiku ─────────────────────────────────────────────────────

const PESSOAL_SYSTEM_PROMPT = `Você é o Fiscal Digital, agente de fiscalização de gastos públicos municipais.

Sua tarefa: gerar narrativa factual sobre detecção de pico de nomeações em uma gazette oficial.

Regras inegociáveis:
- Linguagem factual ("identificamos", "o documento aponta", "os dados indicam") — NUNCA acusatória
- Não afirme culpa, fraude, desvio ou ilícito
- Máximo 3 frases curtas (até 350 caracteres total)
- NÃO cite nomes de pessoas físicas (privacidade — Lei 12.527 obriga publicar atos, não dossiês)
- CITE secretarias e cargos específicos QUANDO o contexto os fornecer (especificidade > genericidade)
- Em janela eleitoral: mencionar Lei 9.504/97 Art. 73 V
- Fora de janela: tom informativo, sem alarmismo
- Indique o porte da cidade em português natural: "cidade de grande porte (mais de 1 milhão de habitantes)", "cidade de médio porte", "cidade de pequeno porte". NÃO use os termos técnicos "large", "medium" ou "small".

Formato esperado da saída: APENAS o texto narrativo, sem prefixos, sem aspas, sem markdown.`

interface NarrativaInput {
  cityName: string
  cityUf: string
  cityBucket: CityBucket
  totalAtos: number
  limiar: number
  isEleitoral: boolean
  eleicaoDate?: string
  gazetteDate: string
  contexto: ContextoAtos
}

/**
 * Gera narrativa específica para `pico_nomeacoes` via Haiku 4.5 (Bedrock).
 *
 * Substitui o template hardcoded do MVP — narrativa cita secretarias/cargos
 * extraídos quando disponíveis, dá contexto de porte da cidade, e diferencia
 * período eleitoral vs informativo.
 *
 * Fallback: se Bedrock falhar (timeout, throttle, error), retorna template
 * mínimo factual — Fiscal nunca trava por causa de LLM.
 */
async function gerarNarrativaPicoViaHaiku(input: NarrativaInput): Promise<string> {
  const ctx = input.contexto
  const ctxLines: string[] = []
  if (ctx.secretarias.length > 0) ctxLines.push(`Secretarias mencionadas: ${ctx.secretarias.join('; ')}`)
  if (ctx.cargos.length > 0)      ctxLines.push(`Cargos em comissão citados: ${ctx.cargos.join('; ')}`)
  if (ctx.funcoes.length > 0)     ctxLines.push(`Funções/diretorias citadas: ${ctx.funcoes.join('; ')}`)
  const contextoStr = ctxLines.length > 0 ? ctxLines.join('\n') : '(nenhuma secretaria ou cargo específico extraído)'

  const userMessage = [
    `Cidade: ${input.cityName}/${input.cityUf} (porte ${input.cityBucket})`,
    `Data da gazette: ${formatDate(input.gazetteDate)}`,
    `Atos de nomeação/exoneração/designação contados: ${input.totalAtos} (limiar: ${input.limiar})`,
    input.isEleitoral
      ? `Contexto: dentro da janela eleitoral municipal (eleição em ${formatDate(input.eleicaoDate ?? '')})`
      : `Contexto: fora da janela eleitoral`,
    '',
    'Contexto extraído dos excerpts:',
    contextoStr,
    '',
    'Gere a narrativa do achado conforme as regras.',
  ].join('\n')

  try {
    const narrative = await invokeModel({
      modelId: NARRATIVE_MODEL,
      systemPrompt: PESSOAL_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 220,
      temperature: 0.2,
    })
    if (narrative && narrative.length > 30) {
      return narrative
    }
  } catch (err) {
    // Bedrock falhou — fallback factual abaixo
    logger.warn('Bedrock falhou, usando template fallback', { err: (err as Error).message })
  }

  // Fallback resiliente — nunca trava o Fiscal por causa de LLM.
  return input.isEleitoral
    ? `Identificamos ${input.totalAtos} atos de nomeação, exoneração e designação de cargos comissionados em gazette de ${formatDate(input.gazetteDate)} em ${input.cityName}/${input.cityUf} (porte ${input.cityBucket}), dentro da janela eleitoral municipal. Volume acima do limiar de ${input.limiar}. Lei 9.504/97 Art. 73 V veda nomeações para cargos em comissão no período eleitoral.`
    : `Identificamos ${input.totalAtos} atos de nomeação, exoneração e designação em gazette de ${formatDate(input.gazetteDate)} em ${input.cityName}/${input.cityUf} (porte ${input.cityBucket}), acima do limiar de ${input.limiar} para o porte da cidade. Registro informativo para monitoramento.`
}

/**
 * Threshold dinâmico de atos por gazette para disparar `pico_nomeacoes`.
 *
 * Calibração 2026-05-06 — auditoria identificou ~50% de ruído em capitais
 * por aplicar o mesmo limiar em SP (11M hab) e Caxias (460k hab). Cidades
 * grandes têm cadência administrativa naturalmente maior; o anômalo
 * absoluto difere por porte.
 *
 * Eleitoral: cap. 10/5/3 (large/medium/small)
 * Fora janela: cap. 20/10/7 (large/medium/small)
 *
 * Cidades small (<100k): limiar baixo porque admin enxuto raramente publica
 * múltiplos atos no mesmo dia — qualquer pico tende a ser sinal real.
 */
function thresholdFor(bucket: CityBucket, isEleitoral: boolean, isTransicaoMandato = false): number {
  let limiar: number
  if (isEleitoral) {
    if (bucket === 'large')  limiar = 10
    else if (bucket === 'medium') limiar = 5
    else limiar = 3
  } else {
    if (bucket === 'large')  limiar = 20
    else if (bucket === 'medium') limiar = 10
    else limiar = 7
  }
  // Janeiro pós-eleição municipal: volume legítimo alto por transição de gestão.
  // ADR-001 fiscal-pessoal item 5 — dobra o limiar para evitar FP de mandato.
  if (isTransicaoMandato) limiar *= 2
  return limiar
}

/**
 * Detecta rotatividade anormal: exoneração + nomeação para cargo comissionado
 * no mesmo excerpt, indicando ao menos 2 pessoas distintas no mesmo cargo.
 *
 * Heurística MVP — opera em excerpt único.
 * TODO: detecção cross-gazette exige schema de personas em DynamoDB (não implementado).
 */
function detectarRotatividadeNoExcerpt(excerpt: string): boolean {
  if (!COMISSAO_RE.test(excerpt)) return false

  // Conta pares exoneração+nomeação no mesmo excerpt
  const exoneracoes = (excerpt.match(/exonera[çc][ãa]o|exonera(?:ndo|do)/gi) ?? []).length
  const nomeacoes = (excerpt.match(/nome[ao]|nomeação|nomeando/gi) ?? []).length

  // Exige ao menos 1 exoneração E 1 nomeação no mesmo excerpt com cargo em comissão
  return exoneracoes >= 1 && nomeacoes >= 1 && EXONERACAO_NOMEACAO_PAR_RE.test(excerpt)
}

// ─── Fiscal de Pessoal ────────────────────────────────────────────────────────

export const fiscalPessoal: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta picos de nomeação em janelas eleitorais (Lei 9.504/97, Art. 73, V) e ' +
    'rotatividade anormal de cargos comissionados (CF, Art. 37, V). ' +
    'MVP opera em excerpt único; histórico cross-gazette requer schema de personas em DynamoDB.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM): descarta excerpts sem termos de pessoal
    // e excerpts identificados como FP sistemático no Ciclo 2/3:
    //   - comunicado de convocação (não nomeação consumada)
    //   - vaga decorrente substituição individual (turnover normal)
    //   - texto normativo mencionando "nomeação" como conceito jurídico
    //   - ratificação retroativa, Lei Complementar criando quadro
    //   - "tornar sem efeito em massa", FG/GIP, concurso público regular
    const relevantExcerpts = gazette.excerpts.filter(e => {
      if (!(NOMEACAO_RE.test(e) || COMISSAO_RE.test(e))) return false
      if (isExcludedPessoal(e)) return false
      return true
    })

    if (relevantExcerpts.length === 0) {
      return []
    }

    // ── Padrão 1: Pico de nomeações (CALIBRAÇÃO: por gazette, não por excerpt) ──
    // Auditoria 2026-05-02 (LRN-019): threshold por excerpt nunca disparava
    // (excerpts são windows de 300 chars; raramente cabem 5 atos).
    // Agora soma todos os excerpts da MESMA gazette antes de testar.
    //
    // Calibração 2026-05-06 — auditoria de 296 findings em prod identificou
    // ~50% ruído. Mudanças (Ondas 1-3):
    //   - Threshold dinâmico por porte da cidade (Onda 1)
    //   - Narrativa via Haiku citando secretarias/cargos (Onda 2)
    //   - Conta PESSOAS ÚNICAS quando heuristica encontra >=2; fallback em
    //     contagem de palavras (Onda 3) — resolve falso positivo
    //     "NOMEIA Maria para Diretor, Coordenador, Chefe" = 4 ocorrências
    //     mas 1 pessoa.
    const pessoasUnicas = contarPessoasUnicas(relevantExcerpts)
    const ocorrencias = relevantExcerpts.reduce((sum, e) => sum + contarAtos(e), 0)
    // Usa pessoas únicas como métrica primária quando heuristica capturou
    // >= 1 nome. Antes era >= 2, o que fazia 1 pessoa nomeada para múltiplos
    // cargos cair no fallback de palavras (ex: 4 ocorrências) — falso positivo.
    const totalAtos = pessoasUnicas >= 1 ? pessoasUnicas : ocorrencias
    const janela = dentroJanelaEleitoral(gazette.date)
    const emJanela = janela !== null
    const bucket = cityBucket(cityId)

    {
      const countAtos = totalAtos
      const excerpt = relevantExcerpts.join('\n---\n') // representação da gazette inteira para evidence

      const isTransicaoMandato = isJaneiroTransicao(gazette.date)
      const limiar = thresholdFor(bucket, emJanela, isTransicaoMandato)
      const dispara = countAtos >= limiar

      if (dispara) {
        // riskScore: janela eleitoral → alto (60–85); fora → informativo (40–59)
        const baseRisco = emJanela ? 70 : 45
        const excesso = Math.min(30, (countAtos - limiar) * 3)
        const riskValue = Math.min(100, baseRisco + excesso)

        const riskFactors: RiskFactor[] = [
          {
            type: 'volume_atos_pessoal',
            weight: 0.6,
            value: riskValue,
            description: `${countAtos} atos de nomeação/exoneração detectados (limiar ${limiar} para porte ${bucket})`,
          },
          {
            type: 'janela_eleitoral',
            weight: 0.4,
            value: emJanela ? 80 : 20,
            description: emJanela
              ? `Gazette em janela eleitoral (eleição ${formatDate(janela!.eleicao)})`
              : 'Gazette fora de janela eleitoral',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data

        // Findings fora da janela eleitoral têm baseRisco=45 e raramente
        // ultrapassam o gate. Criar findings abaixo do threshold polui o DDB
        // sem benefício público. Threshold via SSM (TEC-ENG-002).
        const { riskThreshold } = await getPublishThresholds()
        if (riskScore >= riskThreshold) {

        // Narrativa via Haiku — cita secretarias e cargos extraídos quando
        // disponíveis. Fallback resiliente em caso de falha do Bedrock.
        const cidade = getCityOrFallback(cityId)
        const contexto = extrairContextoAtos(relevantExcerpts)
        const narrativa = await gerarNarrativaPicoViaHaiku({
          cityName: cidade.name,
          cityUf: cidade.uf,
          cityBucket: bucket,
          totalAtos: countAtos,
          limiar,
          isEleitoral: emJanela,
          eleicaoDate: janela?.eleicao,
          gazetteDate: gazette.date,
          contexto,
        })

        const finding: Finding = {
          fiscalId: FISCAL_ID,
          cityId,
          type: 'pico_nomeacoes',
          riskScore,
          // Confiança reflete o método de detecção:
          // - pessoas únicas (regex nomeação): mais preciso → 0.82
          // - fallback contagem de palavras: menos preciso → 0.65
          confidence: pessoasUnicas >= 1 ? 0.82 : 0.65,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: narrativa,
          legalBasis: 'Lei 9.504/97, Art. 73, V; CF, Art. 37, V',
          createdAt: now.toISOString(),
        }

        findings.push(finding)
        } // end if (riskScore >= riskThreshold)
      }

    }

    // ── Padrão 2: Rotatividade anormal de cargo comissionado ─────────────────
    // Mantido per-excerpt: detecta exoneração+nomeação no MESMO ato (300 chars).
    for (const excerpt of relevantExcerpts) {
      if (detectarRotatividadeNoExcerpt(excerpt)) {
        const riskFactors: RiskFactor[] = [
          {
            type: 'rotatividade_cargo_comissao',
            weight: 0.7,
            value: 72,
            description: 'Exoneração + nomeação para cargo comissionado no mesmo ato',
          },
          {
            type: 'cargo_comissao_detectado',
            weight: 0.3,
            value: 80,
            description: 'Termo "cargo em comissão" explicitamente presente no excerpt',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data

        const narrativa =
          `Identificamos exoneração e nomeação para cargo comissionado na gazette de ` +
          `${formatDate(gazette.date)}. O documento aponta troca de titular no mesmo ato. ` +
          `Rotatividade elevada em cargos comissionados pode indicar uso político do funcionalismo (CF, Art. 37, V). ` +
          `Análise de rotatividade histórica entre múltiplas gazettes está em desenvolvimento.`

        const finding: Finding = {
          fiscalId: FISCAL_ID,
          cityId,
          type: 'rotatividade_anormal',
          riskScore,
          confidence: 0.70,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: narrativa,
          legalBasis: 'CF, Art. 37, V; Lei 9.504/97, Art. 73, V',
          createdAt: now.toISOString(),
        }

        findings.push(finding)
      }
    }

    return findings
  },
}

