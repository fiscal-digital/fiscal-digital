/**
 * Pré-filtro determinístico da Fase 1: extrai janelas de texto integral em
 * torno de keywords fiscais. Produz `string[]` no mesmo formato dos excerpts
 * do QD — os Fiscais não mudam; muda o que eles enxergam.
 *
 * Versionado: mudar comportamento => bump FILTER_VERSION. A chave do cache de
 * extração é hash do texto, então versão nova invalida o cache de propósito.
 */

// Bump a cada mudança de comportamento (janela, fold, merge, keywords default).
export const FILTER_VERSION = 1

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

export function keywordWindows(
  text: string,
  opts: KeywordWindowsOptions = {},
): KeywordWindowsResult {
  const radius = opts.radius ?? 300
  const maxWindows = opts.maxWindows ?? 40
  const keywords = (opts.keywords ?? FILTER_KEYWORDS).map(fold)

  if (!text) return { windows: [], hits: 0, truncated: false }
  const folded = fold(text)

  // Ocorrências por indexOf — linear, sem regex sobre texto de 400 KB.
  const intervals: Array<[number, number]> = []
  let hits = 0
  for (const kw of keywords) {
    if (!kw) continue
    let i = folded.indexOf(kw)
    while (i !== -1) {
      hits++
      intervals.push([Math.max(0, i - radius), Math.min(text.length, i + kw.length + radius)])
      i = folded.indexOf(kw, i + kw.length)
    }
  }
  if (intervals.length === 0) return { windows: [], hits: 0, truncated: false }

  // Merge de intervalos sobrepostos/adjacentes: cluster de atos vira UMA
  // janela contínua — preserva contexto entre keywords próximas.
  intervals.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = [intervals[0]]
  for (const [start, end] of intervals.slice(1)) {
    const last = merged[merged.length - 1]
    if (start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  const truncated = merged.length > maxWindows
  const windows = merged.slice(0, maxWindows).map(([s, e]) => text.slice(s, e))
  return { windows, hits, truncated }
}
