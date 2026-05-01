import { formatAlertText } from '../format'
import type { Finding } from '@fiscal-digital/engine'

const EXAMPLE_FINDING: Finding = {
  id: 'finding-001',
  fiscalId: 'fiscal-licitacoes',
  cityId: '4305108',
  type: 'fracionamento',
  riskScore: 85,
  confidence: 0.92,
  narrative:
    'Foram identificadas três dispensas de licitação consecutivas para o mesmo fornecedor, ' +
    'somando R$ 145.000,00, acima do limite legal de R$ 50.000,00 para serviços.',
  legalBasis: 'Lei 14.133/2021, Art. 75, II',
  cnpj: '12.345.678/0001-99',
  secretaria: 'SME',
  value: 145000,
  contractNumber: 'Dispensa 007/2024',
  evidence: [
    {
      source:
        'https://queridodiario.ok.org.br/4305108/2024-03-15/excerpt/12345',
      excerpt: 'Dispensa de licitação nº 007/2024 — Valor: R$ 145.000,00',
      date: '2024-03-15',
    },
  ],
}

describe('formatAlertText', () => {
  it('formata o Finding de exemplo conforme template do CLAUDE.md', () => {
    const text = formatAlertText(EXAMPLE_FINDING)
    expect(text).toMatchSnapshot()
  })

  it('inclui os campos obrigatórios no texto formatado', () => {
    const text = formatAlertText(EXAMPLE_FINDING)

    // Tipo e cidade
    expect(text).toContain('FRACIONAMENTO')
    expect(text).toContain('Caxias do Sul')
    expect(text).toContain('#CaxiasdoSul')

    // Narrative
    expect(text).toContain('três dispensas de licitação consecutivas')

    // Valor
    expect(text).toContain('145.000,00')

    // CNPJ
    expect(text).toContain('12.345.678/0001-99')

    // Secretaria
    expect(text).toContain('SME')

    // Data no formato brasileiro
    expect(text).toContain('15/03/2024')

    // Base legal
    expect(text).toContain('Lei 14.133/2021, Art. 75, II')

    // Fonte
    expect(text).toContain('queridodiario.ok.org.br')

    // Hashtags
    expect(text).toContain('#FiscalDigital')
    expect(text).toContain('#TransparênciaPublica')
  })

  it('omite campos opcionais quando ausentes', () => {
    const minimal: Finding = {
      fiscalId: 'fiscal-licitacoes',
      cityId: '4305108',
      type: 'cnpj_jovem',
      riskScore: 72,
      confidence: 0.80,
      narrative: 'Empresa com menos de 6 meses na data da contratação.',
      legalBasis: 'Lei 14.133/2021, Art. 68',
      evidence: [],
    }

    const text = formatAlertText(minimal)

    // Não deve ter linhas de CNPJ, valor, secretaria, data
    expect(text).not.toContain('💰')
    expect(text).not.toContain('🏢')
    expect(text).not.toContain('🏛️')
    expect(text).not.toContain('📅')
    expect(text).not.toContain('📋')
    expect(text).not.toContain('🔗')
  })
})
