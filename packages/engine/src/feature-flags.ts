/**
 * Feature flags via SSM Parameter Store — toggle de comportamento sem redeploy.
 *
 * Pattern compartilhado com `thresholds.ts`: cache em memória (cold start),
 * inflight dedup, fallback resiliente para `false` (fail-safe).
 *
 * Mudar uma flag em prod:
 *   aws ssm put-parameter --overwrite \
 *     --name /fiscal-digital/prod/enable-X --value true --type String
 *
 * Como usar:
 *   import { isFeatureEnabled } from '@fiscal-digital/engine'
 *   if (await isFeatureEnabled('enable-supplier-write')) { ... }
 *
 * IAM necessário no consumer Lambda: `ssm:GetParameter` para o path
 * `/fiscal-digital/prod/enable-*`.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { createLogger } from './logger'

const logger = createLogger('feature-flags')

const ssmClient = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

const cache = new Map<string, boolean>()
const inflight = new Map<string, Promise<boolean>>()

/**
 * Lê a flag `enable-{name}` do SSM. Retorna `false` em caso de falha
 * (fail-safe: features novas só ligam quando explicitamente habilitadas).
 */
export async function isFeatureEnabled(name: string): Promise<boolean> {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const existing = inflight.get(name)
  if (existing) return existing

  const promise = (async () => {
    try {
      const res = await ssmClient.send(new GetParameterCommand({
        Name: `/fiscal-digital/prod/${name}`,
      }))
      const enabled = res.Parameter?.Value === 'true'
      cache.set(name, enabled)
      return enabled
    } catch (err) {
      logger.warn('feature flag read falhou — desabilitando', {
        name,
        err: (err as Error).message,
      })
      cache.set(name, false)
      return false
    } finally {
      inflight.delete(name)
    }
  })()

  inflight.set(name, promise)
  return promise
}

/** Reset do cache — uso em tests apenas. */
export function _resetFeatureFlagsCacheForTests(): void {
  cache.clear()
  inflight.clear()
}
