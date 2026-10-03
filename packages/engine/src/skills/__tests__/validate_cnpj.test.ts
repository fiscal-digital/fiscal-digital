import { validateCNPJ, _resetValidateCnpjCacheForTests } from '../validate_cnpj'
import { USER_AGENT } from '../../utils/user_agent'

// RateLimiter real espaçaria as chamadas em 1 s (60/min); nos testes é no-op.
jest.mock('../../utils/rate_limiter', () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({
    acquire: jest.fn().mockResolvedValue(undefined),
  })),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => {
  jest.clearAllMocks()
  _resetValidateCnpjCacheForTests()
  // Retentativa com backoff zero: os casos de 429/5xx exercitam o retry sem
  // esperar 3 s de relógio real.
  process.env.BRASILAPI_RETRY_BACKOFF_MS = '0'
  delete process.env.BRASILAPI_MAX_RETRIES
})

afterAll(() => {
  delete process.env.BRASILAPI_RETRY_BACKOFF_MS
})

function makeOkResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response)
}

function makeErrorResponse(status: number, statusText: string, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => ({}),
  } as unknown as Response)
}

const OK_BODY = {
  cnpj: '12345678000190',
  razao_social: 'Empresa Teste LTDA',
  situacao_cadastral: 2,
  data_inicio_atividade: '2010-05-20',
  qsa: [],
}

describe('validateCNPJ', () => {
  it('status 200: mapeia situacaoCadastral 2 para "ativa" e retorna razaoSocial', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '12345678000190',
        razao_social: 'Empresa Teste LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2010-05-20',
        qsa: [{ nome_socio: 'João Silva' }],
      }),
    )

    const result = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    expect(result.data.razaoSocial).toBe('Empresa Teste LTDA')
    expect(result.data.situacaoCadastral).toBe('ativa')
    expect(result.data.dataAbertura).toBe('2010-05-20')
    expect(result.data.socios).toEqual(['João Silva'])
    expect(result.confidence).toBe(1.0)
  })

  it('status 200: mapeia situacaoCadastral 8 para "baixada"', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '98765432000100',
        razao_social: 'Empresa Baixada LTDA',
        situacao_cadastral: 8,
        data_inicio_atividade: '2005-01-01',
        qsa: [],
      }),
    )

    const result = await validateCNPJ.execute({ cnpj: '98.765.432/0001-00' })
    expect(result.data.situacaoCadastral).toBe('baixada')
  })

  it('status 404: retorna nao_encontrado SEM lançar erro', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(404, 'Not Found'))

    const result = await validateCNPJ.execute({ cnpj: '00.000.000/0001-00' })

    expect(result.data.situacaoCadastral).toBe('nao_encontrado')
    expect(result.confidence).toBe(0.9)
    // Não deve ter lançado exceção — chegamos aqui
  })

  it('status 500: lança erro', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(500, 'Internal Server Error'))

    await expect(
      validateCNPJ.execute({ cnpj: '12.345.678/0001-90' }),
    ).rejects.toThrow('BrasilAPI CNPJ 500')
  })

  it('CNPJ com pontuação é limpo antes da chamada (verifica URL no mock)', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '12345678000190',
        razao_social: 'Empresa Limpa LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2015-03-10',
        qsa: [],
      }),
    )

    await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain('12345678000190')
    // Verifica que o CNPJ na URL está sem pontuação (apenas dígitos no path final)
    const cnpjInPath = calledUrl.split('/').pop()
    expect(cnpjInPath).toBe('12345678000190')
  })

  it('envia User-Agent header nas chamadas HTTP (previne 403 Cloudflare WAF — LRN-20260606-002)', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '12345678000190',
        razao_social: 'Empresa UA LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2018-01-01',
        qsa: [],
      }),
    )

    await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    const calledHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
    expect(calledHeaders['User-Agent']).toMatch(/^FiscalDigital\//)
    expect(calledHeaders['User-Agent']).toContain('fiscaldigital.org')
    // Mesmo UA da engine (utils/user_agent), não uma string própria desatualizada
    expect(calledHeaders['User-Agent']).toBe(USER_AGENT)
  })

  it('retorna sanctions false (preenchido por check_sanctions)', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '12345678000190',
        razao_social: 'Empresa OK LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2018-07-01',
        qsa: [],
      }),
    )

    const result = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })
    expect(result.data.sanctions).toBe(false)
  })

  // ── EVO-024: CNPJ alfanumérico (Lei 14.973/2024) ──────────────────────────

  it('CNPJ alfanumérico: letras são PRESERVADAS na URL (não removidas como /\\D/g removeria)', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '1234ABCD000116',
        razao_social: 'Empresa Alfanumérica LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2026-08-01',
        qsa: [],
      }),
    )

    await validateCNPJ.execute({ cnpj: '12.34A.BCD/0001-16' })

    const calledUrl: string = mockFetch.mock.calls[0][0]
    const cnpjInPath = calledUrl.split('/').pop()
    expect(cnpjInPath).toBe('1234ABCD000116')
  })

  it('CNPJ alfanumérico: letra minúscula na entrada é normalizada para uppercase na URL', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '1234abcd000116',
        razao_social: 'Empresa Alfanumérica LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2026-08-01',
        qsa: [],
      }),
    )

    await validateCNPJ.execute({ cnpj: '1234abcd000116' })

    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl.split('/').pop()).toBe('1234ABCD000116')
  })

  it('CNPJ alfanumérico + 404: mesmo comportamento do numérico (nao_encontrado, sem lançar)', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(404, 'Not Found'))

    const result = await validateCNPJ.execute({ cnpj: '1234ABCD000116' })

    expect(result.data.situacaoCadastral).toBe('nao_encontrado')
    expect(result.confidence).toBe(0.9)
  })

  it('CNPJ alfanumérico + erro não mapeado (500): degrada graciosamente em vez de lançar', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(500, 'Internal Server Error'))

    const result = await validateCNPJ.execute({ cnpj: '1234ABCD000116' })

    expect(result.data.situacaoCadastral).toBe('consulta_indisponivel')
    expect(result.data.consultaDegradada).toBe(true)
    expect(result.confidence).toBe(0.2)
  })

  it('CNPJ numérico legado + erro não mapeado (500): continua lançando (sem regressão)', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(500, 'Internal Server Error'))

    await expect(
      validateCNPJ.execute({ cnpj: '12.345.678/0001-90' }),
    ).rejects.toThrow('BrasilAPI CNPJ 500')
  })
})

// ── Fair use BrasilAPI: retentativa única + memo (fiscal-fornecedores nunca
//    produziu achado; um 429 caía no `catch { continue }` silencioso) ────────

describe('validateCNPJ — retentativa', () => {
  it('429 com Retry-After → 200: recupera com exatamente 2 chamadas', async () => {
    mockFetch
      .mockReturnValueOnce(makeErrorResponse(429, 'Too Many Requests', { 'retry-after': '0' }))
      .mockReturnValueOnce(makeOkResponse(OK_BODY))

    const result = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.data.situacaoCadastral).toBe('ativa')
  })

  it('429 → 429: lança após UMA retentativa (2 chamadas, não mais)', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(429, 'Too Many Requests'))

    await expect(validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })).rejects.toThrow('BrasilAPI CNPJ 429')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('falha de rede → 200: recupera', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockReturnValueOnce(makeOkResponse(OK_BODY))

    const result = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.data.razaoSocial).toBe('Empresa Teste LTDA')
  })

  it('400 (não retryable): lança na primeira, sem retentativa', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(400, 'Bad Request'))

    await expect(validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })).rejects.toThrow('BrasilAPI CNPJ 400')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('BRASILAPI_MAX_RETRIES=0 desliga a retentativa', async () => {
    process.env.BRASILAPI_MAX_RETRIES = '0'
    mockFetch.mockReturnValue(makeErrorResponse(503, 'Service Unavailable'))

    await expect(validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })).rejects.toThrow('BrasilAPI CNPJ 503')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('validateCNPJ — memo por CNPJ', () => {
  it('mesmo CNPJ (máscaras diferentes) consultado 2× = 1 chamada HTTP', async () => {
    mockFetch.mockReturnValue(makeOkResponse(OK_BODY))

    const a = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })
    const b = await validateCNPJ.execute({ cnpj: '12345678000190' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(a.data.razaoSocial).toBe(b.data.razaoSocial)
  })

  it('chamadas concorrentes do mesmo CNPJ compartilham a mesma requisição', async () => {
    mockFetch.mockReturnValue(makeOkResponse(OK_BODY))

    await Promise.all([
      validateCNPJ.execute({ cnpj: '12.345.678/0001-90' }),
      validateCNPJ.execute({ cnpj: '12.345.678/0001-90' }),
      validateCNPJ.execute({ cnpj: '12.345.678/0001-90' }),
    ])

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('CNPJs diferentes não compartilham memo', async () => {
    mockFetch.mockReturnValue(makeOkResponse(OK_BODY))

    await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })
    await validateCNPJ.execute({ cnpj: '98.765.432/0001-00' })

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('falha NÃO fica memoizada: 400 depois 200 = 2 chamadas', async () => {
    mockFetch
      .mockReturnValueOnce(makeErrorResponse(400, 'Bad Request'))
      .mockReturnValueOnce(makeOkResponse(OK_BODY))

    await expect(validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })).rejects.toThrow('BrasilAPI CNPJ 400')
    const result = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.data.situacaoCadastral).toBe('ativa')
  })

  it('404 (nao_encontrado) É memoizado — é resposta, não falha', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(404, 'Not Found'))

    await validateCNPJ.execute({ cnpj: '00.000.000/0001-00' })
    await validateCNPJ.execute({ cnpj: '00.000.000/0001-00' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
