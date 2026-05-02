import { RedditClient, RateLimitError } from '../reddit'
import type { RedditCredentials, AccessTokenResponse, SubmitResponse } from '../reddit'

const CREDS: RedditCredentials = {
  client_id: 'test_client_id',
  client_secret: 'test_client_secret',
  username: 'test_user',
  password: 'test_pass',
}

// Helper para montar um Response-like mock
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const headersMap = new Headers(headers)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersMap,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('RedditClient', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn()
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).fetch
  })

  // -----------------------------------------------------------------------
  // Caso 1 — getAccessToken success
  // -----------------------------------------------------------------------
  it('getAccessToken: retorna access_token e envia headers corretos', async () => {
    const tokenResponse: AccessTokenResponse = {
      access_token: 'tok_abc',
      token_type: 'bearer',
      expires_in: 3600,
      scope: '*',
    }

    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(tokenResponse),
    )

    const client = new RedditClient(CREDS)
    const result = await client.getAccessToken()

    expect(result.access_token).toBe('tok_abc')
    expect(result.expires_in).toBe(3600)

    const [url, opts] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://www.reddit.com/api/v1/access_token')

    const headers = opts.headers as Record<string, string>

    // Validar User-Agent no formato exigido pela Reddit API
    expect(headers['User-Agent']).toBe(
      `web:fiscal-digital:0.1.0 (by /u/${CREDS.username})`,
    )

    // Validar Authorization Basic (base64 de client_id:client_secret)
    const expectedB64 = Buffer.from(
      `${CREDS.client_id}:${CREDS.client_secret}`,
    ).toString('base64')
    expect(headers['Authorization']).toBe(`Basic ${expectedB64}`)

    // Validar body contém grant_type=password
    expect(opts.body?.toString()).toContain('grant_type=password')
  })

  // -----------------------------------------------------------------------
  // Caso 2 — getAccessToken 401
  // -----------------------------------------------------------------------
  it('getAccessToken: lança Error claro em resposta 401', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse({ message: 'Unauthorized' }, 401),
    )

    const client = new RedditClient(CREDS)

    await expect(client.getAccessToken()).rejects.toThrow(
      /Reddit token error: HTTP 401/,
    )
  })

  // -----------------------------------------------------------------------
  // Caso 3 — submitText success
  // -----------------------------------------------------------------------
  it('submitText: retorna url/id e envia Authorization bearer', async () => {
    const submitResp: SubmitResponse = {
      json: {
        data: { url: 'https://reddit.com/r/test/comments/abc123', id: 'abc123' },
        errors: [],
      },
    }

    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(submitResp, 200, {
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': '600',
      }),
    )

    const client = new RedditClient(CREDS)
    const result = await client.submitText(
      'tok_abc',
      'test',
      'Título do post',
      'Conteúdo',
    )

    expect(result.json.data.id).toBe('abc123')
    expect(result.json.data.url).toContain('reddit.com')

    const [, opts] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBe('bearer tok_abc')
  })

  // -----------------------------------------------------------------------
  // Caso 4 — submitText 429 via header x-ratelimit-remaining: 0
  // -----------------------------------------------------------------------
  it('submitText: lança RateLimitError quando x-ratelimit-remaining=0', async () => {
    const submitResp: SubmitResponse = {
      json: {
        data: { url: 'https://reddit.com/r/test/comments/xyz', id: 'xyz' },
        errors: [],
      },
    }

    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(submitResp, 200, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '60',
      }),
    )

    const client = new RedditClient(CREDS)

    let caught: unknown
    try {
      await client.submitText('tok_abc', 'test', 'Título', 'Texto')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(RateLimitError)
    expect((caught as RateLimitError).retryAfterSeconds).toBe(60)
  })

  // -----------------------------------------------------------------------
  // Caso 5 — Rate limit headers parseados corretamente (sem throw)
  // -----------------------------------------------------------------------
  it('submitText: não lança RateLimitError quando remaining=1 (limite não atingido)', async () => {
    const submitResp: SubmitResponse = {
      json: {
        data: { url: 'https://reddit.com/r/test/comments/ok1', id: 'ok1' },
        errors: [],
      },
    }

    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(submitResp, 200, {
        'x-ratelimit-remaining': '1',
        'x-ratelimit-reset': '120',
      }),
    )

    const client = new RedditClient(CREDS)
    // Deve resolver sem erro
    const result = await client.submitText(
      'tok_abc',
      'test',
      'Título',
      'Texto',
    )
    expect(result.json.data.id).toBe('ok1')
  })

  // -----------------------------------------------------------------------
  // Caso 6 — User-Agent: formato exigido pela Reddit API
  // -----------------------------------------------------------------------
  it('User-Agent: segue o formato <platform>:<app_id>:<version> (by /u/<user>)', () => {
    const client = new RedditClient(CREDS)
    // Acessar via reflexão para validar sem disparar fetch
    const ua = (client as unknown as Record<string, string>)['userAgent']
    // Deve bater exatamente com o formato exigido pela Reddit API
    expect(ua).toBe(`web:fiscal-digital:0.1.0 (by /u/${CREDS.username})`)
    // Garantir que o padrão <platform>:<app_id>:<version> (...) é respeitado
    expect(ua).toMatch(/^web:fiscal-digital:\d+\.\d+\.\d+ \(by \/u\/.+\)$/)
  })

  // -----------------------------------------------------------------------
  // Caso 7 — User-Agent: passado no header de submitText
  // -----------------------------------------------------------------------
  it('User-Agent: é enviado no header de submitText', async () => {
    const submitResp: SubmitResponse = {
      json: {
        data: { url: 'https://reddit.com/r/test/comments/ua1', id: 'ua1' },
        errors: [],
      },
    }

    ;(globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(submitResp, 200, {
        'x-ratelimit-remaining': '50',
        'x-ratelimit-reset': '600',
      }),
    )

    const client = new RedditClient(CREDS)
    await client.submitText('tok_abc', 'test', 'Título', 'Texto')

    const [, opts] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ]
    const headers = opts.headers as Record<string, string>
    expect(headers['User-Agent']).toBe(
      `web:fiscal-digital:0.1.0 (by /u/${CREDS.username})`,
    )
  })
})
