/**
 * EVO-005 — write-path de `fiscal-digital-suppliers-prod`.
 *
 * Nenhum teste toca AWS: `docClient` e `isFeatureEnabled` são mockados
 * (proibido dado sintético em prod — regra "Smoke Tests em Prod").
 */
import { maybeWriteSupplier } from '../maybe_write_supplier'
import { querySuppliersContract } from '../query_suppliers_contract'

jest.mock('../../utils/dynamodb', () => ({
  docClient: { send: jest.fn() },
}))

jest.mock('../../feature-flags', () => ({
  isFeatureEnabled: jest.fn(),
}))

import { docClient } from '../../utils/dynamodb'
import { isFeatureEnabled } from '../../feature-flags'

const mockSend = docClient.send as jest.Mock
const mockFlag = isFeatureEnabled as jest.Mock

// CNPJs com dígito verificador VÁLIDO (o gate filtra por `isValidCNPJ`).
const CNPJ_VALIDO = '11222333000181'
const CNPJ_ALFANUMERICO = '1234ABCD000116' // Lei 14.973/2024

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    cnpj: '11.222.333/0001-81',
    cityId: '4305108',
    contractNumber: '388/2020',
    contractedAt: '2024-03-15',
    valueAmount: 250000,
    secretaria: 'SMOSP',
    ...overrides,
  } as Parameters<typeof maybeWriteSupplier.execute>[0]
}

/** Item do último `PutCommand` enviado. */
function lastPutItem(): Record<string, unknown> {
  const call = mockSend.mock.calls[mockSend.mock.calls.length - 1][0]
  return call.input.Item as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSend.mockResolvedValue({})
  mockFlag.mockResolvedValue(true)
})

describe('maybeWriteSupplier — feature flag (deploy dark)', () => {
  it('flag OFF: no-op silencioso, nenhum PutCommand', async () => {
    mockFlag.mockResolvedValue(false)

    const result = await maybeWriteSupplier.execute(validInput())

    expect(mockSend).not.toHaveBeenCalled()
    expect(result.data.written).toBe(false)
    expect(result.data.skipReason).toBe('feature_flag_off')
    expect(result.data.pk).toBeUndefined()
  })

  it('flag OFF: nem valida o input (não há skip por qualidade antes da flag)', async () => {
    mockFlag.mockResolvedValue(false)

    const result = await maybeWriteSupplier.execute(validInput({ cnpj: 'lixo', valueAmount: -1 }))

    expect(mockSend).not.toHaveBeenCalled()
    expect(result.data.skipReason).toBe('feature_flag_off')
  })

  it('consulta exatamente a flag `enable-supplier-write`', async () => {
    await maybeWriteSupplier.execute(validInput())
    expect(mockFlag).toHaveBeenCalledWith('enable-supplier-write')
  })

  it('flag ON: grava o registro', async () => {
    const result = await maybeWriteSupplier.execute(validInput())

    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(result.data.written).toBe(true)
    expect(result.data.skipReason).toBeNull()
  })
})

describe('maybeWriteSupplier — chaves compostas', () => {
  it('pk = SUPPLIER#{cnpj normalizado}', async () => {
    const result = await maybeWriteSupplier.execute(validInput())

    expect(lastPutItem().pk).toBe(`SUPPLIER#${CNPJ_VALIDO}`)
    expect(result.data.pk).toBe(`SUPPLIER#${CNPJ_VALIDO}`)
  })

  it('sk = {contractedAt}#{contractId}, com contractId default = contractNumber', async () => {
    const result = await maybeWriteSupplier.execute(validInput())

    expect(lastPutItem().sk).toBe('2024-03-15#388/2020')
    expect(lastPutItem().contractId).toBe('388/2020')
    expect(result.data.sk).toBe('2024-03-15#388/2020')
  })

  it('sk respeita contractId explícito quando informado', async () => {
    await maybeWriteSupplier.execute(validInput({ contractId: 'CT-042' }))

    expect(lastPutItem().sk).toBe('2024-03-15#CT-042')
    expect(lastPutItem().contractId).toBe('CT-042')
    expect(lastPutItem().contractNumber).toBe('388/2020')
  })

  it('mesCNPJ = YYYY-MM#CNPJ14 (range key do GSI2_ConcentracaoSecretaria)', async () => {
    await maybeWriteSupplier.execute(validInput())

    expect(lastPutItem().mesCNPJ).toBe(`2024-03#${CNPJ_VALIDO}`)
  })

  it('mesCNPJ usa o CNPJ alfanumérico normalizado (uppercase, sem máscara)', async () => {
    await maybeWriteSupplier.execute(
      validInput({ cnpj: '12.34a.bcd/0001-16', contractedAt: '2026-01-09' }),
    )

    expect(lastPutItem().mesCNPJ).toBe(`2026-01#${CNPJ_ALFANUMERICO}`)
    expect(lastPutItem().pk).toBe(`SUPPLIER#${CNPJ_ALFANUMERICO}`)
  })
})

describe('maybeWriteSupplier — shape esperado pelos leitores', () => {
  it('grava os atributos lidos por querySuppliersContract', async () => {
    await maybeWriteSupplier.execute(
      validInput({ contractType: 'obra_engenharia', sourceFindingId: 'gs-orig-001' }),
    )

    const item = lastPutItem()
    expect(item.cnpj).toBe(CNPJ_VALIDO)
    expect(item.cityId).toBe('4305108')
    expect(item.contractNumber).toBe('388/2020')
    expect(item.contractedAt).toBe('2024-03-15')
    expect(item.valueAmount).toBe(250000)
    expect(item.secretaria).toBe('SMOSP')
    expect(item.contractType).toBe('obra_engenharia')
    expect(item.sourceFindingId).toBe('gs-orig-001')
  })

  it('grava os atributos lidos por queryConcentracaoGSI2 (cnpj14/mesCNPJ/valueAmount/contractedAt)', async () => {
    await maybeWriteSupplier.execute(validInput())

    const item = lastPutItem()
    expect(item.cnpj14).toBe(CNPJ_VALIDO)
    expect(item.mesCNPJ).toBe(`2024-03#${CNPJ_VALIDO}`)
    expect(item.valueAmount).toBe(250000)
    expect(item.contractedAt).toBe('2024-03-15')
  })

  it('grava as GSI keys cityId/contractedAt (GSI1) e secretariaId/mesCNPJ (GSI2)', async () => {
    await maybeWriteSupplier.execute(validInput())

    const item = lastPutItem()
    expect(item.cityId).toBe('4305108')
    expect(item.contractedAt).toBe('2024-03-15')
    expect(item.secretariaId).toBe('SMOSP')
    expect(item.mesCNPJ).toBe(`2024-03#${CNPJ_VALIDO}`)
  })

  it('LRN-20260502-019: opcionais ausentes são omitidos, nunca gravados como null', async () => {
    await maybeWriteSupplier.execute(validInput())

    const item = lastPutItem()
    expect('contractType' in item).toBe(false)
    expect('sourceFindingId' in item).toBe(false)
  })

  it('usa a tabela suppliers-prod por default e respeita o override', async () => {
    await maybeWriteSupplier.execute(validInput())
    expect(mockSend.mock.calls[0][0].input.TableName).toBe('fiscal-digital-suppliers-prod')

    await maybeWriteSupplier.execute(validInput({ table: 'fiscal-digital-suppliers-staging' }))
    expect(mockSend.mock.calls[1][0].input.TableName).toBe('fiscal-digital-suppliers-staging')
  })
})

describe('maybeWriteSupplier — normalização de CNPJ idêntica à do leitor', () => {
  it.each([
    ['11.222.333/0001-81', `SUPPLIER#${CNPJ_VALIDO}`],
    ['11222333000181', `SUPPLIER#${CNPJ_VALIDO}`],
    ['12.34a.bcd/0001-16', `SUPPLIER#${CNPJ_ALFANUMERICO}`],
  ])('write(%s) e read(%s) produzem a mesma pk', async (raw, expectedPk) => {
    // write
    await maybeWriteSupplier.execute(validInput({ cnpj: raw }))
    const writtenPk = lastPutItem().pk

    // read — mesma entrada crua
    mockSend.mockResolvedValueOnce({ Items: [] })
    await querySuppliersContract.execute({
      cnpj: raw,
      cityId: '4305108',
      contractNumber: '388/2020',
    })
    const queriedPk = mockSend.mock.calls[mockSend.mock.calls.length - 1][0]
      .input.ExpressionAttributeValues[':pk']

    expect(writtenPk).toBe(expectedPk)
    expect(queriedPk).toBe(expectedPk)
    expect(writtenPk).toBe(queriedPk)
  })

  it('contractNumber é trimado dos dois lados (write e read usam .trim())', async () => {
    await maybeWriteSupplier.execute(validInput({ contractNumber: '  388/2020  ' }))

    expect(lastPutItem().contractNumber).toBe('388/2020')
    expect(lastPutItem().sk).toBe('2024-03-15#388/2020')
  })
})

describe('maybeWriteSupplier — gate de qualidade de dado', () => {
  async function expectSkip(overrides: Record<string, unknown>, reason: string) {
    const result = await maybeWriteSupplier.execute(validInput(overrides))
    expect(mockSend).not.toHaveBeenCalled()
    expect(result.data.written).toBe(false)
    expect(result.data.skipReason).toBe(reason)
  }

  it('rejeita CNPJ com dígito verificador inválido', async () => {
    await expectSkip({ cnpj: '11.222.333/0001-99' }, 'cnpj_invalido')
  })

  it('rejeita CNPJ com comprimento != 14 após normalização', async () => {
    await expectSkip({ cnpj: '1122233300018' }, 'cnpj_invalido')
  })

  it('rejeita CNPJ com espaço (normalização do leitor não remove espaço)', async () => {
    // Aceitar aqui geraria uma pk que o leitor jamais consulta.
    await expectSkip({ cnpj: '11.222.333/0001 81' }, 'cnpj_invalido')
  })

  it('rejeita CNPJ vazio', async () => {
    await expectSkip({ cnpj: '' }, 'cnpj_invalido')
  })

  it('rejeita cityId vazio (hash key do GSI1-city-date)', async () => {
    await expectSkip({ cityId: '   ' }, 'city_ausente')
  })

  it('rejeita contractNumber ausente', async () => {
    await expectSkip({ contractNumber: '  ' }, 'contract_number_ausente')
  })

  it.each([
    ['15/03/2024'],
    ['2024-3-15'],
    ['2024-02-31'],
    ['2024-13-01'],
    ['2024-03-15T10:00:00Z'],
    [''],
  ])('rejeita contractedAt não parseável: %s', async date => {
    await expectSkip({ contractedAt: date }, 'contracted_at_invalido')
  })

  it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'rejeita valueAmount inválido: %s',
    async value => {
      await expectSkip({ valueAmount: value }, 'value_amount_invalido')
    },
  )

  it('rejeita valueAmount que não é number (string vinda de extração)', async () => {
    await expectSkip({ valueAmount: '250000' }, 'value_amount_invalido')
  })

  it('rejeita secretaria vazia (hash key do GSI2 — quebraria a concentração)', async () => {
    await expectSkip({ secretaria: '   ' }, 'secretaria_ausente')
  })

  it('aceita o registro completo (contraprova do gate)', async () => {
    const result = await maybeWriteSupplier.execute(validInput())
    expect(result.data.written).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})

describe('maybeWriteSupplier — idempotência', () => {
  it('mesma entrada duas vezes: mesma pk+sk (PutCommand sobrescreve, não duplica)', async () => {
    await maybeWriteSupplier.execute(validInput())
    const first = lastPutItem()

    await maybeWriteSupplier.execute(validInput())
    const second = lastPutItem()

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(second.pk).toBe(first.pk)
    expect(second.sk).toBe(first.sk)
    expect(second).toEqual(first)
  })

  it('chave não depende de relógio: reanálise em outro dia gera o mesmo sk', async () => {
    await maybeWriteSupplier.execute(validInput())
    const first = lastPutItem()

    jest.useFakeTimers().setSystemTime(new Date('2027-01-01T00:00:00Z'))
    await maybeWriteSupplier.execute(validInput())
    const second = lastPutItem()
    jest.useRealTimers()

    expect(second.sk).toBe(first.sk)
    expect(second).toEqual(first)
  })

  it('contratos distintos do mesmo CNPJ geram sks distintos (não colidem)', async () => {
    await maybeWriteSupplier.execute(validInput())
    const first = lastPutItem()

    await maybeWriteSupplier.execute(
      validInput({ contractNumber: '500/2021', contractedAt: '2025-06-01' }),
    )
    const second = lastPutItem()

    expect(second.pk).toBe(first.pk)
    expect(second.sk).not.toBe(first.sk)
    expect(second.sk).toBe('2025-06-01#500/2021')
  })
})
