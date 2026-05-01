import { saveMemory } from '../save_memory'

jest.mock('../../utils/dynamodb', () => ({
  getItem: jest.fn(),
  putItem: jest.fn(),
  queryIndex: jest.fn(),
  docClient: {},
}))

import { putItem } from '../../utils/dynamodb'

const mockPutItem = putItem as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('saveMemory', () => {
  it('chama putItem com PK e item mesclados corretamente', async () => {
    mockPutItem.mockResolvedValue(undefined)

    await saveMemory.execute({
      pk: 'CNPJ#12345678000190',
      table: 'fiscal-digital-suppliers-prod',
      item: { razaoSocial: 'Empresa Teste LTDA', situacaoCadastral: 'ativa' },
    })

    expect(mockPutItem).toHaveBeenCalledWith(
      'fiscal-digital-suppliers-prod',
      {
        pk: 'CNPJ#12345678000190',
        razaoSocial: 'Empresa Teste LTDA',
        situacaoCadastral: 'ativa',
      },
    )
  })

  it('retorna source com table e pk e confidence 1.0', async () => {
    mockPutItem.mockResolvedValue(undefined)

    const result = await saveMemory.execute({
      pk: 'ALERT#finding-001',
      table: 'fiscal-digital-alerts-prod',
      item: { riskScore: 80, narrative: 'Os dados indicam irregularidade.' },
    })

    expect(result.source).toBe('dynamodb:fiscal-digital-alerts-prod#ALERT#finding-001')
    expect(result.confidence).toBe(1.0)
    expect(result.data).toBeUndefined()
  })

  it('salva item de alerta com todos os campos', async () => {
    mockPutItem.mockResolvedValue(undefined)

    const item = {
      type: 'dispensa_irregular',
      riskScore: 75,
      cityId: '4305108',
      legalBasis: 'Lei 14.133/2021, Art. 75, II',
      createdAt: '2026-03-15T10:00:00.000Z',
    }

    await saveMemory.execute({
      pk: 'ALERT#dispensa-001',
      table: 'fiscal-digital-alerts-prod',
      item,
    })

    const [tableName, savedItem] = mockPutItem.mock.calls[0]
    expect(tableName).toBe('fiscal-digital-alerts-prod')
    expect(savedItem.pk).toBe('ALERT#dispensa-001')
    expect(savedItem.type).toBe('dispensa_irregular')
    expect(savedItem.riskScore).toBe(75)
  })

  it('erro AWS é propagado', async () => {
    mockPutItem.mockRejectedValue(new Error('DynamoDB throughput exceeded'))

    await expect(
      saveMemory.execute({
        pk: 'ALERT#erro',
        table: 'fiscal-digital-alerts-prod',
        item: { riskScore: 70 },
      }),
    ).rejects.toThrow('DynamoDB throughput exceeded')
  })
})
