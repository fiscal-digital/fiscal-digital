import { querySuppliersContract } from '../query_suppliers_contract'

jest.mock('../../utils/dynamodb', () => ({
  docClient: {
    send: jest.fn(),
  },
}))

import { docClient } from '../../utils/dynamodb'

const mockSend = (docClient.send as jest.Mock)

beforeEach(() => {
  jest.clearAllMocks()
})

describe('querySuppliersContract', () => {
  function makeItem(overrides: Record<string, unknown> = {}) {
    return {
      pk: 'SUPPLIER#12345678000190',
      sk: '2024-03-15#388/2020',
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
      contractedAt: '2024-03-15',
      valueAmount: 250000,
      secretaria: 'SMOSP',
      contractType: 'obra_engenharia',
      sourceFindingId: 'gs-orig-001',
      ...overrides,
    }
  }

  it('encontra contrato original e retorna valueAmount', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeItem()],
    })

    const result = await querySuppliersContract.execute({
      cnpj: '12.345.678/0001-90',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    expect(result.data).not.toBeNull()
    expect(result.data?.valueAmount).toBe(250000)
    expect(result.data?.contractedAt).toBe('2024-03-15')
    expect(result.data?.cnpj).toBe('12345678000190') // normalizado
    expect(result.confidence).toBe(1.0)
  })

  it('normaliza CNPJ com pontuação para query', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })

    await querySuppliersContract.execute({
      cnpj: '12.345.678/0001-90',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    const call = mockSend.mock.calls[0][0]
    expect(call.input.ExpressionAttributeValues[':pk']).toBe('SUPPLIER#12345678000190')
  })

  it('retorna null quando contractNumber não bate (mesmo CNPJ tem outros contratos)', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeItem({ contractNumber: '999/2021' }),
        makeItem({ contractNumber: '500/2019' }),
      ],
    })

    const result = await querySuppliersContract.execute({
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    expect(result.data).toBeNull()
  })

  it('retorna null quando cityId não bate (mesmo CNPJ tem contratos em outra cidade)', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeItem({ cityId: '3550308' })], // São Paulo, não Caxias
    })

    const result = await querySuppliersContract.execute({
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    expect(result.data).toBeNull()
  })

  it('retorna null quando valueAmount é zero ou inválido', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeItem({ valueAmount: 0 })],
    })

    const result = await querySuppliersContract.execute({
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    expect(result.data).toBeNull()
    expect(result.confidence).toBe(0.5)
  })

  it('retorna null quando Items é vazio (CNPJ sem histórico)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })

    const result = await querySuppliersContract.execute({
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    expect(result.data).toBeNull()
    expect(result.confidence).toBe(1.0)
  })

  it('respeita table override (para testes ou ambientes alternativos)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })

    await querySuppliersContract.execute({
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
      table: 'fiscal-digital-suppliers-staging',
    })

    const call = mockSend.mock.calls[0][0]
    expect(call.input.TableName).toBe('fiscal-digital-suppliers-staging')
  })

  it('inclui ScanIndexForward=false para ordenar do mais recente', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] })

    await querySuppliersContract.execute({
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    const call = mockSend.mock.calls[0][0]
    expect(call.input.ScanIndexForward).toBe(false)
  })

  it('omite campos opcionais (secretaria/contractType/sourceFindingId) quando ausentes', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeItem({ secretaria: undefined, contractType: undefined, sourceFindingId: undefined })],
    })

    const result = await querySuppliersContract.execute({
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '388/2020',
    })

    expect(result.data).not.toBeNull()
    expect(result.data?.secretaria).toBeUndefined()
    expect(result.data?.contractType).toBeUndefined()
    expect(result.data?.sourceFindingId).toBeUndefined()
  })
})
