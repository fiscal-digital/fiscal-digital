/**
 * brand-gate-integration.test.ts
 *
 * Testa que o handler rejeita findings com narrativa acusatória
 * e deixa passar findings com narrativa factual.
 *
 * Estratégia de mock:
 *   - channels/registry → retorna canal stub que registra chamadas
 *   - publications-store → alreadyPublished: false, recordPublication: no-op
 */

import type { SQSEvent, SQSRecord } from 'aws-lambda'
import type { Finding } from '@fiscal-digital/engine'

// ─── Shared spy ────────────────────────────────────────────────────────────
const publishSpy = jest.fn()

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
  })),
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
  })

  it('finding com narrativa factual → publish chamado normalmente', async () => {
    const event = makeSQSEvent(BASE_FINDING)

    await expect(handler(event)).resolves.toBeUndefined()

    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledWith(BASE_FINDING)
  })

  it('finding com "fraude" na narrativa → throw + console.error + publish NÃO chamado', async () => {
    const finding: Finding = {
      ...BASE_FINDING,
      id: 'finding-test-002',
      narrative:
        'Identificamos indício de fraude no contrato 042/2024 da Secretaria de Obras.',
    }
    const event = makeSQSEvent(finding)

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler(event)).rejects.toThrow(/narrativa rejeitada/)

    expect(consoleSpy).toHaveBeenCalledWith(
      '[publisher] narrativa rejeitada por brand gate',
      expect.objectContaining({
        findingId: 'finding-test-002',
        hits: expect.arrayContaining(['fraude']),
      }),
    )
    expect(publishSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})
