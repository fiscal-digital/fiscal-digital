import { queryDiario } from '../query_diario'

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
})
