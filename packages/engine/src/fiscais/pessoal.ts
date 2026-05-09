import { scoreRisk } from '../skills/score_risk'
import { cityBucket, populationOf, type CityBucket } from '../cities/populations'
import { invokeModel, NARRATIVE_MODEL } from '../utils/bedrock'
import { getCityOrFallback } from '../cities'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput } from './types'

const FISCAL_ID = 'fiscal-pessoal'

// ─── Regex de filtro etapa 1 ──────────────────────────────────────────────────

const NOMEACAO_RE = /nome(a[çc][ãa]o|ando|ado)|designa[çc][ãa]o|exonera[çc][ãa]o/i
const COMISSAO_RE = /cargo\s+(em\s+)?comiss[ãa]o/i

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
  /Secretaria\s+(?:Municipal\s+)?(?:de|da|do)\s+([A-ZÀ-Ü][\wÀ-ÿ]+(?:\s+(?:e|de|da|do)\s+[A-ZÀ-Ü][\wÀ-ÿ]+){0,4})/g

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
- Indique o porte da cidade (large/medium/small) ao explicar o limiar

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
    console.warn('[fiscal-pessoal] Bedrock falhou, usando template fallback:', (err as Error).message)
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
function thresholdFor(bucket: CityBucket, isEleitoral: boolean): number {
  if (isEleitoral) {
    if (bucket === 'large')  return 10
    if (bucket === 'medium') return 5
    return 3
  } else {
    if (bucket === 'large')  return 20
    if (bucket === 'medium') return 10
    return 7
  }
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
    const relevantExcerpts = gazette.excerpts.filter(
      e => NOMEACAO_RE.test(e) || COMISSAO_RE.test(e),
    )

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
    // >= 2 nomes; senão cai em ocorrências (heuristica conservadora).
    const totalAtos = pessoasUnicas >= 2 ? pessoasUnicas : ocorrencias
    const janela = dentroJanelaEleitoral(gazette.date)
    const emJanela = janela !== null
    const bucket = cityBucket(cityId)

    {
      const countAtos = totalAtos
      const excerpt = relevantExcerpts.join('\n---\n') // representação da gazette inteira para evidence

      const limiar = thresholdFor(bucket, emJanela)
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
          confidence: 0.75,
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
          `Análise cross-gazette de histórico completo requer schema de personas (TODO).`

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

