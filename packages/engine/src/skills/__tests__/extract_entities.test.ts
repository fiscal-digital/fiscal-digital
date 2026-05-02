import { extractEntities } from '../extract_entities'

jest.mock('../../utils/bedrock', () => ({
  invokeModel: jest.fn(),
  EXTRACTION_MODEL: 'amazon.nova-lite-v1:0',
  NARRATIVE_MODEL: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
}))

jest.mock('../../regex', () => ({
  extractAll: jest.fn().mockReturnValue({
    cnpjs: ['12.345.678/0001-90'],
    values: [80000],
    dates: ['2026-01-15'],
    contractNumbers: ['2026/001'],
  }),
}))

import { invokeModel, EXTRACTION_MODEL } from '../../utils/bedrock'

const mockInvokeModel = invokeModel as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('extractEntities', () => {
  it('extrai CNPJ, valor e tipo do ato retornados pelo LLM', async () => {
    mockInvokeModel.mockResolvedValue(
      JSON.stringify({
        secretaria: 'Secretaria de Obras',
        actType: 'dispensa',
        supplier: 'Construtora ABC LTDA',
        legalBasis: 'Lei 14.133/2021, Art. 75, I',
        subtype: 'obra_engenharia',
        valorOriginalContrato: null,
      })
    )

    const result = await extractEntities.execute({
      text: 'Dispensa de licitação para obra de pavimentação R$ 80.000,00 CNPJ 12.345.678/0001-90',
      gazetteUrl: 'https://queridodiario.ok.org.br/gazettes/123',
    })

    expect(result.data.actType).toBe('dispensa')
    expect(result.data.supplier).toBe('Construtora ABC LTDA')
    expect(result.data.cnpjs).toContain('12.345.678/0001-90')
    expect(result.data.values).toContain(80000)
    expect(result.confidence).toBe(0.85)
    expect(result.source).toBe('https://queridodiario.ok.org.br/gazettes/123')
  })

  it('extrai campo subtype retornado pelo LLM (obra_engenharia/servico/compra)', async () => {
    mockInvokeModel.mockResolvedValue(
      JSON.stringify({
        secretaria: 'Secretaria de Saúde',
        actType: 'dispensa',
        supplier: 'Tech Solutions LTDA',
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
        subtype: 'servico',
        valorOriginalContrato: null,
      })
    )

    const result = await extractEntities.execute({
      text: 'Dispensa de licitação para serviços de consultoria R$ 50.000,00',
      gazetteUrl: 'https://queridodiario.ok.org.br/gazettes/456',
    })

    expect(result.data.subtype).toBe('servico')
  })

  it('extrai campo valorOriginalContrato de aditivo que cita valor original', async () => {
    mockInvokeModel.mockResolvedValue(
      JSON.stringify({
        secretaria: 'Secretaria de Infraestrutura',
        actType: 'aditivo',
        supplier: 'Obras Rápidas LTDA',
        legalBasis: 'Lei 14.133/2021, Art. 125',
        subtype: 'obra_engenharia',
        valorOriginalContrato: 200000,
      })
    )

    const result = await extractEntities.execute({
      text: 'Aditivo contratual. Valor original do contrato de R$ 200.000,00.',
      gazetteUrl: 'https://queridodiario.ok.org.br/gazettes/789',
    })

    expect(result.data.valorOriginalContrato).toBe(200000)
    expect(result.data.actType).toBe('aditivo')
  })

  it('retorna subtype null quando LLM omite ou retorna null', async () => {
    mockInvokeModel.mockResolvedValue(
      JSON.stringify({
        secretaria: 'Secretaria de Educação',
        actType: 'contrato',
        supplier: 'Editora Municipal LTDA',
        legalBasis: null,
        subtype: null,
        valorOriginalContrato: null,
      })
    )

    const result = await extractEntities.execute({
      text: 'Contrato para fornecimento de materiais escolares.',
      gazetteUrl: 'https://queridodiario.ok.org.br/gazettes/101',
    })

    expect(result.data.subtype).toBeNull()
    expect(result.data.valorOriginalContrato).toBeUndefined()
  })

  it('chama invokeModel com o modelo de extração correto (Nova Lite via Bedrock)', async () => {
    mockInvokeModel.mockResolvedValue('{}')

    await extractEntities.execute({
      text: 'Texto de teste',
      gazetteUrl: 'https://queridodiario.ok.org.br/gazettes/999',
    })

    expect(mockInvokeModel).toHaveBeenCalledTimes(1)
    const callArgs = mockInvokeModel.mock.calls[0][0]
    expect(callArgs.modelId).toBe(EXTRACTION_MODEL)
    expect(typeof callArgs.systemPrompt).toBe('string')
    expect(callArgs.systemPrompt.length).toBeGreaterThan(0)
  })

  it('continua funcional quando LLM retorna JSON malformado (fallback regex)', async () => {
    mockInvokeModel.mockResolvedValue('resposta inválida não-JSON')

    const result = await extractEntities.execute({
      text: 'Texto qualquer com CNPJ 12.345.678/0001-90',
      gazetteUrl: 'https://queridodiario.ok.org.br/gazettes/malformed',
    })

    expect(result.data.cnpjs).toEqual(['12.345.678/0001-90'])
    expect(result.confidence).toBe(0.85)
  })
})
