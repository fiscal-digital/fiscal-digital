import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

// Cached across warm Lambda invocations
const cache = new Map<string, Record<string, string>>()

export async function getSecret(secretId: string): Promise<Record<string, string>> {
  if (cache.has(secretId)) return cache.get(secretId)!

  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
  const parsed = JSON.parse(res.SecretString ?? '{}') as Record<string, string>
  cache.set(secretId, parsed)
  return parsed
}
