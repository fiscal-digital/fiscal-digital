/**
 * Tests for analyzer Lambda handler.
 *
 * All external dependencies are mocked:
 * - @fiscal-digital/engine  (fiscais + skills)
 * - @aws-sdk/client-sqs     (SendMessageCommand)
 * - @aws-sdk/client-dynamodb (DynamoDBClient)
 * - @aws-sdk/lib-dynamodb   (DynamoDBDocumentClient + QueryCommand)
 */

import type { SQSEvent, SQSRecord } from 'aws-lambda'
import type { Finding, CollectorMessage } from '@fiscal-digital/engine'

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that resolve them
// ---------------------------------------------------------------------------

const mockSqsSend = jest.fn().mockResolvedValue({})
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

const mockDdbSend = jest.fn().mockResolvedValue({ Items: [] })
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}))
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockDdbSend }),
  },
  QueryCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

// Mocks for fiscais and skills from engine
const mockAnalisar = jest.fn()
const mockSaveMemoryExecute = jest.fn().mockResolvedValue({
  data: undefined,
  source: 'dynamodb:mock',
  confidence: 1.0,
})
const mockGenerateNarrativeExecute = jest.fn().mockResolvedValue({
  data: 'Narrativa gerada.',
  source: 'https://queridodiario.ok.org.br',
  confidence: 0.9,
})

jest.mock('@fiscal-digital/engine', () => ({
  fiscalLicitacoes: { id: 'fiscal-licitacoes', description: 'mock', analisar: mockAnalisar },
  fiscalContratos: { id: 'fiscal-contratos', description: 'mock', analisar: mockAnalisar },
  extractEntities: { name: 'extract_entities', description: 'mock', execute: jest.fn() },
  saveMemory: { name: 'save_memory', description: 'mock', execute: mockSaveMemoryExecute },
  generateNarrative: { name: 'generate_narrative', description: 'mock', execute: mockGenerateNarrativeExecute },
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks are set up
// ---------------------------------------------------------------------------

import { handler } from '../index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCollectorMessage(overrides: Partial<CollectorMessage> = {}): CollectorMessage {
  return {
    gazetteId: 'gazette-001',
    territory_id: '4305108',
    date: '2026-03-15',
    url: 'https://queridodiario.ok.org.br/gazettes/gazette-001',
    excerpts: ['dispensa de licitação no valor de R$ 80.000,00'],
    entities: {
      cnpjs: ['12.345.678/0001-90'],
      values: [80000],
      dates: ['2026-03-15'],
      contractNumbers: [],
    },
    ...overrides,
  }
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    fiscalId: 'fiscal-licitacoes',
    cityId: '4305108',
    type: 'dispensa_irregular',
    riskScore: 75,
    confidence: 0.85,
    evidence: [
      {
        source: 'https://queridodiario.ok.org.br/gazettes/gazette-001',
        excerpt: 'dispensa de licitação no valor de R$ 80.000,00',
        date: '2026-03-15',
      },
    ],
    narrative: 'Identificamos dispensa publicada em 15/03/2026.',
    legalBasis: 'Lei 14.133/2021, Art. 75, II',
    cnpj: '12.345.678/0001-90',
    value: 80000,
    createdAt: '2026-03-15T00:00:00.000Z',
    ...overrides,
  }
}

function makeSQSRecord(body: object | string, messageId = 'msg-001'): SQSRecord {
  return {
    messageId,
    receiptHandle: 'receipt-001',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1000000',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '1000001',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
    awsRegion: 'us-east-1',
  }
}

function makeSQSEvent(records: SQSRecord[]): SQSEvent {
  return { Records: records }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks()
  mockSqsSend.mockResolvedValue({})
  mockDdbSend.mockResolvedValue({ Items: [] })
  mockSaveMemoryExecute.mockResolvedValue({
    data: undefined,
    source: 'dynamodb:mock',
    confidence: 1.0,
  })
  process.env.ALERTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/fiscal-digital-queue-prod'
  process.env.ALERTS_TABLE = 'fiscal-digital-alerts-prod'
})

// ---------------------------------------------------------------------------
// Test 1: gazette válida → chama ambos os Fiscais
// ---------------------------------------------------------------------------

test('gazette válida chama fiscalLicitacoes e fiscalContratos', async () => {
  mockAnalisar.mockResolvedValue([])

  const msg = makeCollectorMessage()
  const event = makeSQSEvent([makeSQSRecord(msg)])

  await handler(event)

  // analisar é compartilhado entre os dois fiscais no mock — deve ter sido chamado 2×
  expect(mockAnalisar).toHaveBeenCalledTimes(2)

  // Ambas as chamadas devem receber a gazette convertida corretamente
  const calls = mockAnalisar.mock.calls
  expect(calls[0][0].gazette.id).toBe('gazette-001')
  expect(calls[1][0].gazette.id).toBe('gazette-001')
  expect(calls[0][0].cityId).toBe('4305108')
  expect(calls[1][0].cityId).toBe('4305108')
})

// ---------------------------------------------------------------------------
// Test 2: riskScore < 60 → NÃO envia para publish queue
// ---------------------------------------------------------------------------

test('finding com riskScore < 60 não é enfileirado para publicação', async () => {
  const lowRiskFinding = makeFinding({ riskScore: 55, confidence: 0.90 })
  mockAnalisar.mockResolvedValueOnce([lowRiskFinding]).mockResolvedValueOnce([])

  const msg = makeCollectorMessage()
  const event = makeSQSEvent([makeSQSRecord(msg)])

  await handler(event)

  expect(mockSqsSend).not.toHaveBeenCalled()
  // Mas deve ter persistido no DynamoDB
  expect(mockSaveMemoryExecute).toHaveBeenCalledTimes(1)
})

// ---------------------------------------------------------------------------
// Test 3: riskScore >= 60 E confidence >= 0.70 → envia para publish queue
// ---------------------------------------------------------------------------

test('finding com riskScore >= 60 e confidence >= 0.70 é enfileirado para publicação', async () => {
  const publishableFinding = makeFinding({ riskScore: 75, confidence: 0.85 })
  mockAnalisar.mockResolvedValueOnce([publishableFinding]).mockResolvedValueOnce([])

  const msg = makeCollectorMessage()
  const event = makeSQSEvent([makeSQSRecord(msg)])

  await handler(event)

  expect(mockSqsSend).toHaveBeenCalledTimes(1)
  // Confirmar que a mensagem enviada contém o finding serializado
  const [sendCommand] = mockSqsSend.mock.calls[0]
  const sent = JSON.parse((sendCommand as { MessageBody: string }).MessageBody) as Finding
  expect(sent.riskScore).toBe(75)
  expect(sent.type).toBe('dispensa_irregular')
})

// ---------------------------------------------------------------------------
// Test 4: falha de 1 fiscal não impede o outro (Promise.allSettled)
// ---------------------------------------------------------------------------

test('falha em fiscalLicitacoes não impede fiscalContratos de rodar', async () => {
  const contratosResult = makeFinding({ fiscalId: 'fiscal-contratos', type: 'aditivo_abusivo', riskScore: 70, confidence: 0.80 })

  // Primeiro chamado (licitacoes) lança; segundo (contratos) retorna finding
  mockAnalisar
    .mockRejectedValueOnce(new Error('Anthropic timeout'))
    .mockResolvedValueOnce([contratosResult])

  const msg = makeCollectorMessage()
  const event = makeSQSEvent([makeSQSRecord(msg)])

  // Não deve lançar
  await expect(handler(event)).resolves.toBeUndefined()

  // Finding do fiscal de contratos ainda deve ter sido enfileirado
  expect(mockSqsSend).toHaveBeenCalledTimes(1)
  const [sendCommand] = mockSqsSend.mock.calls[0]
  const sent = JSON.parse((sendCommand as { MessageBody: string }).MessageBody) as Finding
  expect(sent.fiscalId).toBe('fiscal-contratos')
})

// ---------------------------------------------------------------------------
// Test 5: body inválido (JSON parse error) → loga erro mas continua próximo record
// ---------------------------------------------------------------------------

test('body inválido não interrompe processamento dos records subsequentes', async () => {
  const validFinding = makeFinding({ riskScore: 65, confidence: 0.75 })
  // licitacoes retorna finding, contratos retorna vazio
  mockAnalisar.mockResolvedValueOnce([validFinding]).mockResolvedValueOnce([])

  const invalidRecord = makeSQSRecord('this is not json', 'msg-invalid')
  const validRecord = makeSQSRecord(makeCollectorMessage(), 'msg-valid')

  const event = makeSQSEvent([invalidRecord, validRecord])

  // Não deve lançar
  await expect(handler(event)).resolves.toBeUndefined()

  // O record válido deve ter sido processado — ambos os fiscais foram chamados
  expect(mockAnalisar).toHaveBeenCalledTimes(2)
  // Finding válido (riskScore=65, confidence=0.75) deve ter sido publicado uma vez
  expect(mockSqsSend).toHaveBeenCalledTimes(1)
})
