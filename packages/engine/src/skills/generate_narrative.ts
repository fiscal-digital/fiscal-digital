import { getAnthropicClient, HAIKU_MODEL } from '../utils/anthropic'
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

export const generateNarrative: Skill<GenerateNarrativeInput> = {
  name: 'generate_narrative',
  description: 'Gera narrativa legível do achado com Claude Haiku (somente riskScore >= 60)',

  async execute(input: GenerateNarrativeInput): Promise<SkillResult<string>> {
    const { finding } = input

    if (finding.riskScore < 60) {
      return { data: '', source: finding.evidence[0]?.source ?? '', confidence: 0 }
    }

    const anthropic = await getAnthropicClient()

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

    const res = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: `Gere a narrativa para este achado:\n${payload}` }],
    })

    const block = res.content[0]
    const narrative = block.type === 'text' ? block.text.trim() : ''

    return {
      data: narrative,
      source: finding.evidence[0]?.source ?? '',
      confidence: 0.9,
    }
  },
}
