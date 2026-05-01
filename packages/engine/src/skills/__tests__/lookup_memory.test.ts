import { lookupMemory } from '../lookup_memory'

jest.mock('../../utils/dynamodb', () => ({
  getItem: jest.fn(),
  putItem: jest.fn(),
  queryIndex: jest.fn(),
  docClient: {},
}))

import { getItem } from '../../utils/dynamodb'

const mockGetItem = getItem as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('lookupMemory', () => {
  it('busca por PK e retorna o item encontrado', async () => {
    const item = { pk: 'CNPJ#12345678000190', razaoSocial: 'Empresa Teste LTDA', situacaoCadastral: 'ativa' }
    mockGetItem.mockResolvedValue(item)

    const result = await lookupMemory.execute({
      pk: 'CNPJ#12345678000190',
      table: 'fiscal-digital-suppliers-prod',
    })

    expect(mockGetItem).toHaveBeenCalledWith('fiscal-digital-suppliers-prod', 'CNPJ#12345678000190')
    expect(result.data).toEqual(item)
    expect(result.confidence).toBe(1.0)
    expect(result.source).toBe('dynamodb:fiscal-digital-suppliers-prod#CNPJ#12345678000190')
  })

  it('item ausente retorna null como data', async () => {
    mockGetItem.mockResolvedValue(null)

    const result = await lookupMemory.execute({
      pk: 'CNPJ#00000000000000',
      table: 'fiscal-digital-suppliers-prod',
    })

    expect(result.data).toBeNull()
    expect(result.confidence).toBe(1.0)
    expect(result.source).toContain('CNPJ#00000000000000')
  })

  it('erro AWS é propagado', async () => {
    mockGetItem.mockRejectedValue(new Error('DynamoDB service unavailable'))

    await expect(
      lookupMemory.execute({
        pk: 'CNPJ#erro',
        table: 'fiscal-digital-suppliers-prod',
      }),
    ).rejects.toThrow('DynamoDB service unavailable')
  })

  it('source reflete table e pk utilizados na busca', async () => {
    mockGetItem.mockResolvedValue({ pk: 'ALERT#abc' })

    const result = await lookupMemory.execute({
      pk: 'ALERT#abc',
      table: 'fiscal-digital-alerts-prod',
    })

    expect(result.source).toBe('dynamodb:fiscal-digital-alerts-prod#ALERT#abc')
  })
})
