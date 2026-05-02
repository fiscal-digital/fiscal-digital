/**
 * RedditClient — fetch nativo Node 24, sem snoowrap.
 * Usa OAuth2 Resource Owner Password Credentials (script app).
 */

export interface RedditCredentials {
  client_id: string
  client_secret: string
  username: string
  password: string
}

export interface AccessTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

export interface SubmitResponse {
  json: {
    data: {
      url: string
      id: string
    }
    errors: unknown[]
  }
}

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Reddit rate limit hit — retry after ${retryAfterSeconds}s`)
    this.name = 'RateLimitError'
  }
}

export class RedditClient {
  private readonly userAgent: string
  private readonly basicAuth: string

  constructor(private readonly creds: RedditCredentials) {
    this.userAgent = `web:fiscal-digital:0.1.0 (by /u/${creds.username})`
    // btoa não está disponível em todos os contextos Node; usar Buffer como fallback seguro
    this.basicAuth = Buffer.from(
      `${creds.client_id}:${creds.client_secret}`,
    ).toString('base64')
  }

  /**
   * Obtém access token via Resource Owner Password Credentials.
   * @throws Error se o status HTTP não for 200.
   */
  async getAccessToken(): Promise<AccessTokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.creds.username,
      password: this.creds.password,
    })

    const res = await globalThis.fetch(
      'https://www.reddit.com/api/v1/access_token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        body: body.toString(),
      },
    )

    if (!res.ok) {
      throw new Error(
        `Reddit token error: HTTP ${res.status} — ${await res.text()}`,
      )
    }

    return res.json() as Promise<AccessTokenResponse>
  }

  /**
   * Submete um post de texto (self post) no subreddit informado.
   * Verifica headers de rate limit antes de considerar a resposta bem-sucedida.
   * @throws RateLimitError se remaining < 1 (parse do header x-ratelimit-remaining).
   * @throws Error para outros erros HTTP.
   */
  async submitText(
    token: string,
    subreddit: string,
    title: string,
    text: string,
  ): Promise<SubmitResponse> {
    const body = new URLSearchParams({
      kind: 'self',
      sr: subreddit,
      title,
      text,
      api_type: 'json',
    })

    const res = await globalThis.fetch(
      'https://oauth.reddit.com/api/submit',
      {
        method: 'POST',
        headers: {
          Authorization: `bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        body: body.toString(),
      },
    )

    // Verificar rate limit nos headers da resposta
    const remaining = parseFloat(
      res.headers.get('x-ratelimit-remaining') ?? '999',
    )
    const resetSeconds = parseInt(
      res.headers.get('x-ratelimit-reset') ?? '0',
      10,
    )

    if (remaining < 1) {
      throw new RateLimitError(resetSeconds)
    }

    if (!res.ok) {
      throw new Error(
        `Reddit submit error: HTTP ${res.status} — ${await res.text()}`,
      )
    }

    return res.json() as Promise<SubmitResponse>
  }
}
