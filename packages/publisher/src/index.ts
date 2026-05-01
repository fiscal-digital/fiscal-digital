import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import type { SQSEvent } from 'aws-lambda'
import { getCityOrFallback, type Finding } from '@fiscal-digital/engine'
import { RedditClient, RateLimitError } from './reddit'
import { formatAlertText } from './format'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RedditSecrets {
  client_id: string
  client_secret: string
  username: string
  password: string
}

// ---------------------------------------------------------------------------
// Module-scope cache — reutilizado em Lambda warm starts
// ---------------------------------------------------------------------------

let cachedRedditSecrets: RedditSecrets | null = null

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const secretsClient = new SecretsManagerClient({})

async function loadSecrets(): Promise<RedditSecrets> {
  if (cachedRedditSecrets) return cachedRedditSecrets

  const cmd = new GetSecretValueCommand({
    SecretId: 'fiscaldigital-reddit-prod',
  })
  const res = await secretsClient.send(cmd)

  if (!res.SecretString) {
    throw new Error('Secret fiscaldigital-reddit-prod está vazio ou binário')
  }

  cachedRedditSecrets = JSON.parse(res.SecretString) as RedditSecrets
  return cachedRedditSecrets
}

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

/**
 * Publica um Finding como post de texto no subreddit correspondente.
 * Subreddit é derivado da cidade via `getCityOrFallback`; pode ser overridden
 * por env `REDDIT_SUBREDDIT` (útil em testes/dry-run).
 */
async function publishToReddit(finding: Finding): Promise<void> {
  const creds = await loadSecrets()
  const client = new RedditClient(creds)
  const city = getCityOrFallback(finding.cityId)

  const subreddit = process.env.REDDIT_SUBREDDIT ?? city.subreddit

  const token = await client.getAccessToken()
  const title = `[${finding.type.replace(/_/g, '-').toUpperCase()}] ${city.name} — riskScore ${finding.riskScore}/100`
  const text = formatAlertText(finding)

  const result = await client.submitText(
    token.access_token,
    subreddit,
    title,
    text,
  )

  console.log('[publisher] Reddit post criado', {
    url: result.json.data.url,
    id: result.json.data.id,
    findingId: finding.id,
    riskScore: finding.riskScore,
  })
}

// ---------------------------------------------------------------------------
// Lambda Handler
// ---------------------------------------------------------------------------

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('[publisher] processando', { records: event.Records.length })

  for (const record of event.Records) {
    let finding: Finding

    try {
      finding = JSON.parse(record.body) as Finding
    } catch (err) {
      console.error('[publisher] body inválido — ignorando record', {
        messageId: record.messageId,
        err,
      })
      continue
    }

    // Publicar no Reddit
    try {
      await publishToReddit(finding)
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Logar e continuar — SQS retry fará nova tentativa no próximo ciclo
        console.warn('[publisher] rate limit Reddit', {
          retryAfterSeconds: err.retryAfterSeconds,
          findingId: finding.id,
        })
        continue
      }
      // Outros erros: relançar para que o record vá para a DLQ
      throw err
    }

    // TODO: twitter-api-v2 publish
  }
}
