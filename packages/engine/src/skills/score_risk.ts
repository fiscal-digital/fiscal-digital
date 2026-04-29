import type { RiskFactor, Skill, SkillResult } from '../types'

export interface ScoreRiskInput {
  factors: RiskFactor[]
}

export const scoreRisk: Skill<ScoreRiskInput> = {
  name: 'score_risk',
  description: 'Calcula riskScore composto (0–100) baseado em fatores ponderados',

  async execute(input: ScoreRiskInput): Promise<SkillResult<number>> {
    const { factors } = input
    if (factors.length === 0) return { data: 0, source: 'internal:score_risk', confidence: 1.0 }

    const totalWeight = factors.reduce((s, f) => s + f.weight, 0)
    const score = Math.min(100, Math.round(
      factors.reduce((s, f) => s + f.weight * f.value, 0) / totalWeight,
    ))

    return { data: score, source: 'internal:score_risk', confidence: 1.0 }
  },
}
