/**
 * Pré-filtro determinístico da Fase 1: extrai janelas de texto integral em
 * torno de keywords fiscais. Produz `string[]` no mesmo formato dos excerpts
 * do QD — os Fiscais não mudam; muda o que eles enxergam.
 *
 * Versionado: mudar comportamento => bump FILTER_VERSION. A chave do cache de
 * extração é hash do texto, então versão nova invalida o cache de propósito.
 */

// Bump a cada mudança de comportamento (janela, fold, merge, keywords default).
// v2 (#166): janela recortada no limite do ato e sem merge entre atos.
export const FILTER_VERSION = 2

// Mesma lista do collector de produção (fonte da verdade para a Fase 1).
export const FILTER_KEYWORDS: readonly string[] = [
  'dispensa de licitação',
  'inexigibilidade',
  'contratação direta',
  'aditivo',
  'prorrogação',
  'nomeação',
  'exoneração',
  'licitação',
  'pregão',
  'tomada de preços',
]

export interface KeywordWindowsOptions {
  /** Chars antes/depois de cada ocorrência. Default 300 (janela ~600 + keyword). */
  radius?: number
  /**
   * Ato com os dois limites conhecidos e até este tamanho vira janela inteira,
   * em vez do raio — fundamento legal e data costumam estar no fim. Default 2000.
   */
  maxActChars?: number
  /** Teto de janelas por texto — diário patológico não vira custo. Default 40. */
  maxWindows?: number
  keywords?: readonly string[]
}

export interface KeywordWindowsResult {
  windows: string[]
  /** Ocorrências totais de keyword (antes do merge de janelas). */
  hits: number
  /** true quando o teto cortou janelas — nunca truncar em silêncio. */
  truncated: boolean
}

// Fold 1:1 (mesmo comprimento) para casar "licitacao" em OCR sem acento.
const FOLD: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', é: 'e', ê: 'e', è: 'e', ë: 'e',
  í: 'i', î: 'i', ì: 'i', ó: 'o', ô: 'o', õ: 'o', ò: 'o', ö: 'o',
  ú: 'u', û: 'u', ù: 'u', ü: 'u', ç: 'c',
}

function fold(s: string): string {
  let out = ''
  for (const ch of s.toLowerCase()) out += FOLD[ch] ?? ch
  return out
}

// ─── Limites de ato (#166) ──────────────────────────────────────────────────
//
// Canário da Fase 1 (Caxias 2025, fiscal-digital-evaluations#15): 7 dos 32 FP
// vinham de uma janela que juntava atos vizinhos, e valor ou CNPJ de um ato ia
// parar em outro. Ex.: dispensa de R$ 2.952 saiu com R$ 1.879.083,76, que é o
// repasse publicado logo antes. Diário oficial tem duas marcas estáveis de
// fronteira entre atos, e a janela não atravessa nenhuma das duas:
//
// 1. Título do ato no começo de linha, depois de linha em branco
//    ("Aviso de Dispensa…", "Extrato do Contrato…", "Portaria nº…"). Exigir a
//    linha em branco é o que separa título de prosa quebrada em várias linhas.
// 2. Fecho "Cidade, DD de mês de AAAA." sozinho na linha — o ato termina ali.
//    A data fica DENTRO da janela do ato que ela fecha (é a data do ato).
//
// Os dois regex rodam sobre o texto já dobrado (minúsculo, sem acento) e não
// têm quantificador aninhado — lineares em diário de 400 KB.
const TITULO_ATO_RE =
  /\n[ \t]*\n[ \t]*(aviso|extrato|termo|portaria|decreto|edital|resolucao|homologacao|ratificacao|adjudicacao|errata|retificacao|despacho)\b/g
const FECHO_DATA_RE =
  /\n[ \t]*[a-z][a-z .'-]{1,40}, \d{1,2}(?:o|º)? de (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de \d{4}\.?[ \t]*(?=\n|$)/g

/** Posições (ordenadas) onde um ato termina e o próximo pode começar. */
function limitesDeAto(folded: string): number[] {
  const limites: number[] = []
  for (const m of folded.matchAll(TITULO_ATO_RE)) {
    // limite no início da palavra do título, não na linha em branco
    limites.push(m.index + m[0].length - m[1].length)
  }
  for (const m of folded.matchAll(FECHO_DATA_RE)) {
    limites.push(m.index + m[0].length)
  }
  return limites.sort((a, b) => a - b)
}

/** Maior limite <= pos, ou -1. */
function limiteAntes(limites: number[], pos: number): number {
  let lo = 0, hi = limites.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (limites[mid] <= pos) { ans = limites[mid]; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

/** Menor limite > pos, ou -1. */
function limiteDepois(limites: number[], pos: number): number {
  let lo = 0, hi = limites.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (limites[mid] > pos) { ans = limites[mid]; hi = mid - 1 } else lo = mid + 1
  }
  return ans
}

export function keywordWindows(
  text: string,
  opts: KeywordWindowsOptions = {},
): KeywordWindowsResult {
  const radius = opts.radius ?? 300
  const maxWindows = opts.maxWindows ?? 40
  const maxActChars = opts.maxActChars ?? 2000
  const keywords = (opts.keywords ?? FILTER_KEYWORDS).map(fold)

  if (!text) return { windows: [], hits: 0, truncated: false }
  const folded = fold(text)
  const limites = limitesDeAto(folded)

  // Ocorrências por indexOf — linear, sem regex sobre texto de 400 KB.
  const intervals: Array<[number, number]> = []
  let hits = 0
  for (const kw of keywords) {
    if (!kw) continue
    let i = folded.indexOf(kw)
    while (i !== -1) {
      hits++
      // Janela recortada no ato que contém a keyword (#166): o ato inteiro
      // quando é curto e tem os dois limites; senão o raio, sem atravessá-los.
      const antes = limiteAntes(limites, i)
      const depois = limiteDepois(limites, i)
      if (antes !== -1 && depois !== -1 && depois - antes <= maxActChars) {
        intervals.push([antes, depois])
      } else {
        const start = Math.max(0, i - radius, antes)
        const end = Math.min(text.length, i + kw.length + radius, depois === -1 ? Infinity : depois)
        intervals.push([start, end])
      }
      i = folded.indexOf(kw, i + kw.length)
    }
  }
  if (intervals.length === 0) return { windows: [], hits: 0, truncated: false }

  // Merge só de intervalos que se SOBREPÕEM: keywords próximas do mesmo ato
  // viram uma janela. Intervalos que apenas se tocam ficaram assim por terem
  // sido recortados no mesmo limite — são atos diferentes e não se fundem.
  intervals.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = [intervals[0]]
  for (const [start, end] of intervals.slice(1)) {
    const last = merged[merged.length - 1]
    if (start < last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  const truncated = merged.length > maxWindows
  const windows = merged.slice(0, maxWindows).map(([s, e]) => text.slice(s, e).trim())
  return { windows, hits, truncated }
}
