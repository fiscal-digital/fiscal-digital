/**
 * Gate de publicação (thresholds.ts): leitura do SSM, cache com TTL,
 * interruptor por fiscal e o helper `isPublishable`.
 *
 * Primeiro mock de @aws-sdk/client-ssm do repo — thresholds.ts instancia o
 * SSMClient no load do módulo, então o mock precisa vir antes do import.
 */
const mockSsmSend = jest.fn()
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => mockSsmSend(...a) })),
  GetParametersCommand: jest.fn().mockImplementation((input: unknown) => ({ __type: 'GetParameters', input })),
  GetParameterCommand: jest.fn().mockImplementation((input: unknown) => ({ __type: 'GetParameter', input })),
}))

import {
  getPublishThresholds,
  isPublishable,
  parseDisabledFiscais,
  THRESHOLDS_CACHE_TTL_MS,
  _resetThresholdsCacheForTests,
  type PublishThresholds,
} from '../thresholds'

const RISK = '/fiscal-digital/prod/publish-risk-threshold'
const CONF = '/fiscal-digital/prod/publish-confidence-threshold'
const DISABLED = '/fiscal-digital/prod/publish-disabled-fiscais'

function ssmReturns(params: Array<{ Name: string; Value: string }>) {
  mockSsmSend.mockResolvedValue({ Parameters: params })
}

beforeEach(() => {
  jest.clearAllMocks()
  _resetThresholdsCacheForTests()
})

describe('parseDisabledFiscais', () => {
  it('separa por vírgula, apara espaços, descarta vazios e deduplica', () => {
    expect(parseDisabledFiscais('fiscal-pessoal, fiscal-diarias,,fiscal-pessoal ,')).toEqual([
      'fiscal-pessoal',
      'fiscal-diarias',
    ])
  })

  it('sentinela `none` (qualquer caixa) e valores vazios viram lista vazia', () => {
    expect(parseDisabledFiscais('none')).toEqual([])
    expect(parseDisabledFiscais('NONE')).toEqual([])
    expect(parseDisabledFiscais(' none , ')).toEqual([])
    expect(parseDisabledFiscais('')).toEqual([])
    expect(parseDisabledFiscais(undefined)).toEqual([])
    expect(parseDisabledFiscais(null)).toEqual([])
  })

  it('sentinela no meio da lista é ignorada, os demais ficam', () => {
    expect(parseDisabledFiscais('fiscal-publicidade,none')).toEqual(['fiscal-publicidade'])
  })
})

describe('getPublishThresholds', () => {
  it('lê os três parâmetros numa única GetParameters', async () => {
    ssmReturns([
      { Name: RISK, Value: '65' },
      { Name: CONF, Value: '0.75' },
      { Name: DISABLED, Value: 'fiscal-publicidade' },
    ])

    const t = await getPublishThresholds()

    expect(t).toEqual({ riskThreshold: 65, confidenceThreshold: 0.75, disabledFiscais: ['fiscal-publicidade'] })
    expect(mockSsmSend).toHaveBeenCalledTimes(1)
    const cmd = mockSsmSend.mock.calls[0][0] as { __type: string; input: { Names: string[] } }
    expect(cmd.__type).toBe('GetParameters')
    expect(cmd.input.Names).toEqual([RISK, CONF, DISABLED])
  })

  it('sentinela `none` no SSM → nenhum fiscal desligado', async () => {
    ssmReturns([{ Name: DISABLED, Value: 'none' }])
    expect((await getPublishThresholds()).disabledFiscais).toEqual([])
  })

  it('parâmetro de interruptor ausente → lista vazia (fail-safe: continua publicando)', async () => {
    ssmReturns([{ Name: RISK, Value: '60' }, { Name: CONF, Value: '0.70' }])
    expect((await getPublishThresholds()).disabledFiscais).toEqual([])
  })

  it('erro de SSM → defaults e lista vazia, nunca lança', async () => {
    mockSsmSend.mockRejectedValue(new Error('AccessDenied'))
    await expect(getPublishThresholds()).resolves.toEqual({
      riskThreshold: 60,
      confidenceThreshold: 0.70,
      disabledFiscais: [],
    })
  })

  it('valor não numérico no limiar é ignorado e o default fica', async () => {
    ssmReturns([{ Name: RISK, Value: 'sessenta' }])
    expect((await getPublishThresholds()).riskThreshold).toBe(60)
  })

  it('segunda chamada dentro do TTL bate cache (uma só ida ao SSM)', async () => {
    ssmReturns([{ Name: DISABLED, Value: 'fiscal-pessoal' }])
    await getPublishThresholds()
    await getPublishThresholds()
    expect(mockSsmSend).toHaveBeenCalledTimes(1)
  })

  it('TTL expirado → relê o SSM e o flip aparece sem reciclar o container', async () => {
    let t = 1_000_000
    const now = () => t
    ssmReturns([{ Name: DISABLED, Value: 'none' }])
    expect((await getPublishThresholds(now)).disabledFiscais).toEqual([])

    ssmReturns([{ Name: DISABLED, Value: 'fiscal-publicidade' }])
    t += THRESHOLDS_CACHE_TTL_MS - 1
    expect((await getPublishThresholds(now)).disabledFiscais).toEqual([]) // ainda em cache

    t += 2
    expect((await getPublishThresholds(now)).disabledFiscais).toEqual(['fiscal-publicidade'])
    expect(mockSsmSend).toHaveBeenCalledTimes(2)
  })

  it('chamadas concorrentes compartilham a mesma ida ao SSM', async () => {
    ssmReturns([{ Name: RISK, Value: '60' }])
    await Promise.all([getPublishThresholds(), getPublishThresholds(), getPublishThresholds()])
    expect(mockSsmSend).toHaveBeenCalledTimes(1)
  })
})

describe('isPublishable', () => {
  const t: PublishThresholds = { riskThreshold: 60, confidenceThreshold: 0.70, disabledFiscais: ['fiscal-publicidade'] }
  const ok = { fiscalId: 'fiscal-licitacoes', type: 'dispensa_irregular', riskScore: 75, confidence: 0.85 }

  it('passa quando tudo confere', () => {
    expect(isPublishable(ok, t)).toBe(true)
  })

  it('fiscal desligado no interruptor não publica, mesmo acima dos limiares', () => {
    expect(isPublishable({ ...ok, fiscalId: 'fiscal-publicidade', riskScore: 99, confidence: 0.99 }, t)).toBe(false)
  })

  it('limiares: risco e confiança abaixo barram; iguais passam', () => {
    expect(isPublishable({ ...ok, riskScore: 59 }, t)).toBe(false)
    expect(isPublishable({ ...ok, riskScore: 60 }, t)).toBe(true)
    expect(isPublishable({ ...ok, confidence: 0.69 }, t)).toBe(false)
    expect(isPublishable({ ...ok, confidence: 0.70 }, t)).toBe(true)
  })

  it('unpublishable (brand gate) barra', () => {
    expect(isPublishable({ ...ok, unpublishable: true }, t)).toBe(false)
  })

  it('sem `type` (item de memória, não finding) barra', () => {
    expect(isPublishable({ ...ok, type: undefined }, t)).toBe(false)
  })

  it('campos numéricos ausentes contam como zero', () => {
    expect(isPublishable({ fiscalId: 'x', type: 'y' }, t)).toBe(false)
  })

  it('thresholds sem `disabledFiscais` (mock antigo) não quebra', () => {
    const legado = { riskThreshold: 60, confidenceThreshold: 0.70 } as unknown as PublishThresholds
    expect(isPublishable(ok, legado)).toBe(true)
  })
})
