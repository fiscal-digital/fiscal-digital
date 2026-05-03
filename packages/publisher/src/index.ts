import type { SQSEvent } from 'aws-lambda'
import { validateNarrative, createLogger, type Finding } from '@fiscal-digital/engine'

const logger = createLogger('publisher')
import type { PublishChannel } from './channels/types'
import {
  AlreadyPublishedError,
  ChannelDryRunError,
  RateLimitError,
} from './channels/types'
import { loadEnabledChannels } from './channels/registry'
import { PublicationsStore } from './publications-store'

const channels: PublishChannel[] = loadEnabledChannels()
const store = new PublicationsStore()

async function publishOnChannel(
  channel: PublishChannel,
  finding: Finding,
): Promise<void> {
  const findingId = finding.id ?? ''
  if (!findingId) {
    throw new Error(`Finding sem id — fiscal ${finding.fiscalId} cidade ${finding.cityId}`)
  }

  // Pre-check para evitar chamada paga em retry SQS
  if (await store.alreadyPublished(findingId, channel.name)) {
    throw new AlreadyPublishedError(channel.name, findingId)
  }

  const result = await channel.publish(finding)
  await store.recordPublication(findingId, result)
}

export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info('processando', {
    records: event.Records.length,
    channels: channels.map((c) => c.name),
  })

  for (const record of event.Records) {
    let finding: Finding
    try {
      finding = JSON.parse(record.body) as Finding
    } catch (err) {
      logger.error('body inválido — ignorando record', {
        messageId: record.messageId,
        err,
      })
      continue
    }

    const check = validateNarrative(finding.narrative)
    if (!check.valid) {
      logger.error('narrativa rejeitada por brand gate', {
        findingId: finding.id, hits: check.hits,
      })
      // Throw → record vai para DLQ. TODO: regenerar via Haiku no analyzer.
      throw new Error(`narrativa rejeitada: termos proibidos (${check.hits.join(', ')})`)
    }

    const targets = channels.filter((c) => c.enabled(finding))
    if (targets.length === 0) {
      logger.warn('nenhum canal habilitado para finding', {
        findingId: finding.id,
        type: finding.type,
        riskScore: finding.riskScore,
      })
      continue
    }

    const results = await Promise.allSettled(
      targets.map((c) => publishOnChannel(c, finding)),
    )

    let fatal: unknown
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const channelName = targets[i].name
      if (r.status === 'fulfilled') continue

      const err = r.reason
      if (err instanceof RateLimitError) {
        logger.warn('rate limit', {
          channel: channelName,
          retryAfterSeconds: err.retryAfterSeconds,
          findingId: finding.id,
        })
        continue
      }
      if (err instanceof AlreadyPublishedError) {
        logger.info('já publicado — skip idempotente', {
          channel: channelName,
          findingId: finding.id,
        })
        continue
      }
      if (err instanceof ChannelDryRunError) {
        logger.info('dry-run — sem persistência', {
          channel: channelName,
          findingId: finding.id,
        })
        continue
      }
      // Erro fatal — registra mas continua processando outros canais
      logger.error('erro fatal no canal', {
        channel: channelName,
        findingId: finding.id,
        err,
      })
      fatal = err
    }

    // Se algum canal falhou de forma fatal, lança para o record ir pra DLQ
    if (fatal) throw fatal
  }
}
