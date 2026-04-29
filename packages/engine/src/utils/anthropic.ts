import Anthropic from '@anthropic-ai/sdk'
import { getSecret } from './secrets'

let _client: Anthropic | null = null

export async function getAnthropicClient(): Promise<Anthropic> {
  if (_client) return _client
  const secret = await getSecret('fiscaldigital-anthropic-prod')
  _client = new Anthropic({ apiKey: secret['api_key'] })
  return _client
}

export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
