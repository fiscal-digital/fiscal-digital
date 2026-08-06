/**
 * Helpers de texto com garantia de tempo LINEAR.
 *
 * Contexto (#176 / camada raw): os Fiscais processavam excerpts de ~300 chars
 * e vão passar a ver texto integral de gazette — média 39.819 chars, máximo
 * 427 KB medidos no RS_2025. Nessa escala, regex polinomial deixa de ser
 * lint e vira Lambda travada: `/[.,;:]+$/` sobre 400 KB de vírgulas é O(n²)
 * — centenas de bilhões de passos.
 *
 * Regra prática adotada nos Fiscais (CodeQL js/polynomial-redos):
 *   - nada de `X+$` / `X*$` ancorado no fim → usar `trimTrailingPunct`
 *   - nada de `A.*B` para "A antes de B"     → usar `contemNaOrdem`
 *   - `\s+` seguido de alternação/opcional   → limitar (`\s{1,20}`)
 */

const TRAILING_PUNCT = new Set(['.', ',', ';', ':'])

/**
 * Remove pontuação final (`.,;:`) em O(n) — substituto de `/[.,;:]+$/`,
 * que é O(n²) sob backtracking quando a string termina em muitas vírgulas.
 */
export function trimTrailingPunct(s: string): string {
  let end = s.length
  while (end > 0 && TRAILING_PUNCT.has(s[end - 1])) end--
  return end === s.length ? s : s.slice(0, end)
}

/**
 * `contemNaOrdem(texto, a, b)` ≡ `new RegExp(a + '.*' + b)` sem o O(n²):
 * procura `a`, depois `b` APÓS o fim do match de `a`. Dois `search` lineares.
 *
 * As regexes de entrada devem ser elas próprias lineares (sem flag `g` — o
 * estado de `lastIndex` tornaria o helper não-determinístico).
 */
export function contemNaOrdem(texto: string, a: RegExp, b: RegExp): boolean {
  const m = a.exec(texto)
  if (!m) return false
  return b.test(texto.slice(m.index + m[0].length))
}
