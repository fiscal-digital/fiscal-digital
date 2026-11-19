import { createLogger } from '@fiscal-digital/engine'

const logger = createLogger('x')
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import type { Finding } from '@fiscal-digital/engine'
import type { PublishChannel, PublishResult } from '../types'
import { ChannelDryRunError } from '../types'
import { XClient, type XCredentials } from './client'
import { formatTweet, tweetLength } from './format'

// SSM SecureString (saiu do Secrets Manager em 2026-11-19 por custo)
const X_PARAM_NAME = '/fiscal-digital/prod/x'
const X_USERNAME = 'LiFiscalDigital'

let cachedClient: XClient | null = null
const ssmClient = new SSMClient({})

async function loadClient(): Promise<XClient> {
  if (cachedClient) return cachedClient

  const res = await ssmClient.send(
    new GetParameterCommand({ Name: X_PARAM_NAME, WithDecryption: true }),
  )
  const raw = res.Parameter?.Value
  if (!raw) {
    throw new Error(`Parametro ${X_PARAM_NAME} vazio`)
  }

  const creds = JSON.parse(raw) as XCredentials
  cachedClient = new XClient(creds, X_USERNAME)
  return cachedClient
}

export class XChannel implements PublishChannel {
  readonly name = 'x' as const

  enabled(_finding: Finding): boolean {
    return process.env.X_ENABLED === 'true'
  }

  async publish(finding: Finding): Promise<PublishResult> {
    const text = formatTweet(finding)
    const length = tweetLength(text)

    if (process.env.X_DRY_RUN === 'true') {
      // Validar credenciais real — falha aqui é melhor que falha no primeiro post real
      const client = await loadClient()
      const me = await client.verifyCredentials()
      const matches = me.username === X_USERNAME
      logger.info('DRY_RUN — credentials OK', {
        asUser: me.username,
        expected: X_USERNAME,
        matches,
      })
      if (!matches) {
        throw new Error(
          `[x] DRY_RUN abort — token autoriza @${me.username} mas esperávamos @${X_USERNAME}. Regerar Access Token logado como @${X_USERNAME}.`,
        )
      }
      logger.info('DRY_RUN — would tweet', {
        findingId: finding.id,
        length,
        preview: text,
      })
      throw new ChannelDryRunError('x', text)
    }

    const client = await loadClient()
    const posted = await client.tweet(text)

    logger.info('tweet posted', {
      findingId: finding.id,
      tweetId: posted.id,
      url: posted.url,
      length,
    })

    return {
      channel: 'x',
      externalId: posted.id,
      url: posted.url,
      publishedAt: new Date().toISOString(),
    }
  }
}
