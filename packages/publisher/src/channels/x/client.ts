import { TwitterApi, ApiResponseError } from 'twitter-api-v2'
import { RateLimitError } from '../types'

/**
 * OAuth 1.0a User Context — schema do secret fiscaldigital-x-prod.
 *
 * 4 keys obtidas em developer.x.com → app → Keys and tokens:
 *   - Consumer Keys (API Key + API Key Secret)
 *   - Authentication Tokens (Access Token + Access Token Secret)
 *
 * Access Token deve ser gerado **logado como @LiFiscalDigital**, com permissão
 * Read+Write já salva em User authentication settings — caso contrário, herda
 * Read-only e o tweet falha com 403.
 *
 * Nomes em snake_case por convenção do CLAUDE.md; mapeados para appKey/appSecret/
 * accessToken/accessSecret pelo SDK twitter-api-v2.
 */
export interface XCredentials {
  api_key: string
  api_secret: string
  access_token: string
  access_token_secret: string
}

export interface PostedTweet {
  id: string
  text: string
  url: string
}

export class XClient {
  private readonly api: TwitterApi

  constructor(creds: XCredentials, private readonly username: string) {
    this.api = new TwitterApi({
      appKey: creds.api_key,
      appSecret: creds.api_secret,
      accessToken: creds.access_token,
      accessSecret: creds.access_token_secret,
    })
  }

  /**
   * Valida credenciais sem efeito colateral via /2/users/me.
   * Útil em smoke test e em cold start de Lambda para falhar cedo se as keys estão erradas.
   */
  async verifyCredentials(): Promise<{ username: string; id: string }> {
    try {
      const me = await this.api.v2.me()
      return { username: me.data.username, id: me.data.id }
    } catch (err) {
      this.rethrow(err, 'verifyCredentials')
    }
  }

  /**
   * Posta tweet via POST /2/tweets.
   * @throws RateLimitError em 429 — caller loga e deixa SQS retry no próximo ciclo
   * @throws Error em 401 (creds erradas), 403 (app sem Read+Write), 5xx (retry)
   */
  async tweet(text: string): Promise<PostedTweet> {
    try {
      const res = await this.api.v2.tweet(text)
      return {
        id: res.data.id,
        text: res.data.text,
        url: `https://x.com/${this.username}/status/${res.data.id}`,
      }
    } catch (err) {
      this.rethrow(err, 'tweet')
    }
  }

  private rethrow(err: unknown, op: string): never {
    if (err instanceof ApiResponseError) {
      if (err.code === 429 || err.rateLimitError) {
        const reset = err.rateLimit?.reset
        const retryAfterSeconds = reset
          ? Math.max(0, reset - Math.floor(Date.now() / 1000))
          : 900
        throw new RateLimitError(
          'x',
          retryAfterSeconds,
          `X 429 em ${op} — reset em ${retryAfterSeconds}s`,
        )
      }
      throw new Error(
        `X API ${op} error: HTTP ${err.code} — ${err.data?.detail ?? err.message}`,
      )
    }
    throw err
  }
}
