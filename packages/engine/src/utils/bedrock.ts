import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'

const client = new BedrockRuntimeClient({ region: 'us-east-1' })

export const EXTRACTION_MODEL = 'amazon.nova-lite-v1:0'
export const NARRATIVE_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'

export interface InvokeModelParams {
  modelId: string
  systemPrompt: string
  userMessage: string
  maxTokens: number
}

export async function invokeModel(params: InvokeModelParams): Promise<string> {
  const command = new ConverseCommand({
    modelId: params.modelId,
    system: [{ text: params.systemPrompt }],
    messages: [{ role: 'user', content: [{ text: params.userMessage }] }],
    inferenceConfig: { maxTokens: params.maxTokens, temperature: 0 },
  })

  const response = await client.send(command)
  const raw = response.output?.message?.content?.[0]?.text ?? ''
  // Nova Lite and some models wrap JSON in ```json ``` — strip if present
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
}
