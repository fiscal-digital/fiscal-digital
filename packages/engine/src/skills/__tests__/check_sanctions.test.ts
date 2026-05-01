import { checkSanctions } from '../check_sanctions'

const mockFetch = jest.fn()
global.fetch = mockFetch

const TODAY = new Date().toISOString().split('T')[0]
const FUTURE_DATE = '2099-12-31'
const PAST_DATE = '2020-01-01'

beforeEach(() => {
  jest.clearAllMocks()
})

function makeJsonResponse(data: object, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => data,
  } as Response)
}

describe('checkSanctions', () => {
  it('apiKey ausente retorna sanctioned false e confidence 0 SEM chamar fetch', async () => {
    const result = await checkSanctions.execute({ cnpj: '12.345.678/0001-90' })

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.data.sanctioned).toBe(false)
    expect(result.confidence).toBe(0.0)
    expect(result.data.records).toHaveLength(0)
  })

  it('registros CEIS ativos (sem endDate) resultam em sanctioned true', async () => {
    mockFetch
      .mockReturnValueOnce(
        makeJsonResponse([
          { tipoSancao: 'Impedimento de Licitar', dataInicioSancao: '2023-01-01', dataFimSancao: undefined, orgaoSancionador: 'TCE-RS' },
        ]),
      )
      .mockReturnValueOnce(makeJsonResponse([]))

    const result = await checkSanctions.execute({
      cnpj: '12.345.678/0001-90',
      apiKey: 'test-api-key',
    })

    expect(result.data.sanctioned).toBe(true)
    expect(result.data.records).toHaveLength(1)
    expect(result.data.records[0].type).toBe('CEIS')
    expect(result.confidence).toBe(0.95)
  })

  it('registros com endDate futura resultam em sanctioned true (sanção ainda vigente)', async () => {
    mockFetch
      .mockReturnValueOnce(
        makeJsonResponse([
          { tipoSancao: 'Suspensão', dataInicioSancao: '2024-01-01', dataFimSancao: FUTURE_DATE, orgaoSancionador: 'CGU' },
        ]),
      )
      .mockReturnValueOnce(makeJsonResponse([]))

    const result = await checkSanctions.execute({
      cnpj: '12.345.678/0001-90',
      apiKey: 'test-api-key',
    })

    expect(result.data.sanctioned).toBe(true)
  })

  it('apenas registros expirados (endDate no passado) → sanctioned false', async () => {
    mockFetch
      .mockReturnValueOnce(
        makeJsonResponse([
          { tipoSancao: 'Multa', dataInicioSancao: '2019-01-01', dataFimSancao: PAST_DATE, orgaoSancionador: 'CGU' },
        ]),
      )
      .mockReturnValueOnce(makeJsonResponse([]))

    const result = await checkSanctions.execute({
      cnpj: '12.345.678/0001-90',
      apiKey: 'test-api-key',
    })

    expect(result.data.sanctioned).toBe(false)
    // Records ainda presentes, mas todos expirados
    expect(result.data.records).toHaveLength(1)
  })

  it('CEIS falha mas CNEP retorna dados — coleta apenas CNEP (Promise.allSettled)', async () => {
    mockFetch
      .mockReturnValueOnce(Promise.reject(new Error('CEIS timeout')))
      .mockReturnValueOnce(
        makeJsonResponse([
          { tipoSancao: 'Inabilitação', dataInicioSancao: '2024-06-01', dataFimSancao: FUTURE_DATE, orgaoSancionador: 'TCU' },
        ]),
      )

    const result = await checkSanctions.execute({
      cnpj: '12.345.678/0001-90',
      apiKey: 'test-api-key',
    })

    // Não deve lançar — Promise.allSettled absorve a falha do CEIS
    expect(result.data.records).toHaveLength(1)
    expect(result.data.records[0].type).toBe('CNEP')
    expect(result.data.sanctioned).toBe(true)
  })

  it('sem registros em ambas as fontes → sanctioned false', async () => {
    mockFetch
      .mockReturnValueOnce(makeJsonResponse([]))
      .mockReturnValueOnce(makeJsonResponse([]))

    const result = await checkSanctions.execute({
      cnpj: '12.345.678/0001-90',
      apiKey: 'test-api-key',
    })

    expect(result.data.sanctioned).toBe(false)
    expect(result.data.records).toHaveLength(0)
  })
})
