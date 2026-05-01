import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import type { Finding } from '@fiscal-digital/engine'
import type { PublishChannel, PublishResult } from '../types'
import { ChannelDryRunError } from '../types'
import { XClient, type XCredentials } from './client'
import { formatTweet, tweetLength } from './format'

const X_SECRET_ID = 'fiscaldigital-x-prod'
const X_USERNAME = 'LiFiscalDigital'

let cachedClient: XClient | null = null
const secretsClient = new SecretsManagerClient({})

async function loadClient(): Promise<XClient> {
  if (cachedClient) return cachedClient

  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: X_SECRET_ID }),
  )
  if (!res.SecretString) {
    throw new Error(`Secret ${X_SECRET_ID} vazio ou binário`)
  }

  const creds = JSON.parse(res.SecretString) as XCredentials
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
      console.log('[x] DRY_RUN — credentials OK', {
        asUser: me.username,
        expected: X_USERNAME,
        matches,
      })
      if (!matches) {
        throw new Error(
          `[x] DRY_RUN abort — token autoriza @${me.username} mas esperávamos @${X_USERNAME}. Regerar Access Token logado como @${X_USERNAME}.`,
        )
      }
      console.log('[x] DRY_RUN — would tweet', {
        findingId: finding.id,
        length,
        preview: text,
      })
      throw new ChannelDryRunError('x', text)
    }

    const client = await loadClient()
    const posted = await client.tweet(text)

    console.log('[x] tweet posted', {
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
