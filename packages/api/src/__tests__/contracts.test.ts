/**
 * Testes de contrato (TST-010..014).
 *
 * Valida que a resposta REAL de cada endpoint público casa com o schema zod de
 * `@fiscal-digital/contracts`. É o gate que impede drift silencioso entre a API
 * e o `fiscal-digital-web`, que deriva seus tipos desses mesmos schemas.
 *
 * Usa `.strict()` nos parses de topo: campo NOVO na resposta sem atualizar o
 * contrato também falha — do contrário o web continuaria cego para ele (foi
 * assim que `confidence` ficou anos fora da tipagem do web e que `pk` vazou em
 * /transparencia/costs).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { Finding } from '@fiscal-digital/engine'
import {
  alertsResponseSchema,
  alertDetailSchema,
  citiesResponseSchema,
  cityStatsSchema,
  statsResponseSchema,
  costsResponseSchema,
  costMtdResponseSchema,
  healthResponseSchema,
} from '@fiscal-digital/contracts'

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
  BatchGetCommand: jest.fn().mockImplementation((input: unknown) => ({ __type: 'BatchGet', input })),
}))

import { handler } from '../index'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'FINDING#fiscal-licitacoes#4305108#dispensa_irregular#4305108#2026-04-15#abc',
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
      requestId: 'req-contract',
      routeKey: '$default',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1767225600000,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2
}

function bodyOf(r: APIGatewayProxyResultV2): unknown {
  const body = typeof r === 'string' ? r : (r.body ?? '')
  return JSON.parse(body)
}

beforeEach(() => {
  mockDdbSend.mockReset()
})

// ─── Contratos ───────────────────────────────────────────────────────────────

describe('contrato: GET /alerts', () => {
  it('resposta casa com alertsResponseSchema (strict)', async () => {
    mockDdbSend.mockResolvedValue({ Items: [makeFinding()] })

    const res = await handler(makeEvent('/alerts'))
    const parsed = alertsResponseSchema.strict().safeParse(bodyOf(res as APIGatewayProxyResultV2))

    if (!parsed.success) throw new Error(`contrato /alerts divergiu:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
    expect(parsed.success).toBe(true)
  })

  it('finding SEM evidence: `source` ausente não quebra o contrato', async () => {
    // Divergência histórica: o web tipava `source` como obrigatório e recebia
    // undefined quando o finding não tinha evidence.
    mockDdbSend.mockResolvedValue({ Items: [makeFinding({ evidence: [] })] })

    const res = await handler(makeEvent('/alerts'))
    const parsed = alertsResponseSchema.safeParse(bodyOf(res as APIGatewayProxyResultV2))

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.items[0].source).toBeUndefined()
      expect(parsed.data.items[0].evidence).toEqual([])
    }
  })

  it('`confidence` está presente no item (campo que faltava na tipagem do web)', async () => {
    mockDdbSend.mockResolvedValue({ Items: [makeFinding({ confidence: 0.91 })] })

    const res = await handler(makeEvent('/alerts'))
    const parsed = alertsResponseSchema.parse(bodyOf(res as APIGatewayProxyResultV2))

    expect(parsed.items[0].confidence).toBe(0.91)
  })
})

describe('contrato: GET /cities', () => {
  it('resposta casa com citiesResponseSchema', async () => {
    mockDdbSend.mockImplementation((cmd: { __type?: string }) => {
      if (cmd?.__type === 'BatchGet') {
        return Promise.resolve({
          Responses: { 'fiscal-digital-gazettes-prod': [{ pk: 'BACKFILL#4305108', lastDate: '2025-12-15' }] },
        })
      }
      return Promise.resolve({ Items: [] })
    })

    const res = await handler(makeEvent('/cities'))
    const parsed = citiesResponseSchema.safeParse(bodyOf(res as APIGatewayProxyResultV2))

    if (!parsed.success) throw new Error(`contrato /cities divergiu:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
    expect(parsed.data!.length).toBeGreaterThan(0)
  })
})

describe('contrato: GET /cities/{cityId}/stats', () => {
  it('resposta casa com cityStatsSchema (strict)', async () => {
    mockDdbSend.mockImplementation((cmd: { __type?: string }) => {
      if (cmd?.__type === 'BatchGet') {
        return Promise.resolve({
          Responses: { 'fiscal-digital-gazettes-prod': [{ pk: 'BACKFILL#4305108', lastDate: '2025-12-15' }] },
        })
      }
      if (cmd?.__type === 'Scan') {
        return Promise.resolve({ Items: [{ pk: 'GAZETTE#4305108#2025-12-15#abc', date: '2025-12-15' }] })
      }
      return Promise.resolve({ Items: [] })
    })

    const res = await handler(makeEvent('/cities/4305108/stats'))
    const parsed = cityStatsSchema.strict().safeParse(bodyOf(res as APIGatewayProxyResultV2))

    if (!parsed.success) throw new Error(`contrato /cities/{id}/stats divergiu:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
    expect(parsed.success).toBe(true)
  })
})

describe('contrato: GET /stats', () => {
  it('resposta casa com statsResponseSchema (strict)', async () => {
    mockDdbSend.mockResolvedValue({ Items: [makeFinding()] })

    const res = await handler(makeEvent('/stats'))
    const parsed = statsResponseSchema.strict().safeParse(bodyOf(res as APIGatewayProxyResultV2))

    if (!parsed.success) throw new Error(`contrato /stats divergiu:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
    expect(parsed.success).toBe(true)
  })
})

describe('contrato: GET /transparencia/costs', () => {
  const monthlyItem = {
    pk: 'COST#MONTHLY#2026-07',
    month: '2026-07',
    mtdUsd: 3.2,
    mtdBrl: 17.5,
    projectedUsd: 6.1,
    projectedBrl: 33.2,
    prevMonthBrl: 28.0,
    deltaPct: 18.5,
    byService: [{ service: 'AWS Lambda', usd: 1.1, brl: 6.0 }],
    ptaxBrl: 5.45,
    capturedAt: '2026-07-23T06:00:00.000Z',
  }

  it('resposta casa com costsResponseSchema e NÃO vaza `pk` do DynamoDB (strict)', async () => {
    mockDdbSend.mockImplementation((cmd: { __type?: string; input?: { KeyConditionExpression?: string } }) => {
      if (cmd?.__type === 'Query') {
        const isMonthly = String(cmd.input?.KeyConditionExpression ?? '').length > 0
        return Promise.resolve({ Items: isMonthly ? [monthlyItem] : [] })
      }
      return Promise.resolve({ Items: [monthlyItem] })
    })

    const res = await handler(makeEvent('/transparencia/costs', { days: '30' }))
    const body = bodyOf(res as APIGatewayProxyResultV2) as { monthly?: Record<string, unknown> | null }

    // O contrato é strict: se `pk` voltar a vazar, o parse falha aqui.
    const parsed = costsResponseSchema.strict().safeParse(body)
    if (!parsed.success) throw new Error(`contrato /transparencia/costs divergiu:\n${JSON.stringify(parsed.error.issues, null, 2)}`)

    if (body.monthly) expect(body.monthly).not.toHaveProperty('pk')
  })
})

describe('contrato: GET /health', () => {
  it('resposta casa com healthResponseSchema (strict)', async () => {
    const res = await handler(makeEvent('/health'))
    const parsed = healthResponseSchema.strict().safeParse(bodyOf(res as APIGatewayProxyResultV2))

    if (!parsed.success) throw new Error(`contrato /health divergiu:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
    expect(parsed.success).toBe(true)
  })
})

describe('contrato: schemas exportados', () => {
  it('alertDetailSchema não exige pdfProxyUrl (endpoint /alerts/{slug} não emite)', () => {
    const detail = {
      id: 'x', fiscalId: 'fiscal-licitacoes', type: 'dispensa_irregular', cityId: '4305108',
      city: 'Caxias do Sul', state: 'RS', riskScore: 75, confidence: 0.85,
      narrative: 'Identificamos dispensa publicada em 15/04/2026.',
      legalBasis: 'Lei 14.133/2021, Art. 75, II',
      cachedPdfUrl: null, evidence: [], createdAt: '2026-04-15T00:00:00.000Z',
    }
    expect(alertDetailSchema.safeParse(detail).success).toBe(true)
  })

  it('costMtdResponseSchema aceita deltaPct null', () => {
    const mtd = {
      currency: 'BRL', month: '2026-07', mtdBrl: 17.5, projectedBrl: 33.2,
      lifetimeBrl: 120.0, deltaPct: null, updatedAt: '2026-07-23T06:00:00.000Z',
      source: 'aws-cost-explorer',
    }
    expect(costMtdResponseSchema.safeParse(mtd).success).toBe(true)
  })
})
