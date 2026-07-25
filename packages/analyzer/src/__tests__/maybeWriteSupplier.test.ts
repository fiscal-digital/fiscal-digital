/**
 * Tests do `writeSupplierFromFinding` — a ponte Finding → skill do engine.
 *
 * Escopo desde EVO-005 (2026-07-25): o analyzer **não grava mais** em
 * `suppliers-prod`. Ele monta o input a partir do Finding e delega para
 * `maybeWriteSupplier` (engine), que detém normalização de CNPJ, feature flag e
 * gate de qualidade. A gravação em si é testada em
 * `packages/engine/src/skills/__tests__/maybe_write_supplier.test.ts`.
 *
 * Os testes anteriores afirmavam o comportamento do writer local — inclusive
 * `contractedAt` em granularidade diária derivado do timestamp da análise, que
 * era justamente o defeito que corrompeu 250 registros em prod.
 *
 * Cobertura aqui:
 *   - mapeamento Finding → input da skill (incluindo campos ausentes)
 *   - CNPJ repassado cru: um único ponto de normalização, alinhado ao leitor
 *   - `contractedAt` vem do Finding, nunca do instante da análise (regressão)
 *   - sem cnpj / sem fonte estável → skill não é chamada
 *   - erro da skill é best-effort: não derruba o finding
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
// EVO-005: o analyzer delega para a skill do engine — o teste observa a chamada,
// não o PutCommand (a gravação em si é testada em maybe_write_supplier.test.ts).
const mockMaybeWriteSupplierExecute = jest.fn().mockResolvedValue({
  data: { written: false, skipReason: 'feature_flag_off' },
  source: 'noop:feature-flag:enable-supplier-write',
  confidence: 1.0,
})

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
  maybeWriteSupplier: { name: 'maybe_write_supplier', description: 'mock', execute: mockMaybeWriteSupplierExecute },
  // TEC-ANL-001: null aqui faria persistFinding pular (e maybeWriteSupplier
  // nunca rodar) — retorna key estável para URL presente, como o contrato real.
  gazetteKey: jest.fn((url?: string) => (url ? `MOCK#${url.slice(-10)}` : null)),
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

interface SupplierCall {
  cnpj: string
  cityId: string
  contractNumber: string
  contractedAt: string
  valueAmount: number
  secretaria: string
  sourceFindingId?: string
  table?: string
}

/** Chamadas ao `maybeWriteSupplier.execute` do engine. */
function supplierCalls(): SupplierCall[] {
  return mockMaybeWriteSupplierExecute.mock.calls.map(args => args[0] as SupplierCall)
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
  mockMaybeWriteSupplierExecute.mockResolvedValue({
    data: { written: false, skipReason: 'feature_flag_off' },
    source: 'noop:feature-flag:enable-supplier-write',
    confidence: 1.0,
  })
  process.env.ALERTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/fiscal-digital-queue-prod'
  process.env.ALERTS_TABLE = 'fiscal-digital-alerts-prod'
  process.env.SUPPLIERS_TABLE = 'fiscal-digital-suppliers-prod'
})

// ---------------------------------------------------------------------------
// Tests — EVO-005: o analyzer delega para a skill do engine
//
// O writer local do analyzer foi removido em 2026-07-25. Ele gravou 251
// registros em prod e nenhum era legivel: pk com mascara (leitor consulta a
// normalizada), contractedAt = timestamp da analise, secretariaCityKey no lugar
// de secretariaId/mesCNPJ (GSI2 ficou 100% vazio) e contractId = pk inteira do
// FINDING. Os testes antigos afirmavam esse comportamento como correto.
//
// Agora o contrato e: montar o input a partir do Finding e delegar. Normalizacao,
// feature flag e gate de qualidade sao responsabilidade da skill (testada em
// packages/engine/src/skills/__tests__/maybe_write_supplier.test.ts).
// ---------------------------------------------------------------------------

test('finding com cnpj → delega para a skill do engine', async () => {
  const finding = makeFinding()
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const calls = supplierCalls()
  expect(calls).toHaveLength(1)
  expect(calls[0].cnpj).toBe('12.345.678/0001-99')
  expect(calls[0].cityId).toBe('4305108')
  expect(calls[0].contractNumber).toBe('CT-2026-001')
  expect(calls[0].valueAmount).toBe(80000)
  expect(calls[0].secretaria).toBe('Saúde')
  expect(calls[0].table).toBe('fiscal-digital-suppliers-prod')
})

test('CNPJ é repassado cru — a normalização é da skill, não do analyzer', async () => {
  // Regressao: o analyzer local normalizava por conta propria e divergia do
  // leitor, produzindo pk mascarada. Agora ha um unico ponto de normalizacao.
  mockAnalisarLicitacoes.mockResolvedValue([makeFinding({ cnpj: '02.321.000/0001-19' })])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  expect(supplierCalls()[0].cnpj).toBe('02.321.000/0001-19')
})

test('contractedAt do Finding é repassado — NUNCA o timestamp da análise', async () => {
  // Regressao do defeito que corrompeu 250 registros: o writer antigo usava
  // createdAt (instante da analise) como data do contrato.
  const finding = makeFinding({
    contractedAt: '2024-04-16',
    createdAt: '2026-05-23T20:54:12.840Z',
  })
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const call = supplierCalls()[0]
  expect(call.contractedAt).toBe('2024-04-16')
  expect(call.contractedAt).not.toContain('2026-05-23')
  expect(call.contractedAt).not.toMatch(/T\d{2}:/)
})

test('Finding sem contractedAt → repassa vazio para a skill pular (não inventa data)', async () => {
  // Hoje nenhum Fiscal popula contractedAt. O comportamento correto e a skill
  // responder contracted_at_invalido — nao gravar com data fabricada.
  mockMaybeWriteSupplierExecute.mockResolvedValue({
    data: { written: false, skipReason: 'contracted_at_invalido' },
    source: 'skip:contracted_at_invalido',
    confidence: 1.0,
  })
  const finding = makeFinding()
  delete finding.contractedAt
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  expect(supplierCalls()[0].contractedAt).toBe('')
})

test('finding SEM cnpj → skill não é chamada', async () => {
  const finding = makeFinding()
  delete finding.cnpj
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  expect(supplierCalls()).toHaveLength(0)
})

test('campos ausentes viram string vazia / zero — a skill decide o skip', async () => {
  const finding = makeFinding()
  delete finding.secretaria
  delete finding.value
  delete finding.contractNumber
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  const call = supplierCalls()[0]
  expect(call.secretaria).toBe('')
  expect(call.contractNumber).toBe('')
  expect(call.valueAmount).toBe(0)
})

test('sourceFindingId propagado para rastreabilidade', async () => {
  mockAnalisarLicitacoes.mockResolvedValue([makeFinding()])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  // persistFinding hidrata finding.id com a pk antes de chamar o writer.
  expect(supplierCalls()[0].sourceFindingId).toMatch(/^FINDING#fiscal-licitacoes#4305108#/)
})

test('skill lançando erro NÃO derruba o finding (best-effort)', async () => {
  mockMaybeWriteSupplierExecute.mockRejectedValue(new Error('ValidationException'))
  mockAnalisarLicitacoes.mockResolvedValue([makeFinding()])

  await expect(
    handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())])),
  ).resolves.not.toThrow()

  // O FINDING# em alerts-prod continua gravado.
  const findingWrites = mockSaveMemoryExecute.mock.calls
    .map(a => a[0] as { pk: string })
    .filter(a => typeof a.pk === 'string' && a.pk.startsWith('FINDING#'))
  expect(findingWrites.length).toBeGreaterThan(0)
})

test('finding sem fonte estável não persiste e não chama a skill (TEC-ANL-001)', async () => {
  const finding = makeFinding({ evidence: [] })
  mockAnalisarLicitacoes.mockResolvedValue([finding])

  await handler(makeSQSEvent([makeSQSRecord(makeCollectorMessage())]))

  expect(supplierCalls()).toHaveLength(0)
})
