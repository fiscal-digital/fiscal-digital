import { keywordWindows, FILTER_VERSION, FILTER_KEYWORDS } from '../keyword_windows'

describe('keywordWindows', () => {
  it('extrai janela com raio em torno da keyword', () => {
    const pre = 'x'.repeat(500)
    const post = 'y'.repeat(500)
    const text = `${pre}dispensa de licitação${post}`
    const { windows, hits, truncated } = keywordWindows(text, { radius: 100 })

    expect(hits).toBe(2) // "dispensa de licitação" contém também "licitação"
    expect(windows).toHaveLength(1) // sobrepostas → merge em uma
    expect(windows[0]).toContain('dispensa de licitação')
    expect(windows[0].length).toBeLessThanOrEqual(100 + 'dispensa de licitação'.length + 100)
  })

  it('casa sem acentos e sem case — OCR real vem dos dois jeitos', () => {
    const { windows: a } = keywordWindows('ato de DISPENSA DE LICITACAO n 4', { radius: 10 })
    const { windows: b } = keywordWindows('Pregao eletronico 12/2025', { radius: 10 })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('janelas distantes não são fundidas; adjacentes sim', () => {
    const gap = 'z'.repeat(2000)
    const text = `aditivo${gap}exoneração`
    const { windows } = keywordWindows(text, { radius: 50 })
    expect(windows).toHaveLength(2)
    expect(windows[0]).toContain('aditivo')
    expect(windows[1]).toContain('exoneração')
  })

  it('cluster de atos vira UMA janela contínua com contexto preservado', () => {
    const text = 'nomeação de fulano; exoneração de beltrano; aditivo ao contrato 7'
    const { windows } = keywordWindows(text, { radius: 40 })
    expect(windows).toHaveLength(1)
    expect(windows[0]).toContain('nomeação')
    expect(windows[0]).toContain('aditivo')
  })

  it('teto de janelas reporta truncated=true — nunca corta em silêncio', () => {
    const gap = 'q'.repeat(1000)
    const text = Array.from({ length: 10 }, (_, i) => `pregão ${i}`).join(gap)
    const r = keywordWindows(text, { radius: 20, maxWindows: 3 })
    expect(r.windows).toHaveLength(3)
    expect(r.truncated).toBe(true)
    expect(r.hits).toBe(10)
  })

  it('sem keyword → vazio, sem truncated', () => {
    expect(keywordWindows('relatório de atividades ordinárias', { radius: 50 }))
      .toEqual({ windows: [], hits: 0, truncated: false })
    expect(keywordWindows('')).toEqual({ windows: [], hits: 0, truncated: false })
  })

  it('bordas do texto não estouram índices', () => {
    const { windows } = keywordWindows('licitação', { radius: 300 })
    expect(windows).toEqual(['licitação'])
  })

  it('ADVERSARIAL: 400 KB sem nenhuma keyword em tempo linear', () => {
    const hostil = 'a b c d '.repeat(50_000) // 400 KB
    const t0 = performance.now()
    const r = keywordWindows(hostil)
    expect(performance.now() - t0).toBeLessThan(300)
    expect(r.windows).toEqual([])
  })

  it('contrato de versionamento: FILTER_VERSION e keywords estáveis', () => {
    // Mudou este teste? Então FILTER_VERSION TEM que ter sido bumpado — a
    // chave do cache de extração deriva do texto filtrado.
    expect(FILTER_VERSION).toBe(1)
    expect(FILTER_KEYWORDS).toHaveLength(10)
    expect(FILTER_KEYWORDS).toContain('dispensa de licitação')
  })
})
