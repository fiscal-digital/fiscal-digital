import { validateCNPJ } from '../validate_cnpj'

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => {
  jest.clearAllMocks()
})

function makeOkResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response)
}

function makeErrorResponse(status: number, statusText: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  } as Response)
}

describe('validateCNPJ', () => {
  it('status 200: mapeia situacaoCadastral 2 para "ativa" e retorna razaoSocial', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '12345678000190',
        razao_social: 'Empresa Teste LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2010-05-20',
        qsa: [{ nome_socio: 'João Silva' }],
      }),
    )

    const result = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    expect(result.data.razaoSocial).toBe('Empresa Teste LTDA')
    expect(result.data.situacaoCadastral).toBe('ativa')
    expect(result.data.dataAbertura).toBe('2010-05-20')
    expect(result.data.socios).toEqual(['João Silva'])
    expect(result.confidence).toBe(1.0)
  })

  it('status 200: mapeia situacaoCadastral 8 para "baixada"', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '98765432000100',
        razao_social: 'Empresa Baixada LTDA',
        situacao_cadastral: 8,
        data_inicio_atividade: '2005-01-01',
        qsa: [],
      }),
    )

    const result = await validateCNPJ.execute({ cnpj: '98.765.432/0001-00' })
    expect(result.data.situacaoCadastral).toBe('baixada')
  })

  it('status 404: retorna nao_encontrado SEM lançar erro', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(404, 'Not Found'))

    const result = await validateCNPJ.execute({ cnpj: '00.000.000/0001-00' })

    expect(result.data.situacaoCadastral).toBe('nao_encontrado')
    expect(result.confidence).toBe(0.9)
    // Não deve ter lançado exceção — chegamos aqui
  })

  it('status 500: lança erro', async () => {
    mockFetch.mockReturnValue(makeErrorResponse(500, 'Internal Server Error'))

    await expect(
      validateCNPJ.execute({ cnpj: '12.345.678/0001-90' }),
    ).rejects.toThrow('BrasilAPI CNPJ 500')
  })

  it('CNPJ com pontuação é limpo antes da chamada (verifica URL no mock)', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '12345678000190',
        razao_social: 'Empresa Limpa LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2015-03-10',
        qsa: [],
      }),
    )

    await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })

    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain('12345678000190')
    // Verifica que o CNPJ na URL está sem pontuação (apenas dígitos no path final)
    const cnpjInPath = calledUrl.split('/').pop()
    expect(cnpjInPath).toBe('12345678000190')
  })

  it('retorna sanctions false (preenchido por check_sanctions)', async () => {
    mockFetch.mockReturnValue(
      makeOkResponse({
        cnpj: '12345678000190',
        razao_social: 'Empresa OK LTDA',
        situacao_cadastral: 2,
        data_inicio_atividade: '2018-07-01',
        qsa: [],
      }),
    )

    const result = await validateCNPJ.execute({ cnpj: '12.345.678/0001-90' })
    expect(result.data.sanctions).toBe(false)
  })
})
