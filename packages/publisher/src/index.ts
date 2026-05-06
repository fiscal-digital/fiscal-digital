import type { SQSEvent } from 'aws-lambda'
import {
  validateNarrative,
  regenerateNarrative,
  createLogger,
  type Finding,
} from '@fiscal-digital/engine'

const logger = createLogger('publisher')

/**
 * Tentativas máximas de regeneração contra o brand gate antes de marcar
 * finding como `unpublishable`. Haiku é estocástico (temperature > 0 nas
 * regenerações) + prompt aumentado com termos a evitar — empiricamente
 * 3 tentativas cobrem >95% dos casos.
 */
const MAX_REGEN_ATTEMPTS = 3
import type { PublishChannel } from './channels/types'
import {
  AlreadyPublishedError,
  ChannelDryRunError,
  RateLimitError,
} from './channels/types'
import { loadEnabledChannels } from './channels/registry'
import { PublicationsStore } from './publications-store'
import { notifyWebRevalidate } from './web-revalidate'

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
    const gazetteId = record.messageAttributes?.['gazetteId']?.stringValue ?? 'unknown'
    logger.appendKeys({ gazetteId })
    let finding: Finding
    try {
      finding = JSON.parse(record.body) as Finding
    } catch (err) {
      logger.error('body inválido — ignorando record', {
        messageId: record.messageId,
        err,
      })
      logger.removeKeys(['gazetteId'])
      continue
    }

    // Brand gate com regeneração N×: brand gate é proteção crítica
    // (princípio "não acusar, informar"), mas Haiku ocasionalmente derrapa
    // em "desvio"/"fraud". Em vez de throw → DLQ (estado anterior), tentamos
    // regenerar com prompt aumentado. Se exaustão, marcamos `unpublishable`
    // no DDB (audit trail preservado) e seguimos. Nunca throw aqui.
    let validatedNarrative = finding.narrative
    let validationCheck = validateNarrative(validatedNarrative)

    for (
      let attempt = 1;
      attempt <= MAX_REGEN_ATTEMPTS && !validationCheck.valid;
      attempt++
    ) {
      logger.warn('brand gate hit — regenerando', {
        findingId: finding.id,
        attempt,
        maxAttempts: MAX_REGEN_ATTEMPTS,
        hits: validationCheck.hits,
      })
      try {
        validatedNarrative = await regenerateNarrative(
          finding,
          validationCheck.hits,
          attempt,
        )
        validationCheck = validateNarrative(validatedNarrative)
      } catch (err) {
        logger.error('falha ao regenerar narrativa', {
          findingId: finding.id,
          attempt,
          err,
        })
        break
      }
    }

    if (!validationCheck.valid) {
      logger.warn('brand gate exaurido — marcando unpublishable', {
        findingId: finding.id,
        finalHits: validationCheck.hits,
      })
      if (finding.id) {
        try {
          await store.markUnpublishable(
            finding.id,
            'brand_gate',
            validationCheck.hits,
          )
        } catch (err) {
          logger.error('falha ao marcar unpublishable', {
            findingId: finding.id,
            err,
          })
        }
      }
      logger.removeKeys(['gazetteId'])
      continue
    }

    // Substitui a narrativa do finding pela versão validada (pode ser a
    // original que passou de cara, ou uma regenerada que passou). Canais
    // recebem `finding` já com narrativa válida.
    finding.narrative = validatedNarrative

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

    // ISR-WEB-002: notifica site para purga imediata de cache (best-effort).
    // Roda independente de canais terem publicado — finding já está em DDB
    // e site exibe a partir daí. Não bloqueia DLQ logic.
    await notifyWebRevalidate(finding)

    // Se algum canal falhou de forma fatal, lança para o record ir pra DLQ
    if (fatal) throw fatal
  }
}
