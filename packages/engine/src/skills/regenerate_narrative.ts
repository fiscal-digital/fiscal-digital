import { invokeModel, NARRATIVE_MODEL } from '../utils/bedrock'
import { getUseInsteadFor } from '../brand-gate'
import type { Finding } from '../types'

const SYSTEM_PROMPT_BASE = `Você é o Fiscal Digital, agente de fiscalização de gastos públicos municipais.
Gere um texto factual e objetivo sobre o achado identificado.

Regras:
- Use linguagem factual: "identificamos", "o documento aponta", "os dados indicam"
- NUNCA use linguagem acusatória ou afirme culpa
- Máximo 3 frases curtas
- Mencione valor em R$ e base legal quando disponíveis
- O texto será publicado automaticamente nas redes sociais`

/**
 * Gera nova narrativa para um finding cuja narrativa anterior foi rejeitada
 * pelo brand gate. Combina temperatura > 0 (quebra o determinismo do
 * `invokeModel`) com prompt aumentado que lista exatamente os termos
 * proibidos detectados e suas substituições curadas (`use_instead`).
 *
 * Cada `attempt` (1..3) usa temperatura crescente — 0.5, 0.7, 0.9 — porque:
 * - A 1ª regeneração já tem o prompt explicitando o termo a evitar; baixa
 *   temperatura preserva o estilo factual.
 * - Tentativas seguintes precisam quebrar mais o padrão para escapar do
 *   modo de fala que o modelo caiu.
 *
 * Não sabe sobre o brand gate em si; o caller é responsável por validar a
 * saída e decidir entre re-tentar ou marcar `unpublishable`.
 */
export async function regenerateNarrative(
  finding: Finding,
  previousHits: string[],
  attempt: number,
): Promise<string> {
  const avoidedTerms = previousHits.length
    ? previousHits.map((h) => `"${h}"`).join(', ')
    : '(nenhum termo específico — reformule completamente)'

  const useInsteadList = getUseInsteadFor(previousHits)
  const useInstead = useInsteadList.length
    ? useInsteadList.join(', ')
    : 'reformular completamente, sem afirmar crime ou culpa'

  const augmentedSystem = `${SYSTEM_PROMPT_BASE}

ATENÇÃO — REGENERAÇÃO ${attempt} DE 3:
A geração anterior foi rejeitada por conter os termos: ${avoidedTerms}.
NÃO use esses termos sob nenhuma hipótese.
Use no lugar: ${useInstead}.`

  const payload = JSON.stringify({
    type: finding.type,
    cityId: finding.cityId,
    riskScore: finding.riskScore,
    legalBasis: finding.legalBasis,
    cnpj: finding.cnpj,
    secretaria: finding.secretaria,
    value: finding.value,
    contractNumber: finding.contractNumber,
    evidence: finding.evidence.map((e) => ({ excerpt: e.excerpt, date: e.date })),
  })

  const temperature = Math.min(0.3 + attempt * 0.2, 0.9)

  return invokeModel({
    modelId: NARRATIVE_MODEL,
    systemPrompt: augmentedSystem,
    userMessage: `Gere a narrativa para este achado:\n${payload}`,
    maxTokens: 256,
    temperature,
  })
}
