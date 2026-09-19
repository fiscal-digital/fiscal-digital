import { queryDiario, retryAfterMs, isRetryableStatus } from '../query_diario'

// Mockar RateLimiter para evitar delays reais nos testes
jest.mock('../../utils/rate_limiter', () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({
    acquire: jest.fn().mockResolvedValue(undefined),
  })),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => {
  jest.clearAllMocks()
  // Retry com backoff zero: os testes de erro abaixo exercitam a retentativa
  // (429/503 sao retryable) sem esperar 3 s de relogio real.
  process.env.QD_RETRY_BACKOFF_MS = '0'
})

afterAll(() => {
  delete process.env.QD_RETRY_BACKOFF_MS
})

function makeQDResponse(gazettes: object[], total = gazettes.length) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ total_gazettes: total, gazettes }),
  } as Response)
}

function makeErrorResponse(status: number, statusText: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  } as Response)
}

describe('queryDiario', () => {
  it('sucesso: retorna gazettes mapeadas corretamente', async () => {
    const qdGazettes = [
      {
        territory_id: '4305108',
        date: '2026-03-15',
        url: 'https://queridodiario.ok.org.br/gazettes/abc123',
        excerpts: ['Dispensa de licitação no valor de R$ 80.000,00'],
        edition: '1',
        is_extra: false,
      },
      {
        territory_id: '4305108',
        date: '2026-03-14',
        url: 'https://queridodiario.ok.org.br/gazettes/abc122',
        excerpts: ['Nomeação para cargo comissionado'],
        edition: '1',
        is_extra: false,
      },
    ]
    mockFetch.mockReturnValue(makeQDResponse(qdGazettes, 2))

    const result = await queryDiario.execute({
      territory_id: '4305108',
      keywords: ['dispensa'],
      since: '2026-03-01',
    })

    expect(result.data.gazettes).toHaveLength(2)
    expect(result.data.total).toBe(2)
    expect(result.data.gazettes[0].territory_id).toBe('4305108')
    expect(result.data.gazettes[0].url).toBe('https://queridodiario.ok.org.br/gazettes/abc123')
    expect(result.data.gazettes[0].excerpts).toHaveLength(1)
    expect(result.confidence).toBe(1.0)
  })

  it('sucesso: ID de gazette segue formato territory_id#date#edition', async () => {
    mockFetch.mockReturnValue(
      makeQDResponse([
        {
          territory_id: '4305108',
          date: '2026-03-15',
          url: 'https://queridodiario.ok.org.br/gazettes/xyz',
          excerpts: [],
          edition: '2',
          is_extra: true,
        },
      ]),
    )

    const result = await queryDiario.execute({ territory_id: '4305108' })

    expect(result.data.gazettes[0].id).toBe('4305108#2026-03-15#2')
  })

  it('gazette sem edition usa "1" como fallback no ID', async () => {
    mockFetch.mockReturnValue(
      makeQDResponse([
        {
          territory_id: '4305108',
          date: '2026-03-15',
          url: 'https://queridodiario.ok.org.br/gazettes/noedition',
          excerpts: [],
        },
      ]),
    )

    const result = await queryDiario.execute({ territory_id: '4305108' })
    expect(result.data.gazettes[0].id).toBe('4305108#2026-03-15#1')
  })

  it('status 429 (rate limit): lança erro com status na mensagem', async () => {
    // Comportamento atual: qualquer status não-OK lança erro
    // Não há retry implementado na skill — o limiter é pré-chamada, não post-error
    mockFetch.mockReturnValue(makeErrorResponse(429, 'Too Many Requests'))

    await expect(
      queryDiario.execute({ territory_id: '4305108' }),
    ).rejects.toThrow('Querido Diário API 429')
  })

  it('status 503 (não-OK): lança erro', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(503, 'Service Unavailable'))

    await expect(
      queryDiario.execute({ territory_id: '4305108' }),
    ).rejects.toThrow('Querido Diário API 503')
  })

  it('keywords são incluídas como querystring na URL', async () => {
    mockFetch.mockReturnValue(makeQDResponse([]))

    await queryDiario.execute({
      territory_id: '4305108',
      keywords: ['dispensa', 'licitação'],
    })

    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain('querystring=')
    expect(calledUrl).toContain('dispensa')
  })

  it('envia User-Agent header nas chamadas HTTP (previne 403 Cloudflare WAF — LRN-20260606-002)', async () => {
    mockFetch.mockReturnValue(makeQDResponse([]))

    await queryDiario.execute({ territory_id: '4305108' })

    const calledHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
    expect(calledHeaders['User-Agent']).toMatch(/^FiscalDigital\//)
    expect(calledHeaders['User-Agent']).toContain('fiscaldigital.org')
  })
})

// ─── #166 — janela de excerpt configurável ──────────────────────────────────
//
// `excerpt_size: '300'` era hardcoded e é a raiz de dois gargalos medidos em
// prod (2026-07-31): zero dos 595 findings sem CNPJ tinha padrão de CNPJ no
// excerpt; só 11 de 791 textos traziam rótulo de assinatura. O dado ficava
// fora da janela.
//
// O default segue 300 de propósito: canary mostrou que subir muda o
// comportamento dos Fiscais nos dois sentidos (contagem de atos e filtros de
// exclusão operam dentro do excerpt). Subir exige recalibração — ver #166.
describe('#166 — excerpt_size configurável', () => {
  function urlDaChamada(): URL {
    return new URL(mockFetch.mock.calls[0][0] as string)
  }

  it('default permanece 300 — subir exige recalibração dos thresholds', async () => {
    delete process.env.QD_EXCERPT_SIZE
    mockFetch.mockReturnValueOnce(makeQDResponse([]))
    await queryDiario.execute({ territory_id: '4305108' })
    expect(urlDaChamada().searchParams.get('excerpt_size')).toBe('300')
    expect(urlDaChamada().searchParams.get('number_of_excerpts')).toBe('5')
  })

  it('env QD_EXCERPT_SIZE sobrepõe o default (canary por deploy)', async () => {
    process.env.QD_EXCERPT_SIZE = '2000'
    mockFetch.mockReturnValueOnce(makeQDResponse([]))
    await queryDiario.execute({ territory_id: '4305108' })
    expect(urlDaChamada().searchParams.get('excerpt_size')).toBe('2000')
    delete process.env.QD_EXCERPT_SIZE
  })

  it('parâmetro da chamada tem precedência sobre o env', async () => {
    process.env.QD_EXCERPT_SIZE = '2000'
    mockFetch.mockReturnValueOnce(makeQDResponse([]))
    await queryDiario.execute({ territory_id: '4305108', excerptSize: 4000 })
    expect(urlDaChamada().searchParams.get('excerpt_size')).toBe('4000')
    delete process.env.QD_EXCERPT_SIZE
  })

  it('numberOfExcerpts também é configurável', async () => {
    mockFetch.mockReturnValueOnce(makeQDResponse([]))
    await queryDiario.execute({ territory_id: '4305108', numberOfExcerpts: 10 })
    expect(urlDaChamada().searchParams.get('number_of_excerpts')).toBe('10')
  })
})

// Regressão da migração de host do QD (2026-08): o host antigo
// `api.queridodiario.ok.org.br` morreu e a coleta parou em silêncio por 3
// semanas. Garante o host novo como default e o override por ambiente.
describe('queryDiario — host da API', () => {
  const ORIGINAL = process.env.QD_API_URL
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QD_API_URL
    else process.env.QD_API_URL = ORIGINAL
  })

  it('usa api.queridodiario.org.br por default (nunca o host antigo .ok.org.br)', async () => {
    delete process.env.QD_API_URL
    mockFetch.mockReturnValue(makeQDResponse([]))
    const result = await queryDiario.execute({ territory_id: '4305108' })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url.startsWith('https://api.queridodiario.org.br/gazettes?')).toBe(true)
    expect(url).not.toContain('ok.org.br')
    expect(result.source).toBe(url)
  })

  it('QD_API_URL sobrescreve o host (barra final tolerada)', async () => {
    process.env.QD_API_URL = 'https://qd.exemplo.test/'
    mockFetch.mockReturnValue(makeQDResponse([]))
    await queryDiario.execute({ territory_id: '4305108' })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url.startsWith('https://qd.exemplo.test/gazettes?')).toBe(true)
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Uma retentativa em falha transitoria — respeitando a fonte
// ─────────────────────────────────────────────────────────────────────────────

describe('queryDiario — retentativa unica', () => {
  it('503 seguido de 200: recupera com exatamente 2 chamadas', async () => {
    mockFetch
      .mockReturnValueOnce(makeErrorResponse(503, 'Service Unavailable'))
      .mockReturnValueOnce(makeQDResponse([]))

    const result = await queryDiario.execute({ territory_id: '4305108' })

    expect(result.data.gazettes).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('503 duas vezes: lanca depois da UNICA retentativa, nunca uma terceira', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(503, 'Service Unavailable'))

    await expect(queryDiario.execute({ territory_id: '4305108' })).rejects.toThrow('Querido Diário API 503')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('404 nao e transitorio: lanca na primeira, sem retentativa', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(404, 'Not Found'))

    await expect(queryDiario.execute({ territory_id: '4305108' })).rejects.toThrow('Querido Diário API 404')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('falha de rede seguida de 200: recupera', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockReturnValueOnce(makeQDResponse([]))

    await expect(queryDiario.execute({ territory_id: '4305108' })).resolves.toBeDefined()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('QD_MAX_RETRIES=0 desliga a retentativa', async () => {
    process.env.QD_MAX_RETRIES = '0'
    try {
      mockFetch.mockReturnValue(makeErrorResponse(503, 'Service Unavailable'))
      await expect(queryDiario.execute({ territory_id: '4305108' })).rejects.toThrow('503')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    } finally {
      delete process.env.QD_MAX_RETRIES
    }
  })
})

describe('retryAfterMs', () => {
  it('sem header usa o fallback', () => {
    expect(retryAfterMs(null, 3000)).toBe(3000)
    expect(retryAfterMs(undefined, 3000)).toBe(3000)
    expect(retryAfterMs('', 3000)).toBe(3000)
  })

  it('segundos viram ms, com teto de 30 s', () => {
    expect(retryAfterMs('5', 3000)).toBe(5000)
    expect(retryAfterMs('0', 3000)).toBe(0)
    expect(retryAfterMs('120', 3000)).toBe(30_000)
  })

  it('HTTP-date vira espera relativa, nunca negativa, com teto', () => {
    const now = Date.parse('2026-09-16T12:00:00Z')
    expect(retryAfterMs('Wed, 16 Sep 2026 12:00:10 GMT', 3000, now)).toBe(10_000)
    expect(retryAfterMs('Wed, 16 Sep 2026 11:59:00 GMT', 3000, now)).toBe(0)
    expect(retryAfterMs('Wed, 16 Sep 2026 13:00:00 GMT', 3000, now)).toBe(30_000)
  })

  it('valor invalido cai no fallback', () => {
    expect(retryAfterMs('daqui a pouco', 3000)).toBe(3000)
  })
})

describe('isRetryableStatus', () => {
  it('cobre indisponibilidade transitoria e rate limit, nao erro de cliente', () => {
    for (const s of [429, 502, 503, 504, 520, 522, 524]) expect(isRetryableStatus(s)).toBe(true)
    for (const s of [400, 401, 403, 404, 422, 500]) expect(isRetryableStatus(s)).toBe(false)
  })
})
