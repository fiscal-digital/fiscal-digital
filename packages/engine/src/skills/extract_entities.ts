import { invokeModel, EXTRACTION_MODEL } from '../utils/bedrock'
import { extractAll } from '../regex'
import type { ExtractedEntities, Skill, SkillResult } from '../types'

const SYSTEM_PROMPT = `Você é um extrator de entidades de diários oficiais municipais brasileiros.
Analise o texto e extraia:
- secretaria: nome da secretaria municipal responsável (string ou null)
- actType: tipo do ato — contrato | licitacao | dispensa | inexigibilidade | nomeacao | exoneracao | aditivo | prorrogacao | outro (string ou null)
- supplier: razão social da empresa ou pessoa contratada (string ou null)
- legalBasis: base legal citada, ex: "Lei 14.133/2021, Art. 75" (string ou null)
- subtype: classifica o objeto da contratação para determinar o inciso da Lei 14.133/2021 Art. 75 —
  "obra_engenharia" (obras civis, reforma de imóvel/prédio/escola/estrada, construção, pavimentação) |
  "servico" (consultoria, assessoria, manutenção de equipamentos não-imobiliária, limpeza, eventos, tecnologia da informação) |
  "compra" (aquisição de bens, equipamentos, veículos, materiais) |
  null (ambíguo ou não aplicável)
- valorOriginalContrato: quando o texto for de aditivo e citar explicitamente o valor original do contrato (ex: "valor original de R$ X", "contrato originalmente firmado por R$ X", "valor inicial do contrato de R$ X"), extrair o número; null caso contrário

Responda APENAS com JSON válido, sem texto adicional.`

export interface ExtractEntitiesInput {
  text: string
  gazetteUrl: string
}

export const extractEntities: Skill<ExtractEntitiesInput, ExtractedEntities> = {
  name: 'extract_entities',
  description: 'Extrai secretaria, tipo do ato, fornecedor e base legal com Nova Lite via Bedrock',

  async execute(input: ExtractEntitiesInput): Promise<SkillResult<ExtractedEntities>> {
    const base = extractAll(input.text)

    const text = await invokeModel({
      modelId: EXTRACTION_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: input.text.slice(0, 4000),
      maxTokens: 256,
    })

    let llm: Partial<ExtractedEntities> = {}
    try {
      llm = JSON.parse(text) as Partial<ExtractedEntities>
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
        subtype: llm.subtype ?? null,
        valorOriginalContrato: llm.valorOriginalContrato ?? undefined,
      },
      source: input.gazetteUrl,
      confidence: 0.85,
    }
  },
}
