/**
 * Helpers de texto em tempo linear — substitutos dos padrões que o CodeQL
 * aponta como js/polynomial-redos (X+$ ancorado, A.*B). Com texto integral
 * de gazette (até 427 KB), regex polinomial trava a Lambda.
 */

const TRAILING_PUNCT = new Set(['.', ',', ';', ':'])

/** Remove pontuação final (.,;:) em O(n) — substituto de /[.,;:]+$/. */
export function trimTrailingPunct(s: string): string {
  let end = s.length
  while (end > 0 && TRAILING_PUNCT.has(s[end - 1])) end--
  return end === s.length ? s : s.slice(0, end)
}

/** "a antes de b" sem o O(n²) de A.*B: dois execs lineares. Não passar regex com flag g. */
export function contemNaOrdem(texto: string, a: RegExp, b: RegExp): boolean {
  const m = a.exec(texto)
  if (!m) return false
  return b.test(texto.slice(m.index + m[0].length))
}
