import { getAnthropicClient, HAIKU_MODEL } from '../utils/anthropic'
import { extractAll } from '../regex'
import type { ExtractedEntities, Skill, SkillResult } from '../types'

// Cached via prompt caching — define once at module level
const SYSTEM_PROMPT = `Você é um extrator de entidades de diários oficiais municipais brasileiros.
Analise o texto e extraia:
- secretaria: nome da secretaria municipal responsável (string ou null)
- actType: tipo do ato — contrato | licitacao | dispensa | inexigibilidade | nomeacao | exoneracao | aditivo | prorrogacao | outro (string ou null)
- supplier: razão social da empresa ou pessoa contratada (string ou null)
- legalBasis: base legal citada, ex: "Lei 14.133/2021, Art. 75" (string ou null)

Responda APENAS com JSON válido, sem texto adicional.`

export interface ExtractEntitiesInput {
  text: string
  gazetteUrl: string
}

export const extractEntities: Skill<ExtractEntitiesInput, ExtractedEntities> = {
  name: 'extract_entities',
  description: 'Extrai secretaria, tipo do ato, fornecedor e base legal com Claude Haiku (prompt caching)',

  async execute(input: ExtractEntitiesInput): Promise<SkillResult<ExtractedEntities>> {
    const base = extractAll(input.text)

    const anthropic = await getAnthropicClient()

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
      messages: [{ role: 'user', content: input.text.slice(0, 4000) }],
    })

    let llm: Partial<ExtractedEntities> = {}
    try {
      const block = res.content[0]
      if (block.type === 'text') {
        llm = JSON.parse(block.text) as Partial<ExtractedEntities>
      }
    } catch {
      // Regex-only result is still valid — LLM response was malformed
    }

    return {
      data: {
        ...base,
        secretaria: llm.secretaria,
        actType: llm.actType,
        supplier: llm.supplier,
        legalBasis: llm.legalBasis,
      },
      source: input.gazetteUrl,
      confidence: 0.85,
    }
  },
}
