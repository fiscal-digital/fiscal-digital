/**
 * Tests for `maybeWriteSupplier` — derivação de SUPPLIER a partir de Finding.
 *
 * Cobre os 2 bugs fixados em PR 1 (MIT-02 / EVO-002):
 *   1. Normalização CNPJ (alinhada com leitura em `querySuppliersContract`).
 *   2. Idempotência diária no `sk` (reanalyze do mesmo gazette/dia sobrescreve).
 *
 * Também garante:
 *   - feature flag OFF → no-op
 *   - CNPJ inválido → no-op
 *   - GSI key safety: secretariaCityKey só é gravado quando truthy
 *     (LRN-20260502-019 — null em GSI key causa ValidationException em prod)
 *   - Write best-effort: falha de DDB não lança
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
  UpdateCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

// Engine mocks
const mockAnalisarLicitacoes = jest.fn().mockResolvedValue([])
const mockAnalisarContratos = jest.fn().mockResolvedValue([])
const mockAnalisarFornecedores = jest.fn().mockResolvedValue([])
const mockAnalisarPessoal = jest.fn().mockResolvedValue([])
const mockConsolidar = jest.fn()
const mockSaveMemoryExecute = jest.fn().mockResolvedValue({
  data: undefined,
  source: 'dynamodb:mock',
  confidence: 1.0,
})
const mockIsFeatureEnabled = jest.fn().mockResolvedValue(false)

jest.mock('@fiscal-digital/engine', () => ({
  fiscalLicitacoes: { id: 'fiscal-licitacoes', description: 'mock', analisar: mockAnalisarLicitacoes },
  fiscalContratos: { id: 'fiscal-contratos', description: 'mock', analisar: mockAnalisarContratos },
  fiscalFornecedores: { id: 'fiscal-fornecedores', description: 'mock', analisar: mockAnalisarFornecedores },
  fiscalFornecedoresV2: { id: 'fiscal-fornecedores', description: 'mock-v2', analisar: jest.fn().mockResolvedValue([]) },
  fiscalPessoal: { id: 'fiscal-pessoal', description: 'mock', analisar: mockAnalisarPessoal },
  fiscalConvenios: { id: 'fiscal-convenios', description: 'mock', analisar: jest.fn().mockResolvedValue([]) },
  fiscalNepotismo: { id: 'fiscal-nepotismo', description: 'mock', analisar: jest.fn().mockResolvedValue([]) },
  fiscalPublicidade: { id: 'fiscal-publicidade', description: 'mock', analisar: jest.fn().mockResolvedValue([]) },
  fiscalLocacao: { id: 'fiscal-locacao', description: 'mock', analisar: jest.fn().mockResolvedValue([]) },
  fiscalDiarias: { id: 'fiscal-diarias', description: 'mock', analisar: jest.fn().mockResolvedValue([]) },
  fiscalGeral: { id: 'fiscal-geral', description: 'mock', consolidar: mockConsolidar },
  createCachedExtractEntities: jest.fn(() => ({
    name: 'extract_entities_cached',
    description: 'mock',
    execute: jest.fn(),
  })),
  saveMemory: { name: 'save_memory', description: 'mock', execute: mockSaveMemoryExecute },
  generateNarrative: {
    name: 'generate_narrative',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({
      data: 'Narrativa.',
      source: 'https://queridodiario.ok.org.br',
      confidence: 0.9,
    }),
  },
  querySuppliersContract: { name: 'query_suppliers_contract', description: 'mock', execute: jest.fn() },
  gazetteKey: jest.fn(() => null),
  requireEnv: jest.fn(
    (_name: string) => 'https://sqs.us-east-1.amazonaws.com/123456789012/fiscal-digital-queue-prod',
  ),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    appendKeys: jest.fn(),
    removeKeys: jest.fn(),
  })),
  getPublishThresholds: jest.fn().mockResolvedValue({
    riskThreshold: 60,
    confidenceThreshold: 0.70,
  }),
  isFeatureEnabled: mockIsFeatureEnabled,
  queryConcentracaoGSI2: jest.fn().mockResolvedValue([]),
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
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
      cnpjs: ['12.345.678/0001-99'],
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
    riskScore: 65,
    confidence: 0.80,
    evidence: [
      {
        source: 'https://queridodiario.ok.org.br/gazettes/gazette-001',
        excerpt: 'dispensa de licitação no valor de R$ 80.000,00',
        date: '2026-03-15',
      },
    ],
    narrative: 'Identificamos dispensa publicada em 15/03/2026.',
    legalBasis: 'Lei 14.133/2021, Art. 75, II',
    cnpj: '12.345.678/0001-99',
    value: 80000,
    contractNumber: 'CT-2026-001',
    secretaria: 'Saúde',
    createdAt: '2026-03-15T12:00:00.000Z',
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

/**
 * Retorna apenas as chamadas a `saveMemory.execute` que gravaram em
 * `fiscal-digital-suppliers-prod` (ignora as gravações de FINDING# em alerts-prod).
 */
function supplierWrites(): Array<{
  pk: string
  table: string
  item: Record<string, unknown>
}> {
  return mockSaveMemoryExecute.mock.calls
    .map(args => args[0] as { pk: string; table: string; item: Record<string, unknown> })
    .filter(arg => typeof arg.pk === 'string' && arg.pk.startsWith('SUPPLIER#'))
}

// ---------------------------------------------------------------------------
// Setup
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
  mockAnalisarLicitacoes.mockResolvedValue([])
  mockAnalisarContratos.mockResolvedValue([])
  mockAnalisarFornecedores.mockResolvedValue([])
  mockAnalisarPessoal.mockResolvedValue([])
  mockConsolidar.mockImplementation(({ findings }: { findings: unknown[] }) => findings)
  mockIsFeatureEnabled.mockResolvedValue(false)
  process.env.ALERTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/fiscal-digital-queue-prod'
  process.env.ALERTS_TABLE = 'fiscal-digital-alerts-prod'
  process.env.SUPPLIERS_TABLE = 'fiscal-digital-suppliers-prod'
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('flag OFF → saveMemory NÃO é chamado para SUPPLIER#', async () => {
  mockIsFeatureEnabled.mockResolvedValue(false)
  const finding = makeFinding()
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  expect(supplierWrites()).toHaveLength(0)
  // Mas a gravação do FINDING# em alerts-prod ainda deve ter ocorrido
  expect(mockSaveMemoryExecute).toHaveBeenCalled()
})

test('flag ON + cnpj com máscara → item gravado com pk normalizado (14 dígitos)', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  const finding = makeFinding({ cnpj: '12.345.678/0001-99' })
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const writes = supplierWrites()
  expect(writes).toHaveLength(1)
  expect(writes[0].pk).toBe('SUPPLIER#12345678000199')
  expect(writes[0].table).toBe('fiscal-digital-suppliers-prod')
  expect(writes[0].item.cnpj).toBe('12345678000199')
})

test('flag ON + reanalyze no mesmo dia (createdAt diferente) → mesmo sk (idempotência diária)', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)

  // Primeira execução
  mockAnalisarLicitacoes.mockResolvedValue([
    makeFinding({ createdAt: '2026-03-15T08:00:00.000Z' }),
  ])
  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  // Reanalyze: mesmo finding, novo createdAt mais tarde no mesmo dia
  jest.clearAllMocks()
  mockSaveMemoryExecute.mockResolvedValue({
    data: undefined,
    source: 'dynamodb:mock',
    confidence: 1.0,
  })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockConsolidar.mockImplementation(({ findings }: { findings: unknown[] }) => findings)
  mockAnalisarLicitacoes.mockResolvedValue([
    makeFinding({ createdAt: '2026-03-15T20:45:00.000Z' }),
  ])
  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const writes = supplierWrites()
  expect(writes).toHaveLength(1)
  // sk deve ter granularidade diária — mesmo dia => mesmo sk
  expect(writes[0].item.sk).toBe('2026-03-15#CT-2026-001')
})

test('flag ON + reanalyze em dia diferente → sk diferente', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)

  mockAnalisarLicitacoes.mockResolvedValue([
    makeFinding({ createdAt: '2026-03-15T08:00:00.000Z' }),
  ])
  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))
  const skDay1 = supplierWrites()[0].item.sk

  jest.clearAllMocks()
  mockSaveMemoryExecute.mockResolvedValue({
    data: undefined,
    source: 'dynamodb:mock',
    confidence: 1.0,
  })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockConsolidar.mockImplementation(({ findings }: { findings: unknown[] }) => findings)
  mockAnalisarLicitacoes.mockResolvedValue([
    makeFinding({ createdAt: '2026-03-16T08:00:00.000Z' }),
  ])
  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))
  const skDay2 = supplierWrites()[0].item.sk

  expect(skDay1).toBe('2026-03-15#CT-2026-001')
  expect(skDay2).toBe('2026-03-16#CT-2026-001')
  expect(skDay1).not.toBe(skDay2)
})

test('flag ON + cnpj inválido (poucos dígitos) → no-op', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockAnalisarLicitacoes.mockResolvedValue([makeFinding({ cnpj: '123' })])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  expect(supplierWrites()).toHaveLength(0)
})

test('flag ON + cnpj não-numérico ("abc") → no-op', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockAnalisarLicitacoes.mockResolvedValue([makeFinding({ cnpj: 'abc' })])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  expect(supplierWrites()).toHaveLength(0)
})

test('EVO-024: flag ON + cnpj alfanumérico (Lei 14.973/2024) com máscara → pk grava letras em UPPERCASE (não corrompe como /\\D/g faria)', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  const finding = makeFinding({ cnpj: '12.34a.bcd/0001-16' })
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const writes = supplierWrites()
  expect(writes).toHaveLength(1)
  expect(writes[0].pk).toBe('SUPPLIER#1234ABCD000116')
  expect(writes[0].item.cnpj).toBe('1234ABCD000116')
})

test('flag ON + finding sem secretaria → item gravado SEM atributo secretariaCityKey (LRN-20260502-019)', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockAnalisarLicitacoes.mockResolvedValue([makeFinding({ secretaria: undefined })])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const writes = supplierWrites()
  expect(writes).toHaveLength(1)
  // Atributo de GSI key deve estar AUSENTE (não `null` — null em GSI key
  // causa ValidationException em prod silenciosamente).
  expect(writes[0].item).not.toHaveProperty('secretariaCityKey')
  expect(writes[0].item).not.toHaveProperty('secretaria')
})

test('flag ON + finding com secretaria → item gravado COM secretariaCityKey composto', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockAnalisarLicitacoes.mockResolvedValue([
    makeFinding({ secretaria: 'Saúde', cityId: '4305108' }),
  ])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const writes = supplierWrites()
  expect(writes).toHaveLength(1)
  expect(writes[0].item.secretaria).toBe('Saúde')
  expect(writes[0].item.secretariaCityKey).toBe('Saúde#4305108')
})

test('flag ON + saveMemory.execute lança → função não propaga erro (best-effort)', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  const finding = makeFinding()
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  // 1ª chamada (persistFinding) sucede; 2ª chamada (maybeWriteSupplier) falha
  mockSaveMemoryExecute
    .mockResolvedValueOnce({
      data: undefined,
      source: 'dynamodb:mock',
      confidence: 1.0,
    })
    .mockRejectedValueOnce(new Error('DDB ProvisionedThroughputExceeded'))

  // Não deve lançar — o handler nem mesmo o finding deve ser afetado
  await expect(
    handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())])),
  ).resolves.toBeUndefined()
})

test('contractedAtIso preserva timestamp completo enquanto contractedAt fica em granularidade diária', async () => {
  mockIsFeatureEnabled.mockResolvedValue(true)
  const finding = makeFinding({ createdAt: '2026-03-15T12:34:56.789Z' })
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const writes = supplierWrites()
  expect(writes).toHaveLength(1)
  expect(writes[0].item.contractedAt).toBe('2026-03-15')
  expect(writes[0].item.contractedAtIso).toBe('2026-03-15T12:34:56.789Z')
})
