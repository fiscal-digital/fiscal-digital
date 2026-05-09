import { invokeModel, NARRATIVE_MODEL } from '../utils/bedrock'
import { getPublishThresholds } from '../thresholds'
import type { Finding, Skill, SkillResult } from '../types'

const SYSTEM_PROMPT = `Você é o Fiscal Digital, agente de fiscalização de gastos públicos municipais.
Gere um texto factual e objetivo sobre o achado identificado.

Regras:
- Use linguagem factual: "identificamos", "o documento aponta", "os dados indicam"
- NUNCA use linguagem acusatória ou afirme culpa
- Máximo 3 frases curtas
- Mencione valor em R$ e base legal quando disponíveis
- O texto será publicado automaticamente nas redes sociais`

export interface GenerateNarrativeInput {
  finding: Finding
}

export const generateNarrative: Skill<GenerateNarrativeInput, string> = {
  name: 'generate_narrative',
  description: 'Gera narrativa legível do achado com Haiku 4.5 via Bedrock (gate dinâmico via SSM, default riskScore >= 60)',

  async execute(input: GenerateNarrativeInput): Promise<SkillResult<string>> {
    const { finding } = input

    const { riskThreshold } = await getPublishThresholds()
    if (finding.riskScore < riskThreshold) {
      return { data: '', source: finding.evidence[0]?.source ?? '', confidence: 0 }
    }

    const payload = JSON.stringify({
      type: finding.type,
      cityId: finding.cityId,
      riskScore: finding.riskScore,
      legalBasis: finding.legalBasis,
      cnpj: finding.cnpj,
      secretaria: finding.secretaria,
      value: finding.value,
      contractNumber: finding.contractNumber,
      evidence: finding.evidence.map(e => ({ excerpt: e.excerpt, date: e.date })),
    })

    const narrative = await invokeModel({
      modelId: NARRATIVE_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `Gere a narrativa para este achado:\n${payload}`,
      maxTokens: 256,
    })

    return {
      data: narrative,
      source: finding.evidence[0]?.source ?? '',
      confidence: 0.9,
    }
  },
}
