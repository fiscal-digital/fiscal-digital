import { formatRedditPost } from '../format'
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

describe('formatRedditPost', () => {
  // -----------------------------------------------------------------------
  // Título
  // -----------------------------------------------------------------------
  it('título tem no máximo 300 chars', () => {
    const { title } = formatRedditPost(BASE)
    expect(title.length).toBeLessThanOrEqual(300)
  })

  it('título segue o formato [TIPO] Cidade — riskScore N/100', () => {
    const { title } = formatRedditPost(BASE)
    expect(title).toBe('[FRACIONAMENTO] Caxias do Sul — riskScore 85/100')
  })

  it('título ≤ 300 chars mesmo com tipo e cidade longos', () => {
    const finding: Finding = {
      ...BASE,
      type: 'inexigibilidade_sem_justificativa',
      riskScore: 100,
    }
    const { title } = formatRedditPost(finding)
    expect(title.length).toBeLessThanOrEqual(300)
  })

  // -----------------------------------------------------------------------
  // Body — conteúdo obrigatório
  // -----------------------------------------------------------------------
  it('body contém a narrative do finding', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).toContain(BASE.narrative)
  })

  it('body contém link para Querido Diário em formato markdown [texto](url)', () => {
    const { body } = formatRedditPost(BASE)
    // Deve ter o padrão [texto](url) apontando para o domínio do Querido Diário
    expect(body).toMatch(/\[Diário Oficial — Querido Diário\]\(https:\/\/queridodiario\.ok\.org\.br/)
  })

  it('body contém a base legal', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).toContain('Lei 14.133/2021, Art. 75, II')
  })

  it('body contém rodapé com assinatura do Fiscal Digital', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).toContain('Fiscal Digital')
    expect(body).toContain('fiscalização autônoma')
  })

  // -----------------------------------------------------------------------
  // Body — ausência de hashtags
  // -----------------------------------------------------------------------
  it('body NÃO contém hashtags (Reddit não usa como X)', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).not.toMatch(/#\w+/)
  })

  // -----------------------------------------------------------------------
  // Body — tabela de metadados
  // -----------------------------------------------------------------------
  it('body inclui secretaria na tabela quando presente', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).toContain('SME')
  })

  it('body inclui CNPJ na tabela quando presente', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).toContain('12.345.678/0001-99')
  })

  it('body inclui valor formatado em BRL na tabela quando presente', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).toContain('R$ 145.000,00')
  })

  it('body inclui número do contrato na tabela quando presente', () => {
    const { body } = formatRedditPost(BASE)
    expect(body).toContain('Dispensa 007/2024')
  })

  // -----------------------------------------------------------------------
  // Finding sem evidence — sem link no body
  // -----------------------------------------------------------------------
  it('finding sem evidence não inclui link do Querido Diário no body', () => {
    const noEvidence: Finding = { ...BASE, evidence: [] }
    const { body } = formatRedditPost(noEvidence)
    expect(body).not.toContain('queridodiario.ok.org.br')
    expect(body).not.toContain('Querido Diário')
  })

  // -----------------------------------------------------------------------
  // Finding minimal — sem campos opcionais
  // -----------------------------------------------------------------------
  it('finding sem campos opcionais não gera tabela de metadados', () => {
    const minimal: Finding = {
      ...BASE,
      cnpj: undefined,
      secretaria: undefined,
      value: undefined,
      contractNumber: undefined,
      evidence: [],
    }
    const { body } = formatRedditPost(minimal)
    // Sem tabela markdown
    expect(body).not.toContain('| Campo | Valor |')
  })

  // -----------------------------------------------------------------------
  // Truncamento do body
  // -----------------------------------------------------------------------
  it('body com narrative muito longa é truncado em 3.000 chars', () => {
    const longNarrative = 'x'.repeat(5000)
    const finding: Finding = { ...BASE, narrative: longNarrative }
    const { body } = formatRedditPost(finding)
    expect(body.length).toBeLessThanOrEqual(3000)
    expect(body).toMatch(/\.\.\.$/)
  })
})
