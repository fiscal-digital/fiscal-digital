/**
 * brand-gate-integration.test.ts
 *
 * Testa que o handler rejeita findings com narrativa acusatória,
 * tenta regenerar via Haiku, e marca como `unpublishable` quando
 * todas as tentativas exaurem.
 *
 * Estratégia de mock:
 *   - channels/registry → retorna canal stub que registra chamadas
 *   - publications-store → alreadyPublished: false, recordPublication: no-op,
 *     markUnpublishable: spy
 *   - regenerateNarrative → mock para controlar o output das tentativas
 */

import type { SQSEvent, SQSRecord } from 'aws-lambda'
import type { Finding } from '@fiscal-digital/engine'

// ─── Shared spies ──────────────────────────────────────────────────────────
const publishSpy = jest.fn()
const markUnpublishableSpy = jest.fn().mockResolvedValue(undefined)
const regenerateNarrativeSpy = jest.fn()

// ─── Mock channels/registry ────────────────────────────────────────────────
jest.mock('../channels/registry', () => ({
  loadEnabledChannels: () => [
    {
      name: 'reddit' as const,
      enabled: () => true,
      publish: publishSpy,
    },
  ],
}))

// ─── Mock publications-store ───────────────────────────────────────────────
jest.mock('../publications-store', () => ({
  PublicationsStore: jest.fn().mockImplementation(() => ({
    alreadyPublished: jest.fn().mockResolvedValue(false),
    recordPublication: jest.fn().mockResolvedValue(undefined),
    markUnpublishable: markUnpublishableSpy,
  })),
}))

// ─── Mock regenerateNarrative no engine ────────────────────────────────────
// Mockar só `regenerateNarrative`, deixando validateNarrative / createLogger /
// tipos passarem do real. Mock devolve uma Promise<string> controlada por teste.
jest.mock('@fiscal-digital/engine', () => {
  const actual = jest.requireActual('@fiscal-digital/engine')
  return {
    ...actual,
    regenerateNarrative: regenerateNarrativeSpy,
  }
})

// ─── Mock notifyWebRevalidate (best-effort, evita rede em teste) ───────────
jest.mock('../web-revalidate', () => ({
  notifyWebRevalidate: jest.fn().mockResolvedValue(undefined),
}))

// ─── Import handler after mocks ────────────────────────────────────────────
import { handler } from '../index'

// ─── Fixtures ──────────────────────────────────────────────────────────────

const BASE_FINDING: Finding = {
  id: 'finding-test-001',
  fiscalId: 'fiscal-licitacoes',
  cityId: '4305108',
  type: 'fracionamento',
  riskScore: 85,
  confidence: 0.92,
  narrative:
    'Identificamos três dispensas de licitação consecutivas para o mesmo fornecedor, ' +
    'somando R$ 145.000,00, acima do limite legal de R$ 50.000,00 para serviços.',
  legalBasis: 'Lei 14.133/2021, Art. 75, II',
  evidence: [
    {
      source: 'https://queridodiario.ok.org.br/4305108/2024-03-15/excerpt/12345',
      excerpt: 'Dispensa de licitação nº 007/2024 — Valor: R$ 145.000,00',
      date: '2024-03-15',
    },
  ],
}

function makeSQSEvent(finding: Finding): SQSEvent {
  const record: Partial<SQSRecord> = {
    messageId: 'msg-001',
    body: JSON.stringify(finding),
  }
  return { Records: [record as SQSRecord] }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handler — brand-gate integration', () => {
  beforeEach(() => {
    publishSpy.mockResolvedValue({
      channel: 'reddit',
      externalId: 'abc123',
      url: 'https://reddit.com/r/test/comments/abc123',
      publishedAt: new Date().toISOString(),
    })
    jest.clearAllMocks()
    markUnpublishableSpy.mockResolvedValue(undefined)
  })

  it('finding com narrativa factual → publish chamado normalmente', async () => {
    const event = makeSQSEvent(BASE_FINDING)

    await expect(handler(event)).resolves.toBeUndefined()

    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(regenerateNarrativeSpy).not.toHaveBeenCalled()
    expect(markUnpublishableSpy).not.toHaveBeenCalled()
  })

  it('narrativa com "fraude" mas regeneração 1× passa → publish chamado, NÃO marca unpublishable', async () => {
    const finding: Finding = {
      ...BASE_FINDING,
      id: 'finding-test-002',
      narrative:
        'Identificamos indício de fraude no contrato 042/2024 da Secretaria de Obras.',
    }
    regenerateNarrativeSpy.mockResolvedValueOnce(
      'Identificamos indícios de irregularidade no contrato 042/2024 da Secretaria de Obras.',
    )
    const event = makeSQSEvent(finding)

    await expect(handler(event)).resolves.toBeUndefined()

    expect(regenerateNarrativeSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(markUnpublishableSpy).not.toHaveBeenCalled()
  })

  it('narrativa com "fraude" e 3 regenerações também rejeitadas → markUnpublishable + publish NÃO chamado + sem throw', async () => {
    const finding: Finding = {
      ...BASE_FINDING,
      id: 'finding-test-003',
      narrative: 'Identificamos fraude clara no contrato.',
    }
    // Todas as regenerações ainda contêm termos proibidos
    regenerateNarrativeSpy
      .mockResolvedValueOnce('Houve desvio de recursos no contrato.')
      .mockResolvedValueOnce('Há indício de fraude continuada.')
      .mockResolvedValueOnce('O esquema beneficia o fornecedor.')
    const event = makeSQSEvent(finding)

    await expect(handler(event)).resolves.toBeUndefined()

    expect(regenerateNarrativeSpy).toHaveBeenCalledTimes(3)
    expect(publishSpy).not.toHaveBeenCalled()
    expect(markUnpublishableSpy).toHaveBeenCalledWith(
      'finding-test-003',
      'brand_gate',
      expect.any(Array),
    )
  })
})
