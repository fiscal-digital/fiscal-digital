/**
 * Tests for the public API Lambda handler.
 *
 * Mocks DynamoDB Document Client following the project pattern (see
 * packages/analyzer/src/__tests__/handler.test.ts) — jest.mock para
 * @aws-sdk/lib-dynamodb e @aws-sdk/client-dynamodb. Sem aws-sdk-client-mock
 * para evitar nova dep no monorepo.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { Finding } from '@fiscal-digital/engine'

// ---------------------------------------------------------------------------
// Mocks — declared before handler import
// ---------------------------------------------------------------------------

const mockDdbSend = jest.fn()

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: (...args: unknown[]) => mockDdbSend(...args) }),
  },
  ScanCommand: jest.fn().mockImplementation((input: unknown) => ({ __type: 'Scan', input })),
  GetCommand: jest.fn().mockImplementation((input: unknown) => ({ __type: 'Get', input })),
  PutCommand: jest.fn().mockImplementation((input: unknown) => ({ __type: 'Put', input })),
  QueryCommand: jest.fn().mockImplementation((input: unknown) => ({ __type: 'Query', input })),
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks are set up
// ---------------------------------------------------------------------------

import { handler } from '../index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'FINDING#fiscal-licitacoes#4305108#dispensa_irregular#2026-04-15T00:00:00.000Z',
    fiscalId: 'fiscal-licitacoes',
    cityId: '4305108',
    type: 'dispensa_irregular',
    riskScore: 75,
    confidence: 0.85,
    evidence: [
      {
        source: 'https://queridodiario.ok.org.br/gazettes/g-001',
        excerpt: 'dispensa de licitação no valor de R$ 80.000,00',
        date: '2026-04-15',
      },
      {
        source: 'https://queridodiario.ok.org.br/gazettes/g-002',
        excerpt: 'segundo trecho relacionado',
        date: '2026-04-16',
      },
    ],
    narrative: 'Identificamos dispensa publicada em 15/04/2026 em Caxias do Sul.',
    legalBasis: 'Lei 14.133/2021, Art. 75, II',
    cnpj: '12.345.678/0001-90',
    contractNumber: 'CT-001/2026',
    secretaria: 'SMS',
    value: 80000,
    published: true,
    publishedAt: '2026-04-15T12:00:00.000Z',
    createdAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

function makeEvent(rawPath: string, queryStringParameters: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath,
    rawQueryString: new URLSearchParams(queryStringParameters).toString(),
    headers: {},
    queryStringParameters,
    requestContext: {
      accountId: '000000000000',
      apiId: 'test',
      domainName: 'api.test',
      domainPrefix: 'api',
      http: { method: 'GET', path: rawPath, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'jest' },
      requestId: 'req-1',
      routeKey: '$default',
      stage: '$default',
      time: '01/May/2026:00:00:00 +0000',
      timeEpoch: 1735689600,
    },
    isBase64Encoded: false,
  }
}

function asResult(r: APIGatewayProxyResultV2): { statusCode: number; body: string; headers: Record<string, string> } {
  if (typeof r === 'string') return { statusCode: 200, body: r, headers: {} }
  return {
    statusCode: r.statusCode ?? 200,
    body: r.body ?? '',
    headers: (r.headers ?? {}) as Record<string, string>,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /health', () => {
  it('retorna status ok com versão, contagem de cidades ativas e lastDeployedAt', async () => {
    const res = asResult(await handler(makeEvent('/health')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('ok')
    expect(body.version).toBe('1.0.0')
    expect(typeof body.cities).toBe('number')
    expect(body.cities).toBeGreaterThan(0)
    expect(typeof body.lastDeployedAt).toBe('string')
    // ISO 8601
    expect(body.lastDeployedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('GET /alerts', () => {
  it('expande resposta com evidence, cnpj, contractNumber, fiscalId, published, publishedAt', async () => {
    const finding = makeFinding()
    mockDdbSend.mockResolvedValueOnce({ Items: [finding] })

    const res = asResult(await handler(makeEvent('/alerts')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(body.total).toBe(1)
    const item = body.items[0]
    expect(item.id).toBe(finding.id)
    expect(item.fiscalId).toBe('fiscal-licitacoes')
    expect(item.cnpj).toBe('12.345.678/0001-90')
    expect(item.contractNumber).toBe('CT-001/2026')
    expect(item.published).toBe(true)
    expect(item.publishedAt).toBe('2026-04-15T12:00:00.000Z')
    expect(Array.isArray(item.evidence)).toBe(true)
    expect(item.evidence).toHaveLength(2)
    // backwards compat — `source` continua presente como alias
    expect(item.source).toBe('https://queridodiario.ok.org.br/gazettes/g-001')
    // city e state expandidos a partir de cityId
    expect(item.city).toBe('Caxias do Sul')
    expect(item.state).toBe('RS')
  })

  it('mantém backwards compat retornando array vazio quando não há findings', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] })
    const res = asResult(await handler(makeEvent('/alerts')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })

  // Regression test (TEC-WEB-009): quando state e cityId são passados,
  // cityId é mais específico e deve filtrar por uma única cidade. Antes
  // do fix, state ganhava e retornava todas cidades do estado.
  it('cityId tem precedência sobre state quando ambos passados (filtro mais específico)', async () => {
    // Mock retorna 1 finding por Query — Caxias é o único cityId que deve ser consultado.
    mockDdbSend.mockImplementation((cmd: { __type: string; input: { ExpressionAttributeValues?: { ':cid'?: string } } }) => {
      if (cmd.__type === 'Query') {
        const cid = cmd.input.ExpressionAttributeValues?.[':cid']
        // Só Caxias do Sul deve ser consultada — Porto Alegre nunca deve aparecer.
        expect(cid).toBe('4305108')
        return Promise.resolve({ Items: [makeFinding({ cityId: '4305108' })] })
      }
      return Promise.resolve({ Items: [] })
    })

    const res = asResult(await handler(makeEvent('/alerts', { state: 'RS', city: '4305108' })))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.total).toBe(1)
    expect(body.items[0].cityId).toBe('4305108')
    expect(body.pageInfo.citiesCount).toBe(1)
  })

  // Regression test (TEC-WEB-009): cityId que não pertence ao state filtrado
  // retorna vazio (filtros contraditórios).
  it('cityId fora do state filtrado retorna vazio (filtros contraditórios)', async () => {
    mockDdbSend.mockImplementation(() => {
      throw new Error('Não deveria chamar DDB com filtros contraditórios')
    })

    // 4305108 é Caxias do Sul (RS). Pedindo state=SP → contradição.
    const res = asResult(await handler(makeEvent('/alerts', { state: 'SP', city: '4305108' })))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })
})

describe('GET /stats', () => {
  it('agrega counts por fiscal, por cidade (top 10) e por tipo', async () => {
    const findings = [
      makeFinding({ fiscalId: 'fiscal-licitacoes', cityId: '4305108', type: 'dispensa_irregular' }),
      makeFinding({ fiscalId: 'fiscal-licitacoes', cityId: '4305108', type: 'fracionamento' }),
      makeFinding({ fiscalId: 'fiscal-contratos',  cityId: '3550308', type: 'aditivo_abusivo' }),
    ]
    // 1ª chamada: scanAllFindings (Scan alerts)
    // 2ª chamada: countGazettes (GetItem em AGG#GAZETTE_COUNT — WIN-API-003)
    mockDdbSend
      .mockResolvedValueOnce({ Items: findings })
      .mockResolvedValueOnce({ Item: { total: 8400 } })

    const res = asResult(await handler(makeEvent('/stats')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(body.totalFindings).toBe(3)
    expect(body.totalGazettesProcessed).toBe(8400)
    expect(body.findingsByFiscal['fiscal-licitacoes']).toBe(2)
    expect(body.findingsByFiscal['fiscal-contratos']).toBe(1)
    expect(body.findingsByType.dispensa_irregular).toBe(1)
    expect(body.findingsByType.fracionamento).toBe(1)
    expect(body.findingsByType.aditivo_abusivo).toBe(1)

    // Top cities ordenadas por count
    expect(body.findingsByCity).toHaveLength(2)
    expect(body.findingsByCity[0]).toEqual({ cityId: '4305108', name: 'Caxias do Sul', count: 2 })
    expect(body.findingsByCity[1]).toEqual({ cityId: '3550308', name: 'São Paulo', count: 1 })

    // Custo BRL: 8400 * 0.0002538 + 3 * 0.004158 = 2.13192 + 0.012474 = 2.144394 → 2.14
    // Constantes em packages/api/src/index.ts (já em BRL, USD * 5.4 BCB).
    expect(body.estimatedCostBrl).toBeCloseTo(2.14, 2)

    // lastFindingAt populado
    expect(body.lastFindingAt).toBe('2026-04-15T00:00:00.000Z')
    expect(typeof body.uptimeDays).toBe('number')

    // Cache 60s
    expect(res.headers['Cache-Control']).toContain('max-age=60')
  })

  it('retorna stats zerados quando não há findings nem gazettes (estado vazio)', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Item: { total: 0 } })

    const res = asResult(await handler(makeEvent('/stats')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(body.totalFindings).toBe(0)
    expect(body.totalGazettesProcessed).toBe(0)
    expect(body.findingsByFiscal).toEqual({})
    expect(body.findingsByCity).toEqual([])
    expect(body.findingsByType).toEqual({})
    expect(body.estimatedCostBrl).toBe(0)
    expect(body.lastFindingAt).toBeNull()
    expect(body.uptimeDays).toBe(0)
  })

  it('degrada graciosamente quando scan em gazettes-prod falha (sem permissão)', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [makeFinding()] })
      .mockRejectedValueOnce(new Error('AccessDeniedException'))

    const res = asResult(await handler(makeEvent('/stats')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.totalFindings).toBe(1)
    expect(body.totalGazettesProcessed).toBeNull()
    // Custo BRL: gazettesCount tratado como 0 + 1 * 0.004158 = 0.004158 → 0.00.
    // Arredondado a 2 casas em buildStats (toFixed(2)).
    expect(body.estimatedCostBrl).toBeCloseTo(0.00, 2)
  })
})

describe('GET /cities', () => {
  it('retorna todas as cidades do CITIES com counts e lastFindingAt agregados', async () => {
    const findings = [
      makeFinding({ cityId: '4305108', createdAt: '2026-04-10T00:00:00.000Z' }),
      makeFinding({ cityId: '4305108', createdAt: '2026-04-15T00:00:00.000Z' }),
      makeFinding({ cityId: '3550308', createdAt: '2026-04-12T00:00:00.000Z' }),
    ]
    // WIN-API-002: handler agora chama N Queries (uma por cidade) em GSI1-city-date
    // em vez de 1 Scan global. Mock filtra findings pelo cityId da Query e
    // valida shape para falhar se o handler mudar de index ou tipo de comando.
    type DdbCmd = {
      __type?: string
      input?: {
        TableName?: string
        IndexName?: string
        ExpressionAttributeValues?: Record<string, unknown>
      }
    }
    mockDdbSend.mockImplementation((cmd: DdbCmd) => {
      if (cmd?.__type !== 'Query') {
        throw new Error(`/cities deve usar Query, recebeu ${cmd?.__type}`)
      }
      if (cmd.input?.IndexName !== 'GSI1-city-date') {
        throw new Error(`/cities deve usar GSI1-city-date, recebeu ${cmd.input?.IndexName}`)
      }
      const cityId = cmd.input.ExpressionAttributeValues?.[':cid']
      return Promise.resolve({
        Items: findings.filter(f => f.cityId === cityId),
      })
    })

    const res = asResult(await handler(makeEvent('/cities')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(50)

    const caxias = body.find((c: { cityId: string }) => c.cityId === '4305108')
    expect(caxias).toMatchObject({
      cityId: '4305108',
      name: 'Caxias do Sul',
      slug: 'caxias-do-sul',
      uf: 'RS',
      active: true,
      findingsCount: 2,
      lastFindingAt: '2026-04-15T00:00:00.000Z',
    })

    const sp = body.find((c: { cityId: string }) => c.cityId === '3550308')
    expect(sp.findingsCount).toBe(1)

    // Cidades sem findings têm count 0 e lastFindingAt null
    const semFindings = body.find((c: { findingsCount: number }) => c.findingsCount === 0)
    expect(semFindings.lastFindingAt).toBeNull()

    // Cache 300s
    expect(res.headers['Cache-Control']).toContain('max-age=300')
  })
})

describe('GET /cities/{cityId}/stats', () => {
  it('retorna stats agregadas para cidade conhecida — gazettes + findings + período', async () => {
    // 1ª chamada: scan gazettes filtrado por GAZETTE#4305108#
    // 2ª chamada: fetchFindings (scan alerts filtrado pela cidade)
    mockDdbSend
      .mockResolvedValueOnce({
        Items: [
          { pk: 'GAZETTE#4305108#2026-01-15#1', date: '2026-01-15' },
          { pk: 'GAZETTE#4305108#2026-03-20#1', date: '2026-03-20' },
          { pk: 'GAZETTE#4305108#2026-04-10#1', date: '2026-04-10' },
        ],
      })
      .mockResolvedValueOnce({
        Items: [
          makeFinding({ cityId: '4305108', createdAt: '2026-04-10T12:00:00.000Z' }),
          makeFinding({ cityId: '4305108', createdAt: '2026-04-09T08:00:00.000Z' }),
        ],
      })

    const res = asResult(await handler(makeEvent('/cities/4305108/stats')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(body.cityId).toBe('4305108')
    expect(body.totalGazettesProcessed).toBe(3)
    expect(body.totalFindings).toBe(2)
    expect(body.lastFindingAt).toBe('2026-04-10T12:00:00.000Z')
    expect(body.periodCovered).toEqual({ from: '2026-01-15', to: '2026-04-10' })

    // Cache 300s
    expect(res.headers['Cache-Control']).toContain('max-age=300')
  })

  it('retorna 404 para cityId desconhecido (não está em CITIES)', async () => {
    const res = asResult(await handler(makeEvent('/cities/9999999/stats')))
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('city_not_found')
    // Não chama o DynamoDB se cidade desconhecida
    expect(mockDdbSend).not.toHaveBeenCalled()
  })

  it('extrai date do pk como fallback quando atributo date está ausente', async () => {
    mockDdbSend
      .mockResolvedValueOnce({
        Items: [
          { pk: 'GAZETTE#4305108#2025-06-10#1' },
          { pk: 'GAZETTE#4305108#2026-02-28#3' },
        ],
      })
      .mockResolvedValueOnce({ Items: [] })

    const res = asResult(await handler(makeEvent('/cities/4305108/stats')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.totalGazettesProcessed).toBe(2)
    expect(body.periodCovered).toEqual({ from: '2025-06-10', to: '2026-02-28' })
    expect(body.totalFindings).toBe(0)
    expect(body.lastFindingAt).toBeNull()
  })

  it('periodCovered é null quando não há gazettes processadas para a cidade', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })

    const res = asResult(await handler(makeEvent('/cities/4305108/stats')))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.totalGazettesProcessed).toBe(0)
    expect(body.periodCovered).toBeNull()
  })
})

describe('GET /health endpoints array', () => {
  it('expõe novo endpoint /cities/{cityId}/stats no array', async () => {
    const res = asResult(await handler(makeEvent('/health')))
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.endpoints)).toBe(true)
    expect(body.endpoints).toContain('GET /cities/{cityId}/stats')
  })
})

describe('404', () => {
  it('retorna 404 para path desconhecido', async () => {
    const res = asResult(await handler(makeEvent('/unknown')))
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('Not found')
  })
})

describe('error handling', () => {
  it('retorna 500 quando o scan no DynamoDB falha em /alerts', async () => {
    mockDdbSend.mockRejectedValueOnce(new Error('boom'))
    const res = asResult(await handler(makeEvent('/alerts')))
    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('Internal server error')
  })
})
