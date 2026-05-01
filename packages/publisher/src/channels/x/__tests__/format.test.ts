import { formatTweet, tweetLength } from '../format'
import type { Finding } from '@fiscal-digital/engine'

const BASE: Finding = {
  id: 'finding-001',
  fiscalId: 'fiscal-licitacoes',
  cityId: '4305108',
  type: 'fracionamento',
  riskScore: 85,
  confidence: 0.92,
  narrative:
    'Foram identificadas três dispensas consecutivas para o mesmo fornecedor, somando R$ 145.000,00.',
  legalBasis: 'Lei 14.133/2021, Art. 75, II',
  cnpj: '12.345.678/0001-99',
  secretaria: 'SME',
  value: 145000,
  contractNumber: 'Dispensa 007/2024',
  evidence: [
    {
      source: 'https://queridodiario.ok.org.br/4305108/2024-03-15/excerpt/12345',
      excerpt: 'Dispensa de licitação nº 007/2024 — Valor: R$ 145.000,00',
      date: '2024-03-15',
    },
  ],
}

describe('tweetLength', () => {
  it('conta URLs como 23 chars (t.co wrapping)', () => {
    const text = 'foo https://example.com/very-long-url-that-would-be-wrapped bar'
    // "foo " (4) + 23 (URL wrap) + " bar" (4) = 31
    expect(tweetLength(text)).toBe(31)
  })

  it('conta texto sem URLs literalmente', () => {
    expect(tweetLength('hello world')).toBe(11)
  })
})

describe('formatTweet', () => {
  it('cabe em 280 chars considerando URL wrapping', () => {
    const tweet = formatTweet(BASE)
    expect(tweetLength(tweet)).toBeLessThanOrEqual(280)
  })

  it('inclui campos essenciais: tipo, cidade, valor, base legal, fonte, hashtags', () => {
    const tweet = formatTweet(BASE)
    expect(tweet).toContain('FRACIONAMENTO')
    expect(tweet).toContain('Caxias do Sul')
    expect(tweet).toContain('R$ 145.000')
    expect(tweet).toContain('SME')
    expect(tweet).toContain('Lei 14.133/2021')
    expect(tweet).toContain('queridodiario.ok.org.br')
    expect(tweet).toContain('#FiscalDigital')
    expect(tweet).toContain('#CaxiasdoSul')
  })

  it('lança erro se finding sem evidence.source — princípio sempre citar fonte', () => {
    const sourceless: Finding = { ...BASE, evidence: [] }
    expect(() => formatTweet(sourceless)).toThrow(/sempre citar a fonte/)
  })

  it('trunca narrativa longa para caber em 280', () => {
    const longNarrative = 'a'.repeat(500)
    const finding: Finding = { ...BASE, narrative: longNarrative }
    const tweet = formatTweet(finding)
    expect(tweetLength(tweet)).toBeLessThanOrEqual(280)
    expect(tweet).toContain('…')
  })

  it('omite linha de meta quando não tem valor nem secretaria', () => {
    const minimal: Finding = {
      ...BASE,
      value: undefined,
      secretaria: undefined,
      narrative: 'Empresa com menos de 6 meses na data da contratação.', // sem R$ embutido
    }
    const tweet = formatTweet(minimal)
    // Meta line usa bullet • como separador — ausência do bullet indica meta line removida
    expect(tweet).not.toContain('•')
    expect(tweet).not.toContain('R$')
    expect(tweetLength(tweet)).toBeLessThanOrEqual(280)
  })

  it('compacta base legal para a primeira parte antes da vírgula', () => {
    const tweet = formatTweet(BASE)
    expect(tweet).toContain('⚖️ Lei 14.133/2021')
    expect(tweet).not.toContain('Art. 75, II') // detalhe vai pro Reddit, não X
  })
})
