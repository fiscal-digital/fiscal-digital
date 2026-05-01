import { scoreRisk } from '../score_risk'
import type { RiskFactor } from '../../types'

describe('scoreRisk', () => {
  it('factors vazio retorna score 0 e confidence 1.0', async () => {
    const result = await scoreRisk.execute({ factors: [] })
    expect(result.data).toBe(0)
    expect(result.confidence).toBe(1.0)
    expect(result.source).toBe('internal:score_risk')
  })

  it('1 fator weight=1 value=50 retorna score 50', async () => {
    const factors: RiskFactor[] = [
      { type: 'test', weight: 1, value: 50, description: 'fator único' },
    ]
    const result = await scoreRisk.execute({ factors })
    expect(result.data).toBe(50)
    expect(result.confidence).toBe(1.0)
  })

  it('múltiplos fatores: média ponderada arredondada corretamente', async () => {
    // (0.6 * 80 + 0.4 * 40) / 1 = (48 + 16) = 64
    const factors: RiskFactor[] = [
      { type: 'fator_a', weight: 0.6, value: 80, description: 'fator A' },
      { type: 'fator_b', weight: 0.4, value: 40, description: 'fator B' },
    ]
    const result = await scoreRisk.execute({ factors })
    expect(result.data).toBe(64)
  })

  it('cap em 100 quando valor supera o limite', async () => {
    const factors: RiskFactor[] = [
      { type: 'critico', weight: 1, value: 150, description: 'valor acima de 100' },
    ]
    const result = await scoreRisk.execute({ factors })
    expect(result.data).toBe(100)
  })

  it('cap em 100 com múltiplos fatores de alto valor', async () => {
    const factors: RiskFactor[] = [
      { type: 'a', weight: 0.5, value: 100, description: 'fator a' },
      { type: 'b', weight: 0.5, value: 100, description: 'fator b' },
    ]
    const result = await scoreRisk.execute({ factors })
    expect(result.data).toBe(100)
    expect(result.data).toBeLessThanOrEqual(100)
  })

  it('score é arredondado para inteiro', async () => {
    // (0.5 * 30 + 0.5 * 31) / 1 = 30.5 → 31
    const factors: RiskFactor[] = [
      { type: 'a', weight: 0.5, value: 30, description: 'fator a' },
      { type: 'b', weight: 0.5, value: 31, description: 'fator b' },
    ]
    const result = await scoreRisk.execute({ factors })
    expect(Number.isInteger(result.data)).toBe(true)
    expect(result.data).toBe(31)
  })
})
