import { Logger } from '@aws-lambda-powertools/logger'
import { checkSanctions, _resetCheckSanctionsWarnForTests } from '../check_sanctions'

const mockFetch = jest.fn()
global.fetch = mockFetch

const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

const FUTURE_DATE = '2099-12-31'
const PAST_DATE = '2020-01-01'

beforeEach(() => {
  jest.clearAllMocks()
  _resetCheckSanctionsWarnForTests()
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

  it('apiKey ausente: avisa UMA vez por container (não por CNPJ) que sanções não são verificadas', async () => {
    await checkSanctions.execute({ cnpj: '12.345.678/0001-90' })
    await checkSanctions.execute({ cnpj: '98.765.432/0001-00' })
    await checkSanctions.execute({ cnpj: '11.222.333/0001-44' })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('sem apiKey')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('registros CEIS ativos (sem endDate) resultam em sanctioned true', async () => {
    mockFetch
      .mockReturnValueOnce(
        makeJsonResponse([
          { sancionado: { codigoFormatado: '12.345.678/0001-90' }, tipoSancao: 'Impedimento de Licitar', dataInicioSancao: '2023-01-01', dataFimSancao: undefined, orgaoSancionador: 'TCE-RS' },
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
          { sancionado: { codigoFormatado: '12.345.678/0001-90' }, tipoSancao: 'Suspensão', dataInicioSancao: '2024-01-01', dataFimSancao: FUTURE_DATE, orgaoSancionador: 'CGU' },
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
          { sancionado: { codigoFormatado: '12.345.678/0001-90' }, tipoSancao: 'Multa', dataInicioSancao: '2019-01-01', dataFimSancao: PAST_DATE, orgaoSancionador: 'CGU' },
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
          { sancionado: { codigoFormatado: '12.345.678/0001-90' }, tipoSancao: 'Inabilitação', dataInicioSancao: '2024-06-01', dataFimSancao: FUTURE_DATE, orgaoSancionador: 'TCU' },
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

  it('envia User-Agent header nas chamadas HTTP (previne 403 WAF — LRN-20260606-002)', async () => {
    mockFetch
      .mockReturnValueOnce(makeJsonResponse([]))
      .mockReturnValueOnce(makeJsonResponse([]))

    await checkSanctions.execute({ cnpj: '12.345.678/0001-90', apiKey: 'test-api-key' })

    const calledHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>
    expect(calledHeaders['User-Agent']).toMatch(/^FiscalDigital\//)
    expect(calledHeaders['User-Agent']).toContain('fiscaldigital.org')
  })

  it('EVO-024: CNPJ alfanumérico tem letras preservadas na query (não removidas como /\\D/g removeria)', async () => {
    mockFetch
      .mockReturnValueOnce(makeJsonResponse([]))
      .mockReturnValueOnce(makeJsonResponse([]))

    await checkSanctions.execute({ cnpj: '12.34A.BCD/0001-16', apiKey: 'test-api-key' })

    const ceisUrl: string = mockFetch.mock.calls[0][0]
    const cnepUrl: string = mockFetch.mock.calls[1][0]
    expect(ceisUrl).toContain('codigoSancionado=1234ABCD000116')
    expect(cnepUrl).toContain('codigoSancionado=1234ABCD000116')
  })

  // Regressão fiscal-digital#243 (03/10/2026): a API do Portal ignorava
  // `cnpjSancionado` e devolvia a primeira página do cadastro inteiro — todo
  // CNPJ consultado virava "sancionado".
  it('#243: usa codigoSancionado, não cnpjSancionado', async () => {
    mockFetch.mockReturnValueOnce(makeJsonResponse([])).mockReturnValueOnce(makeJsonResponse([]))
    await checkSanctions.execute({ cnpj: '12.345.678/0001-90', apiKey: 'k' })
    expect(String(mockFetch.mock.calls[0][0])).toContain('/ceis?codigoSancionado=12345678000190&')
    expect(String(mockFetch.mock.calls[1][0])).toContain('/cnep?codigoSancionado=12345678000190&')
    expect(String(mockFetch.mock.calls[0][0])).not.toContain('cnpjSancionado')
  })

  it('#243: página do cadastro inteiro (sancionados de terceiros) → sanctioned false, zero records', async () => {
    const pagina = [
      { sancionado: { nome: 'ELZA', codigoFormatado: '974.243.236-87' }, tipoSancao: { descricaoResumida: 'Improbidade' }, dataFimSancao: FUTURE_DATE },
      { sancionado: { nome: 'OUTRA LTDA', codigoFormatado: '72.810.211/0001-09' }, tipoSancao: { descricaoResumida: 'Impedimento' }, dataFimSancao: FUTURE_DATE },
      { tipoSancao: 'Registro sem sancionado', dataFimSancao: FUTURE_DATE },
    ]
    mockFetch.mockReturnValueOnce(makeJsonResponse(pagina)).mockReturnValueOnce(makeJsonResponse(pagina))
    const result = await checkSanctions.execute({ cnpj: '56.220.963/0001-55', apiKey: 'k' })
    expect(result.data.sanctioned).toBe(false)
    expect(result.data.records).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OUTRO sancionado'), expect.objectContaining({ descartados: 6 }))
  })

  it('#243: registro do próprio CNPJ com campos em objeto (shape atual da API) é aceito e normalizado', async () => {
    mockFetch
      .mockReturnValueOnce(makeJsonResponse([{
        sancionado: { nome: 'EMPRESA X', codigoFormatado: '72.810.211/0001-09' },
        tipoSancao: { descricaoResumida: 'Impedimento/proibição de contratar com prazo determinado' },
        orgaoSancionador: { nome: 'PROCURADORIA GERAL DO ESTADO', siglaUf: 'SP' },
        dataInicioSancao: '2026-04-10',
        dataFimSancao: FUTURE_DATE,
      }]))
      .mockReturnValueOnce(makeJsonResponse([]))
    const result = await checkSanctions.execute({ cnpj: '72810211000109', apiKey: 'k' })
    expect(result.data.sanctioned).toBe(true)
    expect(result.data.records).toEqual([{
      type: 'CEIS',
      sanction: 'Impedimento/proibição de contratar com prazo determinado',
      organ: 'PROCURADORIA GERAL DO ESTADO',
      startDate: '2026-04-10',
      endDate: FUTURE_DATE,
    }])
  })
})
