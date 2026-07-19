/**
 * Tests for GET /suppliers/{cnpj} — MIT-02/EVO-002 PR 6.
 *
 * Mocks o DynamoDB Document Client seguindo o mesmo padrão de api.test.ts
 * (jest.mock para @aws-sdk/lib-dynamodb + @aws-sdk/client-dynamodb).
 *
 * Cobertura:
 *  - 400 com cnpj inválido (não-14 dígitos)
 *  - 200 + nulls/vazios quando pré-backfill (DDB retorna vazio)
 *  - 200 com profile + contracts + findings + publish gate (filtra <60 / <0.70)
 *  - 200 com city/state enriquecidos via CITIES (e nulls quando cityId desconhecido)
 *  - Headers X-Citation + Cache-Control presentes
 *  - 405 para método != GET
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
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { handler } from '../index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  rawPath: string,
  method: 'GET' | 'POST' = 'GET',
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '000000000000',
      apiId: 'test',
      domainName: 'api.test',
      domainPrefix: 'api',
      http: { method, path: rawPath, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'jest' },
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
    ],
    narrative: 'Identificamos dispensa publicada em 15/04/2026 em Caxias do Sul.',
    legalBasis: 'Lei 14.133/2021, Art. 75, II',
    cnpj: '12345678000199',
    contractNumber: 'CT-001/2026',
    secretaria: 'SMS',
    value: 80000,
    published: true,
    publishedAt: '2026-04-15T12:00:00.000Z',
    createdAt: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

interface MockCmd {
  __type?: string
  input?: {
    TableName?: string
    IndexName?: string
    Key?: { pk?: string; sk?: string }
    KeyConditionExpression?: string
    ExpressionAttributeValues?: Record<string, unknown>
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /suppliers/{cnpj} — validação de input', () => {
  it('retorna 400 com body explicativo quando cnpj contém apenas letras ("abc")', async () => {
    const res = asResult(await handler(makeEvent('/suppliers/abc')))
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('cnpj inválido')
    expect(body.received).toBe('abc')
    // DDB não deve ser chamado em input inválido
    expect(mockDdbSend).not.toHaveBeenCalled()
  })

  it('retorna 400 quando cnpj tem menos de 14 dígitos ("123")', async () => {
    const res = asResult(await handler(makeEvent('/suppliers/123')))
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('cnpj inválido')
    expect(body.received).toBe('123')
    expect(mockDdbSend).not.toHaveBeenCalled()
  })

  it('EVO-024: aceita CNPJ alfanumérico (Lei 14.973/2024) — não retorna 400, consulta DDB com pk em UPPERCASE', async () => {
    mockDdbSend.mockImplementation((cmd: MockCmd) => {
      if (cmd.__type === 'Get') return Promise.resolve({})
      if (cmd.__type === 'Query') return Promise.resolve({ Items: [] })
      return Promise.resolve({})
    })

    const cnpjPath = encodeURIComponent('12.34a.bcd/0001-16')
    const res = asResult(await handler(makeEvent(`/suppliers/${cnpjPath}`)))

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.cnpjRaw).toBe('1234ABCD000116')

    const getCall = mockDdbSend.mock.calls.find(([cmd]: [MockCmd]) => cmd.__type === 'Get')
    expect(getCall?.[0].input.Key.pk).toBe('SUPPLIER#1234ABCD000116')
  })

  it('retorna 405 quando método não é GET', async () => {
    const event = makeEvent('/suppliers/12345678000199', 'POST')
    const res = asResult(await handler(event))
    expect(res.statusCode).toBe(405)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('method_not_allowed')
    expect(mockDdbSend).not.toHaveBeenCalled()
  })
})

describe('GET /suppliers/{cnpj} — comportamento pré-backfill', () => {
  it('retorna 200 com profile=null, contracts=[], findings=[] quando DDB está vazio', async () => {
    // CNPJ válido em formato com máscara (URL-encoded pelo API Gateway)
    const cnpjPath = encodeURIComponent('12.345.678/0001-99')

    // Mock: profile vazio, contracts vazios, findings vazios
    mockDdbSend.mockImplementation((cmd: MockCmd) => {
      if (cmd.__type === 'Get') {
        return Promise.resolve({}) // sem Item — profile não existe
      }
      if (cmd.__type === 'Query') {
        return Promise.resolve({ Items: [] })
      }
      return Promise.resolve({})
    })

    const res = asResult(await handler(makeEvent(`/suppliers/${cnpjPath}`)))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.cnpj).toBe('12.345.678/0001-99')
    expect(body.cnpjRaw).toBe('12345678000199')
    expect(body.profile).toBeNull()
    expect(body.contracts).toEqual([])
    expect(body.findings).toEqual([])
    expect(body.stats).toEqual({
      totalContracts: 0,
      totalValueBrl: 0,
      cities: [],
    })
  })
})

describe('GET /suppliers/{cnpj} — resposta com dados', () => {
  it('aceita cnpj 14 dígitos cru, monta profile + contracts + findings + aplica publish gate', async () => {
    const cnpj14 = '12345678000199'

    const profileItem = {
      pk: `SUPPLIER#${cnpj14}`,
      sk: 'PROFILE',
      razaoSocial: 'EMPRESA EXEMPLO LTDA',
      situacaoCadastral: 'ATIVA',
      dataAbertura: '2018-03-12',
      socios: [{ nome: 'Fulano de Tal', qual: 'Sócio-Administrador' }],
      sancoes: [],
      rfbCapturedAt: '2026-05-10T03:00:00.000Z',
      cguCapturedAt: '2026-05-10T03:00:00.000Z',
      cguEnabled: true,
      lastLookupAt: '2026-05-10T03:00:00.000Z',
      rfbStatus: 'ok',
    }

    const contracts = [
      {
        pk: `SUPPLIER#${cnpj14}`,
        sk: '2026-04-15#CT-001',
        cnpj: cnpj14,
        cityId: '4305108',
        contractedAtIso: '2026-04-15',
        contractId: 'CT-001',
        contractNumber: 'CT-001/2026',
        valueAmount: 80000,
        secretaria: 'SMS',
        sourceFindingId: 'FINDING#fiscal-licitacoes#4305108#dispensa_irregular#2026-04-15T00:00:00.000Z',
        capturedAt: '2026-04-15T12:00:00.000Z',
      },
      {
        pk: `SUPPLIER#${cnpj14}`,
        sk: '2025-09-30#CT-042',
        cnpj: cnpj14,
        cityId: '4314902',
        contractedAtIso: '2025-09-30',
        contractId: 'CT-042',
        contractNumber: 'CT-042/2025',
        valueAmount: 50000,
        secretaria: 'SMC',
        sourceFindingId: 'FINDING#fiscal-licitacoes#4314902#dispensa_irregular#2025-09-30T00:00:00.000Z',
        capturedAt: '2025-09-30T12:00:00.000Z',
      },
      {
        pk: `SUPPLIER#${cnpj14}`,
        sk: '2025-06-01#CT-009',
        cnpj: cnpj14,
        cityId: '3550308',
        contractedAtIso: '2025-06-01',
        contractId: 'CT-009',
        contractNumber: 'CT-009/2025',
        valueAmount: 30000,
        secretaria: 'SEDU',
        sourceFindingId: 'FINDING#fiscal-licitacoes#3550308#dispensa_irregular#2025-06-01T00:00:00.000Z',
        capturedAt: '2025-06-01T12:00:00.000Z',
      },
    ]

    // 5 findings: 2 publicáveis (riskScore>=60 e confidence>=0.70), 3 abaixo do gate
    const findings = [
      makeFinding({ id: 'F1', riskScore: 80, confidence: 0.85, cityId: '4305108' }),
      makeFinding({ id: 'F2', riskScore: 70, confidence: 0.75, cityId: '4314902' }),
      makeFinding({ id: 'F3', riskScore: 50, confidence: 0.85, cityId: '4305108' }), // gate: risk < 60
      makeFinding({ id: 'F4', riskScore: 80, confidence: 0.60, cityId: '4305108' }), // gate: confidence < 0.70
      makeFinding({ id: 'F5', riskScore: 59, confidence: 0.69, cityId: '4305108' }), // gate: ambos abaixo
    ]

    mockDdbSend.mockImplementation((cmd: MockCmd) => {
      if (cmd.__type === 'Get' && cmd.input?.Key?.sk === 'PROFILE') {
        return Promise.resolve({ Item: profileItem })
      }
      if (cmd.__type === 'Query' && cmd.input?.TableName === 'fiscal-digital-suppliers-prod') {
        return Promise.resolve({ Items: contracts })
      }
      if (cmd.__type === 'Query' && cmd.input?.IndexName === 'GSI2-cnpj-date') {
        // Garante que a Query é feita por cnpj 14 dígitos crus (não a versão mascarada)
        expect(cmd.input?.ExpressionAttributeValues?.[':c']).toBe(cnpj14)
        return Promise.resolve({ Items: findings })
      }
      return Promise.resolve({})
    })

    const res = asResult(await handler(makeEvent(`/suppliers/${cnpj14}`)))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // Profile preservado e sanitizado (sem pk/sk)
    expect(body.profile).toMatchObject({
      razaoSocial: 'EMPRESA EXEMPLO LTDA',
      situacaoCadastral: 'ATIVA',
      dataAbertura: '2018-03-12',
      cguEnabled: true,
      rfbStatus: 'ok',
    })
    expect(body.profile.pk).toBeUndefined()
    expect(body.profile.sk).toBeUndefined()

    // 3 contracts (todos passam — sem gate em contracts)
    expect(body.contracts).toHaveLength(3)

    // Publish gate: só 2 findings sobrevivem (F1, F2)
    expect(body.findings).toHaveLength(2)
    const ids = body.findings.map((f: { id: string }) => f.id)
    expect(ids).toEqual(['F1', 'F2'])

    // Stats agregadas
    expect(body.stats.totalContracts).toBe(3)
    expect(body.stats.totalValueBrl).toBe(160000)
    expect(body.stats.cities.sort()).toEqual(['Caxias do Sul/RS', 'Porto Alegre/RS', 'São Paulo/SP'])

    // Display formatado
    expect(body.cnpj).toBe('12.345.678/0001-99')
    expect(body.cnpjRaw).toBe('12345678000199')
  })

  it('enriquece city/state quando cityId é conhecido', async () => {
    const cnpj14 = '12345678000199'
    mockDdbSend.mockImplementation((cmd: MockCmd) => {
      if (cmd.__type === 'Get') return Promise.resolve({})
      if (cmd.__type === 'Query' && cmd.input?.TableName === 'fiscal-digital-suppliers-prod') {
        return Promise.resolve({
          Items: [
            {
              pk: `SUPPLIER#${cnpj14}`,
              sk: '2026-04-15#CT-001',
              cityId: '4305108', // Caxias do Sul/RS
              contractedAtIso: '2026-04-15',
              contractNumber: 'CT-001/2026',
              valueAmount: 80000,
              secretaria: 'SMS',
            },
          ],
        })
      }
      return Promise.resolve({ Items: [] })
    })

    const res = asResult(await handler(makeEvent(`/suppliers/${cnpj14}`)))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.contracts[0].city).toBe('Caxias do Sul')
    expect(body.contracts[0].state).toBe('RS')
    expect(body.stats.cities).toEqual(['Caxias do Sul/RS'])
  })

  it('retorna city/state como null quando cityId é desconhecido (não quebra)', async () => {
    const cnpj14 = '12345678000199'
    mockDdbSend.mockImplementation((cmd: MockCmd) => {
      if (cmd.__type === 'Get') return Promise.resolve({})
      if (cmd.__type === 'Query' && cmd.input?.TableName === 'fiscal-digital-suppliers-prod') {
        return Promise.resolve({
          Items: [
            {
              pk: `SUPPLIER#${cnpj14}`,
              sk: '2026-04-15#CT-001',
              cityId: '9999999', // não existe em CITIES
              contractedAtIso: '2026-04-15',
              contractNumber: 'CT-001/2026',
              valueAmount: 50000,
              secretaria: 'SMS',
            },
          ],
        })
      }
      return Promise.resolve({ Items: [] })
    })

    const res = asResult(await handler(makeEvent(`/suppliers/${cnpj14}`)))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.contracts).toHaveLength(1)
    expect(body.contracts[0].city).toBeNull()
    expect(body.contracts[0].state).toBeNull()
    expect(body.contracts[0].cityId).toBe('9999999')
    // cities array só inclui cityIds conhecidas
    expect(body.stats.cities).toEqual([])
  })
})

describe('GET /suppliers/{cnpj} — headers de resposta', () => {
  it('inclui X-Citation apontando suppliers-prod + alerts-prod GSI', async () => {
    const cnpj14 = '12345678000199'
    mockDdbSend.mockResolvedValue({ Items: [] })

    const res = asResult(await handler(makeEvent(`/suppliers/${cnpj14}`)))
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-citation']).toBe(
      `dynamodb:suppliers-prod#SUPPLIER#${cnpj14}+dynamodb:alerts-prod#GSI2-cnpj-date`,
    )
  })

  it('inclui Cache-Control com s-maxage=600 e max-age=300', async () => {
    const cnpj14 = '12345678000199'
    mockDdbSend.mockResolvedValue({ Items: [] })

    const res = asResult(await handler(makeEvent(`/suppliers/${cnpj14}`)))
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toContain('s-maxage=600')
    expect(res.headers['cache-control']).toContain('max-age=300')
  })

  it('inclui headers de citação padrão (CC-BY-4.0 + atribuição)', async () => {
    const cnpj14 = '12345678000199'
    mockDdbSend.mockResolvedValue({ Items: [] })

    const res = asResult(await handler(makeEvent(`/suppliers/${cnpj14}`)))
    expect(res.headers['x-license']).toBe('CC-BY-4.0')
    expect(res.headers['x-source']).toBe('queridodiario.ok.org.br')
    expect(res.headers['x-attribution']).toBe('Fiscal Digital (fiscaldigital.org)')
    expect(res.headers['etag']).toMatch(/^"[a-f0-9]{16}"$/)
  })
})

describe('GET /suppliers/{cnpj} — OpenAPI spec', () => {
  it('declara /suppliers/{cnpj} no spec', async () => {
    const res = asResult(await handler(makeEvent('/openapi.json')))
    expect(res.statusCode).toBe(200)
    const spec = JSON.parse(res.body)
    expect(spec.paths['/suppliers/{cnpj}']).toBeDefined()
    expect(spec.paths['/suppliers/{cnpj}'].get.operationId).toBe('getSupplier')
    expect(spec.components.schemas.SupplierResponse).toBeDefined()
    expect(spec.components.schemas.SupplierProfile).toBeDefined()
    expect(spec.components.schemas.SupplierContract).toBeDefined()
    expect(spec.components.schemas.SupplierFinding).toBeDefined()
  })
})
