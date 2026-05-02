import { generateNarrative } from '../generate_narrative'
import type { Finding } from '../../types'

jest.mock('../../utils/bedrock', () => ({
  invokeModel: jest.fn(),
  EXTRACTION_MODEL: 'amazon.nova-lite-v1:0',
  NARRATIVE_MODEL: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
}))

import { invokeModel, NARRATIVE_MODEL } from '../../utils/bedrock'

const mockInvokeModel = invokeModel as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    fiscalId: 'fiscal-licitacoes',
    cityId: '4305108',
    type: 'dispensa_irregular',
    riskScore: 75,
    confidence: 0.85,
    evidence: [
      {
        source: 'https://queridodiario.ok.org.br/gazettes/123',
        excerpt: 'Dispensa de licitação no valor de R$ 80.000,00',
        date: '2026-03-15',
      },
    ],
    narrative: '',
    legalBasis: 'Lei 14.133/2021, Art. 75, II',
    cnpj: '12.345.678/0001-90',
    secretaria: 'Secretaria de Administração',
    value: 80000,
    ...overrides,
  }
}

describe('generateNarrative', () => {
  it('riskScore < 60 retorna string vazia e confidence 0 SEM chamar o LLM', async () => {
    const finding = makeFinding({ riskScore: 59 })
    const result = await generateNarrative.execute({ finding })

    expect(result.data).toBe('')
    expect(result.confidence).toBe(0)
    expect(mockInvokeModel).not.toHaveBeenCalled()
  })

  it('riskScore exatamente 59 não chama LLM', async () => {
    const finding = makeFinding({ riskScore: 59 })
    await generateNarrative.execute({ finding })

    expect(mockInvokeModel).not.toHaveBeenCalled()
  })

  it('riskScore >= 60 chama LLM e retorna o texto da resposta', async () => {
    mockInvokeModel.mockResolvedValue(
      'Identificamos dispensa de licitação no valor de R$ 80.000,00 pela Secretaria de Administração, acima do teto legal.'
    )

    const finding = makeFinding({ riskScore: 75 })
    const result = await generateNarrative.execute({ finding })

    expect(mockInvokeModel).toHaveBeenCalledTimes(1)
    expect(result.data).toContain('Identificamos')
    expect(result.confidence).toBe(0.9)
  })

  it('riskScore exatamente 60 chama LLM (threshold inclusivo)', async () => {
    mockInvokeModel.mockResolvedValue('O documento aponta dispensa acima do limite legal.')

    const finding = makeFinding({ riskScore: 60 })
    const result = await generateNarrative.execute({ finding })

    expect(mockInvokeModel).toHaveBeenCalledTimes(1)
    expect(result.data).toBe('O documento aponta dispensa acima do limite legal.')
  })

  it('chama invokeModel com o modelo de narrativa correto (Haiku 4.5 via Bedrock)', async () => {
    mockInvokeModel.mockResolvedValue('Narrativa de teste.')

    const finding = makeFinding({ riskScore: 80 })
    await generateNarrative.execute({ finding })

    expect(mockInvokeModel).toHaveBeenCalledTimes(1)
    const callArgs = mockInvokeModel.mock.calls[0][0]
    expect(callArgs.modelId).toBe(NARRATIVE_MODEL)
    expect(typeof callArgs.systemPrompt).toBe('string')
  })

  it('retorna source como URL do primeiro evidence', async () => {
    mockInvokeModel.mockResolvedValue('Os dados indicam irregularidade.')

    const finding = makeFinding({ riskScore: 70 })
    const result = await generateNarrative.execute({ finding })

    expect(result.source).toBe('https://queridodiario.ok.org.br/gazettes/123')
  })
})
