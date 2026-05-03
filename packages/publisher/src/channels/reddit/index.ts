import { createLogger } from '@fiscal-digital/engine'

const logger = createLogger('reddit')
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import { getCityOrFallback, type Finding } from '@fiscal-digital/engine'
import type { PublishChannel, PublishResult } from '../types'
import { ChannelDryRunError, RateLimitError as ChannelRateLimitError } from '../types'
import {
  RedditClient,
  RateLimitError as RedditRateLimitError,
  type RedditCredentials,
} from '../../reddit'
import { formatRedditPost } from './format'
import { checkRedditRateLimit } from '../../utils/reddit-throttle'

const REDDIT_SECRET_ID = 'fiscaldigital-reddit-prod'

let cachedCreds: RedditCredentials | null = null
const secretsClient = new SecretsManagerClient({})

async function loadCreds(): Promise<RedditCredentials> {
  if (cachedCreds) return cachedCreds
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: REDDIT_SECRET_ID }),
  )
  if (!res.SecretString) {
    throw new Error(`Secret ${REDDIT_SECRET_ID} vazio ou binário`)
  }
  cachedCreds = JSON.parse(res.SecretString) as RedditCredentials
  return cachedCreds
}

export class RedditChannel implements PublishChannel {
  readonly name = 'reddit' as const

  enabled(_finding: Finding): boolean {
    return process.env.REDDIT_ENABLED === 'true'
  }

  async publish(finding: Finding): Promise<PublishResult> {
    const city = getCityOrFallback(finding.cityId)
    const subreddit = process.env.REDDIT_SUBREDDIT ?? city.subreddit
    const { title, body } = formatRedditPost(finding)

    if (process.env.REDDIT_DRY_RUN === 'true') {
      logger.info('DRY_RUN — would post', {
        findingId: finding.id,
        subreddit,
        title,
      })
      throw new ChannelDryRunError('reddit', `${title}\n\n${body}`)
    }

    checkRedditRateLimit()

    const creds = await loadCreds()
    const client = new RedditClient(creds)
    const token = await client.getAccessToken()

    try {
      const result = await client.submitText(
        token.access_token,
        subreddit,
        title,
        body,
      )

      logger.info('post created', {
        findingId: finding.id,
        url: result.json.data.url,
        id: result.json.data.id,
      })

      return {
        channel: 'reddit',
        externalId: result.json.data.id,
        url: result.json.data.url,
        publishedAt: new Date().toISOString(),
      }
    } catch (err) {
      if (err instanceof RedditRateLimitError) {
        throw new ChannelRateLimitError('reddit', err.retryAfterSeconds, err.message)
      }
      throw err
    }
  }
}
