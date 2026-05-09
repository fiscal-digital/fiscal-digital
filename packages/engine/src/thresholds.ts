/**
 * Thresholds de publicação centralizados — TEC-ENG-002.
 *
 * Antes: 60/0.70 hardcoded em ~10 lugares (analyzer, api, fiscais, skills).
 * Agora: SSM Parameters em `/fiscal-digital/prod/publish-{risk,confidence}-threshold`,
 * cache em memória (cold start), fallback resiliente para defaults.
 *
 * Mudar sem redeploy:
 *   aws ssm put-parameter --overwrite \
 *     --name /fiscal-digital/prod/publish-risk-threshold --value 65 --type String
 *
 * Como usar:
 *   import { getPublishThresholds } from '@fiscal-digital/engine'
 *   const { riskThreshold, confidenceThreshold } = await getPublishThresholds()
 *   if (finding.riskScore >= riskThreshold && finding.confidence >= confidenceThreshold) { ... }
 *
 * IAM necessário no consumer Lambda: `ssm:GetParameters` para o path `/fiscal-digital/prod/*`.
 */

import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm'
import { createLogger } from './logger'

const logger = createLogger('thresholds')

export const DEFAULT_PUBLISH_RISK_THRESHOLD = 60
export const DEFAULT_PUBLISH_CONFIDENCE_THRESHOLD = 0.70

const RISK_PARAM = '/fiscal-digital/prod/publish-risk-threshold'
const CONFIDENCE_PARAM = '/fiscal-digital/prod/publish-confidence-threshold'

export interface PublishThresholds {
  riskThreshold: number
  confidenceThreshold: number
}

let cached: PublishThresholds | null = null
let inflight: Promise<PublishThresholds> | null = null

const ssmClient = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

/**
 * Carrega thresholds do SSM uma vez por cold start (cache em memória).
 * Concurrent calls compartilham a mesma promise (deduplicação inflight).
 * Em caso de falha SSM, retorna defaults — Fiscal nunca trava por config.
 */
export async function getPublishThresholds(): Promise<PublishThresholds> {
  if (cached) return cached
  if (inflight) return inflight

  inflight = (async () => {
    let riskThreshold = DEFAULT_PUBLISH_RISK_THRESHOLD
    let confidenceThreshold = DEFAULT_PUBLISH_CONFIDENCE_THRESHOLD
    try {
      const res = await ssmClient.send(new GetParametersCommand({
        Names: [RISK_PARAM, CONFIDENCE_PARAM],
      }))
      for (const p of res.Parameters ?? []) {
        if (p.Name === RISK_PARAM && p.Value) {
          const n = Number(p.Value)
          if (!Number.isNaN(n)) riskThreshold = n
        }
        if (p.Name === CONFIDENCE_PARAM && p.Value) {
          const n = Number(p.Value)
          if (!Number.isNaN(n)) confidenceThreshold = n
        }
      }
    } catch (err) {
      logger.warn('SSM threshold load failed — using defaults', {
        riskThreshold: DEFAULT_PUBLISH_RISK_THRESHOLD,
        confidenceThreshold: DEFAULT_PUBLISH_CONFIDENCE_THRESHOLD,
        err: (err as Error).message,
      })
    }
    cached = { riskThreshold, confidenceThreshold }
    return cached
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/**
 * Reset do cache — uso em tests apenas.
 */
export function _resetThresholdsCacheForTests(): void {
  cached = null
  inflight = null
}
