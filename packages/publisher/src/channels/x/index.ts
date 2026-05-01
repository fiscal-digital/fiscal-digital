import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import type { Finding } from '@fiscal-digital/engine'
import type { PublishChannel, PublishResult } from '../types'
import { XClient, type XCredentials } from './client'
import { formatTweet, tweetLength } from './format'

const X_SECRET_ID = 'fiscaldigital-x-prod'
const X_USERNAME = 'LiFiscalDigital' // bot oficial — CLAUDE.md

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
      console.log('[x] DRY_RUN — would tweet', {
        findingId: finding.id,
        length,
        preview: text,
      })
      return {
        channel: 'x',
        externalId: 'dry-run',
        url: `https://x.com/${X_USERNAME}/status/dry-run`,
        publishedAt: new Date().toISOString(),
      }
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
