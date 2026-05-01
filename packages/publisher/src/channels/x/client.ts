import { TwitterApi, ApiResponseError } from 'twitter-api-v2'
import { RateLimitError } from '../types'

/**
 * Credenciais OAuth 1.0a User Context da app no developer.x.com.
 * Schema gravado em AWS Secrets Manager (secret: fiscaldigital-x-prod).
 *
 * Nomes em snake_case por convenção do CLAUDE.md / outros bots.
 * São mapeados para appKey/appSecret/accessToken/accessSecret pelo SDK.
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
  url: string // canonical URL — derivada do username + id
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
   * Valida credenciais sem efeito colateral chamando /2/users/me.
   * Útil em smoke test e em cold start de Lambda para falhar cedo se as keys estão erradas.
   * @returns username retornado pelo X — útil para verificar se token aponta pra conta certa
   */
  async verifyCredentials(): Promise<{ username: string; id: string }> {
    try {
      const me = await this.api.v2.me()
      return { username: me.data.username, id: me.data.id }
    } catch (err) {
      this.rethrow(err)
    }
  }

  /**
   * Posta um tweet via POST /2/tweets.
   * @throws RateLimitError se 429 — caller deve logar e deixar SQS retry no próximo ciclo
   * @throws Error com mensagem clara para outros HTTP errors (401 = creds erradas, 403 = permissão Read-only, etc.)
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
      this.rethrow(err)
    }
  }

  private rethrow(err: unknown): never {
    if (err instanceof ApiResponseError) {
      if (err.code === 429 || err.rateLimitError) {
        const reset = err.rateLimit?.reset // unix timestamp em segundos
        const retryAfterSeconds = reset
          ? Math.max(0, reset - Math.floor(Date.now() / 1000))
          : 900 // fallback: 15min (janela padrão do X)
        throw new RateLimitError('x', retryAfterSeconds, `X 429 — reset em ${retryAfterSeconds}s`)
      }
      throw new Error(
        `X API error: HTTP ${err.code} — ${err.data?.detail ?? err.message}`,
      )
    }
    throw err
  }
}
