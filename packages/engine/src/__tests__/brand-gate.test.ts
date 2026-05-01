import { validateNarrative } from '../brand-gate'

describe('validateNarrative', () => {
  it('aceita narrativa factual sem termos proibidos', () => {
    const result = validateNarrative(
      'Identificamos três dispensas de licitação consecutivas para o mesmo fornecedor, ' +
      'somando R$ 145.000,00, acima do limite legal de R$ 50.000,00 para serviços. ' +
      'O documento aponta concentração de contratos na Secretaria de Obras.',
    )
    expect(result.valid).toBe(true)
    expect(result.hits).toHaveLength(0)
  })

  it('rejeita narrativa com "fraude" e inclui o termo nos hits', () => {
    const result = validateNarrative(
      'Identificamos indício de fraude no contrato 042/2024.',
    )
    expect(result.valid).toBe(false)
    expect(result.hits).toContain('fraude')
  })

  it('detecção é case-insensitive — "FRAUDE" em maiúsculas é rejeitado', () => {
    const result = validateNarrative(
      'O documento aponta possível FRAUDE na dispensa 007/2024.',
    )
    expect(result.valid).toBe(false)
    expect(result.hits).toContain('fraude')
  })

  it('rejeita narrativa com "esquema de corrupção" e captura ambos os termos', () => {
    const result = validateNarrative(
      'Há evidências de um esquema de corrupção envolvendo três fornecedores.',
    )
    expect(result.valid).toBe(false)
    expect(result.hits).toContain('esquema')
    expect(result.hits).toContain('corrupção')
  })

  it('rejeita narrativa com termo em inglês "fraud"', () => {
    const result = validateNarrative(
      'We identified possible fraud in contract 042/2024.',
    )
    expect(result.valid).toBe(false)
    expect(result.hits).toContain('fraud')
  })

  it('rejeita narrativa com "ladrão" e inclui o termo nos hits', () => {
    const result = validateNarrative(
      'O ladrão de dinheiro público foi identificado nos contratos.',
    )
    expect(result.valid).toBe(false)
    expect(result.hits).toContain('ladrão')
  })
})
