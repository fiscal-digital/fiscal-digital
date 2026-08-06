/**
 * Testes dos helpers lineares + prova adversarial de que as correções de
 * ReDoS (#176) aguentam entrada hostil na escala da camada raw.
 *
 * Os inputs adversariais têm 400 KB — o MAIOR diário medido no RS_2025
 * (436.974 chars). Antes das correções, `/[.,;:]+$/` sobre 400 KB de
 * vírgulas leva minutos; o orçamento aqui é 200 ms por operação, com folga
 * de 2 ordens de grandeza sobre o esperado (<5 ms).
 */
import { trimTrailingPunct, contemNaOrdem } from '../text'

const N = 400_000
const BUDGET_MS = 200

function medir(fn: () => void): number {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

describe('trimTrailingPunct', () => {
  it('remove pontuação final e preserva o resto', () => {
    expect(trimTrailingPunct('João da Silva.,;:')).toBe('João da Silva')
    expect(trimTrailingPunct('sem pontuação')).toBe('sem pontuação')
    expect(trimTrailingPunct(',,,,')).toBe('')
    expect(trimTrailingPunct('')).toBe('')
    // pontuação no MEIO fica intacta — só o sufixo sai
    expect(trimTrailingPunct('a, b; c:')).toBe('a, b; c')
  })

  it('ADVERSARIAL: 400 KB de vírgulas em tempo linear', () => {
    const hostil = 'x' + ','.repeat(N)
    let out = ''
    const ms = medir(() => { out = trimTrailingPunct(hostil) })
    expect(out).toBe('x')
    expect(ms).toBeLessThan(BUDGET_MS)
  })
})

describe('contemNaOrdem', () => {
  const A = /inexigibilidade/i
  const B = /loca[çc][ãa]o/i

  it('exige A antes de B, como o `A.*B` que substitui', () => {
    expect(contemNaOrdem('inexigibilidade para locação de imóvel', A, B)).toBe(true)
    expect(contemNaOrdem('locação por inexigibilidade', A, B)).toBe(false)
    expect(contemNaOrdem('só inexigibilidade', A, B)).toBe(false)
    expect(contemNaOrdem('só locação', A, B)).toBe(false)
  })

  it('ADVERSARIAL: "inexigibilidade" repetida até 400 KB sem locação', () => {
    // O pior caso do `.*` antigo: cada ocorrência de A reiniciava o scan.
    const hostil = 'inexigibilidade '.repeat(Math.floor(N / 16))
    let out = true
    const ms = medir(() => { out = contemNaOrdem(hostil, A, B) })
    expect(out).toBe(false)
    expect(ms).toBeLessThan(BUDGET_MS)
  })
})

describe('regexes corrigidas dos Fiscais aguentam 400 KB hostis', () => {
  // Reproduz os payloads exatos que o CodeQL apontou para cada regex.
  const casos: Array<[string, RegExp, string]> = [
    ['diarias \\s{0,20}', /\bdi[áa]ria-?\s{0,20}mente\b/i, 'diária-' + '\n'.repeat(N)],
    [
      'licitacoes emergencia',
      /\b(emerg[êe]ncia|calamidade(\s{1,20}p[úu]blica)?|urg[êe]ncia\s{1,20}(?:declarada|sanit[áa]ria)|estado\s{1,20}de\s{1,20}(?:emerg[êe]ncia|calamidade)\s{1,20}p[úu]blica|contrata[çc][ãa]o\s{1,20}emergencial)\b/i,
      'calamidade' + ' '.repeat(N),
    ],
    [
      'licitacoes insumos',
      /\b(medicamento|insumo\s{1,20}(?:m[ée]dico|hospitalar|farmac[êe]utico|de\s{1,20}sa[úu]de)|[óo]rtese|pr[óo]tese|vacina|imunobiol[óo]gico|equipamento\s{1,20}hospitalar|(?:insumos?|produtos?)\s{1,20}estrat[ée]gicos?\s{1,20}para\s{1,20}a\s{1,20}sa[úu]de)\b/i,
      'insumo' + ' '.repeat(N),
    ],
  ]

  it.each(casos)('%s', (_nome, re, hostil) => {
    const ms = medir(() => re.test(hostil))
    expect(ms).toBeLessThan(BUDGET_MS)
  })

  it('comportamento preservado nos casos reais', () => {
    expect(/\bdi[áa]ria-?\s{0,20}mente\b/i.test('paga diária-\n    mente aos servidores')).toBe(true)
    expect(/\bdi[áa]ria-?\s{0,20}mente\b/i.test('diariamente')).toBe(true)
    expect(
      /\b(emerg[êe]ncia|calamidade(\s{1,20}p[úu]blica)?|urg[êe]ncia\s{1,20}(?:declarada|sanit[áa]ria)|estado\s{1,20}de\s{1,20}(?:emerg[êe]ncia|calamidade)\s{1,20}p[úu]blica|contrata[çc][ãa]o\s{1,20}emergencial)\b/i
        .test('decreta estado de calamidade pública no município'),
    ).toBe(true)
  })
})
