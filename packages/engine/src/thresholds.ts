/**
 * Gate de publicação centralizado — TEC-ENG-002 + interruptor por fiscal.
 *
 * Antes: 60/0.70 hardcoded em ~10 lugares (analyzer, api, fiscais, skills).
 * Agora: SSM Parameters em `/fiscal-digital/prod/publish-{risk,confidence}-threshold`
 * e `/fiscal-digital/prod/publish-disabled-fiscais`, cache em memória com TTL,
 * fallback resiliente para defaults.
 *
 * Mudar sem redeploy:
 *   aws ssm put-parameter --overwrite \
 *     --name /fiscal-digital/prod/publish-risk-threshold --value 65 --type String
 *
 * Desligar a publicação de um fiscal (lista separada por vírgula; `none` = nenhum):
 *   aws ssm put-parameter --overwrite \
 *     --name /fiscal-digital/prod/publish-disabled-fiscais --value fiscal-publicidade --type String
 *   ... e religar:  --value none
 * (SSM rejeita valor vazio — por isso a sentinela.)
 *
 * Semântica do interruptor: fiscal desligado (a) não é enfileirado para o
 * publisher e (b) some de todo caminho público de leitura. O atributo
 * `published` do item NÃO é alterado — o flip é reversível sem tocar dado.
 * Fail-safe é CONTINUAR publicando: parâmetro ausente, sentinela ou erro de
 * SSM viram lista vazia. Um fiscalId com erro de digitação é no-op silencioso
 * por desenho; o log "publish gate carregado" existe para isso ser visível.
 *
 * Como usar:
 *   import { getPublishThresholds, isPublishable } from '@fiscal-digital/engine'
 *   const thresholds = await getPublishThresholds()
 *   if (isPublishable(finding, thresholds)) { ... }
 *
 * IAM necessário no consumer Lambda: `ssm:GetParameters` para o path `/fiscal-digital/prod/*`.
 */

import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm'
import { createLogger } from './logger'

const logger = createLogger('thresholds')

export const DEFAULT_PUBLISH_RISK_THRESHOLD = 60
export const DEFAULT_PUBLISH_CONFIDENCE_THRESHOLD = 0.70
/** Sentinela para "nenhum fiscal desligado" — SSM não aceita string vazia. */
export const DISABLED_FISCAIS_NONE = 'none'
/**
 * TTL do cache. Sem TTL, um flip de interruptor só chegava ao container quando
 * ele reciclasse (horas em API quente) e um erro de SSM no cold start pinava
 * os defaults para sempre. 5 min = uma GetParameters por container por 5 min.
 */
export const THRESHOLDS_CACHE_TTL_MS = 5 * 60_000

const RISK_PARAM = '/fiscal-digital/prod/publish-risk-threshold'
const CONFIDENCE_PARAM = '/fiscal-digital/prod/publish-confidence-threshold'
const DISABLED_FISCAIS_PARAM = '/fiscal-digital/prod/publish-disabled-fiscais'

export interface PublishThresholds {
  riskThreshold: number
  confidenceThreshold: number
  /** fiscalIds cuja publicação está desligada. Vazio = todos publicam. */
  disabledFiscais: string[]
}

/** Campos que o gate de publicação consulta — Finding ou item lido do DynamoDB. */
export interface PublishGateInput {
  fiscalId: string
  type?: string
  riskScore?: number
  confidence?: number
  unpublishable?: boolean
}

/**
 * `"fiscal-pessoal, fiscal-diarias,,"` → `['fiscal-pessoal', 'fiscal-diarias']`.
 * Descarta vazios e a sentinela `none` (case-insensitive), sem duplicatas.
 */
export function parseDisabledFiscais(raw: string | undefined | null): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (!id || id.toLowerCase() === DISABLED_FISCAIS_NONE) continue
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * O gate de publicação, num lugar só. Antes era replicado inline no analyzer
 * (enqueue) e em cinco caminhos da API (feed, contagem por cidade, detalhe,
 * fornecedores, stats), e dois deles não checavam `unpublishable`.
 *
 * `disabledFiscais ?? []` tolera thresholds vindos de mocks antigos sem o campo.
 */
export function isPublishable(f: PublishGateInput, t: PublishThresholds): boolean {
  if (!f.type) return false
  if ((f.riskScore ?? 0) < t.riskThreshold) return false
  if ((f.confidence ?? 0) < t.confidenceThreshold) return false
  if (f.unpublishable) return false
  if ((t.disabledFiscais ?? []).includes(f.fiscalId)) return false
  return true
}

let cached: PublishThresholds | null = null
let cachedAt = 0
let inflight: Promise<PublishThresholds> | null = null

const ssmClient = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

/**
 * Carrega o gate do SSM, com cache em memória de THRESHOLDS_CACHE_TTL_MS.
 * Chamadas concorrentes compartilham a mesma promise (dedup inflight).
 * Em caso de falha SSM, retorna defaults (também cacheados pelo TTL, para não
 * martelar o SSM em loop) — Fiscal nunca trava por config.
 */
export async function getPublishThresholds(now: () => number = Date.now): Promise<PublishThresholds> {
  if (cached && now() - cachedAt < THRESHOLDS_CACHE_TTL_MS) return cached
  if (inflight) return inflight

  inflight = (async () => {
    let riskThreshold = DEFAULT_PUBLISH_RISK_THRESHOLD
    let confidenceThreshold = DEFAULT_PUBLISH_CONFIDENCE_THRESHOLD
    let disabledFiscais: string[] = []
    try {
      const res = await ssmClient.send(new GetParametersCommand({
        Names: [RISK_PARAM, CONFIDENCE_PARAM, DISABLED_FISCAIS_PARAM],
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
        if (p.Name === DISABLED_FISCAIS_PARAM && p.Value) {
          disabledFiscais = parseDisabledFiscais(p.Value)
        }
      }
      logger.info('publish gate carregado', { riskThreshold, confidenceThreshold, disabledFiscais })
    } catch (err) {
      logger.warn('SSM threshold load failed — using defaults', {
        riskThreshold: DEFAULT_PUBLISH_RISK_THRESHOLD,
        confidenceThreshold: DEFAULT_PUBLISH_CONFIDENCE_THRESHOLD,
        disabledFiscais: [],
        err: (err as Error).message,
      })
    }
    cached = { riskThreshold, confidenceThreshold, disabledFiscais }
    cachedAt = now()
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
  cachedAt = 0
  inflight = null
}
