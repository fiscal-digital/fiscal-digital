import { keywordWindows, FILTER_VERSION, FILTER_KEYWORDS } from '../keyword_windows'

describe('keywordWindows', () => {
  it('extrai janela com raio em torno da keyword', () => {
    const pre = 'x'.repeat(500)
    const post = 'y'.repeat(500)
    const text = `${pre}dispensa de licitação${post}`
    const { windows, hits } = keywordWindows(text, { radius: 100 })

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
    expect(FILTER_VERSION).toBe(2)
    expect(FILTER_KEYWORDS).toHaveLength(10)
    expect(FILTER_KEYWORDS).toContain('dispensa de licitação')
  })

  // ─── #166: limite do ato ──────────────────────────────────────────────────
  // Trechos reais do canário da Fase 1 (Diário Oficial de Caxias do Sul,
  // jun/2025; rótulos em fiscal-digital-evaluations#15).

  const REPASSE_E_DISPENSA = [
    'Plano de Trabalho, no valor de R$ 1.879.083,76 (um',
    '',
    'milhão, oitocentos e setenta e nove mil, oitenta e três reais e setenta e seis centavos).',
    ' ',
    '',
    'Caxias do Sul, 27 de junho de 2025.',
    'Gilberto José Galafassi',
    '',
    'Secretaria Municipal de Administração, Tecnologia e Inovação',
    'Central de Licitações',
    ' ',
    '',
    'Aviso de Dispensa de Licitação por SRP',
    ' ',
    'Contratado(a): MF2 FARMACIA DE MANIPULACAO LTDA. CNPJ: 08.613.246/0003-02. Objeto: Aquisição de medicamentos',
    'manipulados por dispensa por registro de preços. Valor R$  2.952,00. Dispensa por SRP n.º 106/2025. Processo n.º 2025/26460.',
    'Fundamento Legal: Art. 75, inciso II, da Lei nº 14.133/21.',
    ' ',
    '',
    'Caxias do Sul, 27 de junho de 2025.',
  ].join('\n')

  it('REGRESSÃO #166: valor do ato vizinho não entra na janela da dispensa', () => {
    // Antes: a dispensa de R$ 2.952 saiu com R$ 1.879.083,76, o repasse anterior.
    const { windows } = keywordWindows(REPASSE_E_DISPENSA, { radius: 300 })
    const daDispensa = windows.find(w => w.includes('08.613.246/0003-02'))
    expect(daDispensa).toBeDefined()
    expect(daDispensa).toContain('2.952,00')
    expect(daDispensa).not.toContain('1.879.083,76')
  })

  it('ato curto com os dois limites vira janela inteira — fundamento e data inclusos', () => {
    const { windows } = keywordWindows(REPASSE_E_DISPENSA, { radius: 20 })
    const daDispensa = windows.find(w => w.includes('08.613.246/0003-02'))
    expect(daDispensa?.startsWith('Aviso de Dispensa de Licitação por SRP')).toBe(true)
    expect(daDispensa).toContain('Fundamento Legal: Art. 75, inciso II')
    expect(daDispensa?.endsWith('Caxias do Sul, 27 de junho de 2025.')).toBe(true)
  })

  it('avisos consecutivos viram uma janela por ato, cada uma com o próprio CNPJ', () => {
    const aviso = (nome: string, cnpj: string, valor: string) => [
      ' ', '', 'Aviso de Inexigibilidade de Licitação', ' ', '',
      `Contratado(a): ${nome}. CNPJ: ${cnpj}. Objeto: Inscrição de servidores. Valor R$ ${valor}.`,
      ' ', '', 'Caxias do Sul, 26 de junho de 2025.', ' ', '', 'Grégora Fortuna dos Passos',
    ].join('\n')
    const text = [
      aviso('DPM EDUCACAO LTDA', '13.021.017/0001-77', '1.332,00'),
      aviso('SOCIEDADE BRASILEIRA DE MEDICINA TROPICAL', '20.858.932/0001-87', '2.100,00'),
    ].join('\n')

    const { windows } = keywordWindows(text, { radius: 300 })
    expect(windows).toHaveLength(2)
    expect(windows[0]).toContain('1.332,00')
    expect(windows[0]).not.toContain('20.858.932/0001-87')
    expect(windows[1]).toContain('2.100,00')
    expect(windows[1]).not.toContain('13.021.017/0001-77')
  })

  it('palavra de título no meio de prosa quebrada NÃO é limite de ato', () => {
    // Sem linha em branco antes, "Termo" é continuação de frase, não título.
    const text = 'Aditivo ao contrato 7 conforme o\nTermo de Referência anexo, valor R$ 10.000,00.'
    const { windows } = keywordWindows(text, { radius: 300 })
    expect(windows).toHaveLength(1)
    expect(windows[0]).toContain('10.000,00')
  })

  it('ato longo demais volta ao raio, sem atravessar os limites', () => {
    const longo = [
      '', '', 'Aviso de Dispensa de Licitação', 'x'.repeat(3000), 'Caxias do Sul, 2 de maio de 2025.',
    ].join('\n')
    const { windows } = keywordWindows(longo, { radius: 100, maxActChars: 2000 })
    expect(windows).toHaveLength(1)
    expect(windows[0].startsWith('Aviso de Dispensa de Licitação')).toBe(true)
    expect(windows[0].length).toBeLessThanOrEqual('dispensa de licitação'.length + 100 + 'Aviso de '.length)
  })

  it('ADVERSARIAL: 400 KB de linhas em branco e títulos sem keyword continuam lineares', () => {
    const hostil = '\n \nAviso de nada\nCaxias do Sul, 1 de maio de 2025.\n'.repeat(8_000)
    const t0 = performance.now()
    const r = keywordWindows(hostil)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(r.windows).toEqual([])
  })
})
