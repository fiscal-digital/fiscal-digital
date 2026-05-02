import { scoreRisk } from '../skills/score_risk'
import type { Finding, RiskFactor } from '../types'
import type { Fiscal, AnalisarInput } from './types'

const FISCAL_ID = 'fiscal-nepotismo'

// ─── Constraints ──────────────────────────────────────────────────────────────
//
// **Risco reputacional CRÍTICO.** Acusação errada → retratação pública obrigatória
// (CLAUDE.md "Política de retratação"). Por isso:
//
//   1. Confidence threshold ≥ 0.95 obrigatório — abaixo disso NÃO emite finding.
//   2. Sem fonte externa de parentesco (TSE/RF não integrados) → heurística por
//      sobrenome incomum. Nunca afirmar parentesco; apenas indicar coincidência.
//   3. Linguagem: "identificamos coincidência de sobrenome" — NUNCA "é parente de".
//   4. type = 'nepotismo_indicio' (sufixo "_indicio" é parte do contrato de UX).
//
// Base legal: STF Súmula Vinculante 13 + CF Art. 37 (impessoalidade, moralidade).

// ─── Regex de filtro etapa 1 ─────────────────────────────────────────────────

const NOMEACAO_RE = /\b(nomeia|nomeando|nomea[çc][ãa]o|designa(?:ndo|do|[çc][ãa]o)?)\b/i
const COMISSAO_RE = /cargo\s+(em\s+)?comiss[ãa]o|cc[-\s]?\d+|fun[çc][ãa]o\s+gratificada|\bdas[-\s]?\d+/i

// ─── Extração de nome ────────────────────────────────────────────────────────

/**
 * Captura nome completo após verbo de nomeação. Aceita:
 *  - "NOMEIA Maria da Silva Pereira para..."
 *  - "Nomeia o(a) Sr(a). Maria da Silva..."
 *  - "designa Carlos Souza para..."
 *
 * Retorna o nome bruto (sem normalização de acento/case).
 *
 * Estratégia: regex permissiva captura sequência de tokens iniciados por
 * letra maiúscula (incl. acentos PT) ligados por conectivos. Para após
 * preposição comum ("para", "ao", etc.) ou pontuação.
 */
const NOME_CAPTURA_RE =
  /\b(?:NOMEIA|NOMEANDO|NOMEIE|DESIGNA|DESIGNANDO|Nomeia|Nomeando|Designa|Designando|nomeia|nomeando|designa|designando)\s+(?:o\s+|a\s+|os\s+|as\s+|Sr\.?\s+|Sra\.?\s+|sr\.?\s+|sra\.?\s+|Senhor\s+|Senhora\s+|senhor\s+|senhora\s+|servidor(?:a)?\s+)?((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõçA-ZÁÉÍÓÚÂÊÔÃÕÇ]+)(?:\s+(?:da|de|do|das|dos|e|di|del|van|von|Da|De|Do|Das|Dos|E)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõçA-ZÁÉÍÓÚÂÊÔÃÕÇ]+|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõçA-ZÁÉÍÓÚÂÊÔÃÕÇ]+){1,5})/g

// ─── Sobrenomes comuns (top 50 IBGE) — bloqueados para evitar falso positivo ──

/**
 * Top 50 sobrenomes brasileiros. Frequência tão alta que coincidência
 * NÃO é evidência de parentesco. Hardcode — alterar requer revisão de Diego.
 *
 * Normalização: minúsculas + sem acento (NFD strip).
 */
const SOBRENOMES_COMUNS = new Set<string>([
  'silva', 'santos', 'oliveira', 'souza', 'pereira', 'lima', 'costa',
  'ferreira', 'almeida', 'carvalho', 'rodrigues', 'gomes', 'martins',
  'araujo', 'ribeiro', 'alves', 'barbosa', 'nascimento', 'cardoso',
  'rocha', 'dias', 'castro', 'mendes', 'cruz', 'reis', 'ramos', 'torres',
  'cavalcanti', 'correia', 'moreira', 'pinto', 'freitas', 'marques',
  'borges', 'teixeira', 'andrade', 'vieira', 'monteiro', 'cunha', 'lopes',
  'mello', 'sales', 'macedo', 'vasconcelos', 'bezerra', 'maia', 'aragao',
  'bastos', 'caldeira', 'cabral',
])

/**
 * Conectivos do português que NÃO contam como sobrenome (evita pegar
 * "da", "de", "do" como sobrenome final).
 */
const CONECTIVOS = new Set<string>([
  'da', 'de', 'do', 'das', 'dos', 'e', 'di', 'del', 'van', 'von', 'la',
])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizar(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .trim()
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Extrai o sobrenome final de um nome completo.
 * "Maria da Silva Pereira" → "pereira"
 * "Carlos Souza"           → "souza"
 * "Ana Costa Albuquerque"  → "albuquerque"
 *
 * Ignora conectivos no final ("Maria de" → null).
 */
export function extrairSobrenomeFinal(nomeCompleto: string): string | null {
  const tokens = nomeCompleto
    .trim()
    .split(/\s+/)
    .map(t => t.replace(/[.,;:]+$/, ''))
    .filter(t => t.length > 0)

  // Precisa ao menos nome + sobrenome
  if (tokens.length < 2) return null

  // Percorre de trás pra frente até achar token que não é conectivo
  for (let i = tokens.length - 1; i >= 0; i--) {
    const norm = normalizar(tokens[i])
    if (norm && !CONECTIVOS.has(norm) && norm.length >= 3) {
      return norm
    }
  }

  return null
}

/**
 * Extrai todos os nomes nomeados/designados em um excerpt.
 * Retorna lista de { nome, sobrenomeFinal }.
 */
export function extrairNomeacoes(excerpt: string): Array<{ nome: string; sobrenomeFinal: string }> {
  const resultado: Array<{ nome: string; sobrenomeFinal: string }> = []
  // Reset stateful regex
  NOME_CAPTURA_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = NOME_CAPTURA_RE.exec(excerpt)) !== null) {
    const nome = match[1].trim()
    const sobrenome = extrairSobrenomeFinal(nome)
    if (sobrenome) {
      resultado.push({ nome, sobrenomeFinal: sobrenome })
    }
  }

  return resultado
}

interface SobrenomeAgrupado {
  sobrenome: string  // normalizado (lowercase + sem acento)
  nomes: string[]    // nomes completos originais (preserva acento)
  count: number
}

/**
 * Agrupa nomeações por sobrenome final, descartando sobrenomes na blocklist
 * (top 50 IBGE).
 */
function agruparPorSobrenome(
  nomeacoes: Array<{ nome: string; sobrenomeFinal: string }>,
): SobrenomeAgrupado[] {
  const mapa = new Map<string, SobrenomeAgrupado>()

  for (const { nome, sobrenomeFinal } of nomeacoes) {
    if (SOBRENOMES_COMUNS.has(sobrenomeFinal)) continue

    const grupo = mapa.get(sobrenomeFinal)
    if (grupo) {
      grupo.nomes.push(nome)
      grupo.count += 1
    } else {
      mapa.set(sobrenomeFinal, {
        sobrenome: sobrenomeFinal,
        nomes: [nome],
        count: 1,
      })
    }
  }

  return Array.from(mapa.values())
}

// ─── Threshold MVP ────────────────────────────────────────────────────────────

/**
 * Mínimo de pessoas com mesmo sobrenome incomum para acionar alerta.
 * Conservador (3+) — duas pessoas com sobrenome igual em uma única gazette
 * ainda é coincidência plausível. Três ou mais começa a indicar padrão.
 */
const MIN_OCORRENCIAS = 3

/**
 * Confidence mínimo OBRIGATÓRIO para emitir finding.
 * Abaixo disso → return [] (princípio: melhor falso negativo que falso positivo).
 */
const CONFIDENCE_MIN = 0.95

// ─── Fiscal de Nepotismo ─────────────────────────────────────────────────────

export const fiscalNepotismo: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta INDÍCIO (nunca afirmação) de nepotismo: coincidência de sobrenome ' +
    'incomum em múltiplas nomeações para cargos em comissão, à luz da STF Súmula ' +
    'Vinculante 13 e CF Art. 37. MVP heurístico — não cruza fonte oficial de ' +
    'parentesco; recomenda verificação manual.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro: precisa ter nomeação E cargo em comissão no mesmo excerpt
    const relevantes = gazette.excerpts.filter(
      e => NOMEACAO_RE.test(e) && COMISSAO_RE.test(e),
    )

    if (relevantes.length === 0) return []

    // Etapa 2 — Coleta nomes em TODOS os excerpts relevantes da mesma gazette
    // (consolidado por gazette, não por excerpt — uma gazette é uma "publicação").
    const todasNomeacoes: Array<{ nome: string; sobrenomeFinal: string; excerpt: string }> = []
    for (const excerpt of relevantes) {
      const nomes = extrairNomeacoes(excerpt)
      for (const n of nomes) {
        todasNomeacoes.push({ ...n, excerpt })
      }
    }

    if (todasNomeacoes.length < MIN_OCORRENCIAS) return []

    // Etapa 3 — Agrupa por sobrenome (descartando comuns)
    const grupos = agruparPorSobrenome(
      todasNomeacoes.map(n => ({ nome: n.nome, sobrenomeFinal: n.sobrenomeFinal })),
    )

    // Etapa 4 — Filtra grupos com >= MIN_OCORRENCIAS
    const suspeitos = grupos.filter(g => g.count >= MIN_OCORRENCIAS)
    if (suspeitos.length === 0) return []

    // Etapa 5 — Para cada grupo suspeito, calcula riskScore e gera finding
    for (const grupo of suspeitos) {
      // Confidence: começa em 0.95 (mínimo obrigatório). Sobe se mais ocorrências.
      // Cap em 0.97 — nunca atinge 1.0 sem fonte oficial de parentesco.
      const confidence = Math.min(0.97, 0.95 + (grupo.count - MIN_OCORRENCIAS) * 0.005)

      // Hard guard: abaixo de 0.95 não emite (defensivo — nunca deve acontecer
      // com a fórmula acima, mas evita regressão silenciosa em refactor futuro).
      if (confidence < CONFIDENCE_MIN) continue

      // riskScore: moderado (50–60). Indício, não acusação. Não promove para
      // alto risco automaticamente — exige verificação manual antes.
      const baseRisco = 50
      const incremento = Math.min(10, (grupo.count - MIN_OCORRENCIAS) * 5)
      const riskFactors: RiskFactor[] = [
        {
          type: 'coincidencia_sobrenome_incomum',
          weight: 0.7,
          value: baseRisco + incremento,
          description: `${grupo.count} nomeações com sobrenome "${grupo.sobrenome}" (fora do top 50 IBGE)`,
        },
        {
          type: 'cargo_em_comissao_presente',
          weight: 0.3,
          value: 60,
          description: 'Termo "cargo em comissão" presente nos excerpts analisados',
        },
      ]

      const scoreResult = await scoreRisk.execute({ factors: riskFactors })
      const riskScore = scoreResult.data

      // Encontra excerpts onde os nomes deste grupo aparecem (evidência)
      const excerptsDoGrupo = new Set<string>()
      for (const nomeacao of todasNomeacoes) {
        if (nomeacao.sobrenomeFinal === grupo.sobrenome) {
          excerptsDoGrupo.add(nomeacao.excerpt)
        }
      }

      // Linguagem CRITICAMENTE factual — nunca afirma parentesco.
      const nomesListados = grupo.nomes.join(', ')
      const narrative =
        `Identificamos coincidência de sobrenome incomum ("${grupo.sobrenome}") em ` +
        `${grupo.count} nomeações para cargos em comissão na gazette de ` +
        `${formatDate(gazette.date)} (${nomesListados}). ` +
        `O sobrenome não consta entre os 50 mais comuns do Brasil (IBGE). ` +
        `Trata-se de indício que recomenda verificação manual de eventual relação de ` +
        `parentesco, sem qualquer afirmação prévia. ` +
        `STF Súmula Vinculante 13 e CF Art. 37 vedam o nepotismo na administração pública.`

      const finding: Finding = {
        fiscalId: FISCAL_ID,
        cityId,
        type: 'nepotismo_indicio',
        riskScore,
        confidence,
        evidence: Array.from(excerptsDoGrupo).map(excerpt => ({
          source: gazette.url,
          excerpt,
          date: gazette.date,
        })),
        narrative,
        legalBasis: 'STF Súmula Vinculante 13; CF, Art. 37',
        createdAt: now.toISOString(),
        // NOTA: NÃO populamos cnpj/secretaria como NULL (LRN-019: GSI rejeita NULL).
        // Quando ausente, o campo simplesmente não é incluído no objeto.
      }

      findings.push(finding)
    }

    return findings
  },
}
