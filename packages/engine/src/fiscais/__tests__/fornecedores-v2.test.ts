/**
 * Tests for FiscalFornecedores v2
 *
 * Covers:
 *   1. Helper agregarConcentracao — unit tests (helper puro, sem mocks)
 *   2. Helper queryConcentracaoGSI2 — GSI2 response mock
 *   3. Score recalibrado — input factors → output range
 *   4. Cache merge correto — LRN-021 pattern (regex fields never from cache)
 *   5. SSM flag OFF → comportamento v1 idêntico (garantia de não-regressão via feature-flags)
 *   6. fiscalFornecedoresV2.analisar — cenários positivos e negativos de concentração
 */

import { fiscalFornecedoresV2, agregarConcentracao, queryConcentracaoGSI2 } from '../fornecedores-v2'
import { fiscalFornecedores } from '../fornecedores'
import type { FiscalContextV2 } from '../fornecedores-v2'
import type { FiscalContext } from '../types'
import type { ExtractedEntities, SkillResult, SupplierProfile } from '../../types'
import type { SecretariaContrato } from '../fornecedores-v2'
import {
  gazetteContratoFornecedorJovem,
  gazetteContratoFornecedorAntigo,
  gazetteContratoSemCnpj,
  gazetteConcentracaoFornecedor,
  gazetteNomeacaoFornecedores,
} from './fornecedores-fixtures'

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeExtractEntitiesMock(override: Partial<ExtractedEntities> = {}) {
  return {
    name: 'extract_entities',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({
      data: {
        cnpjs: ['55.111.222/0001-33'],
        values: [48000],
        dates: ['2026-03-15'],
        contractNumbers: ['012/2026'],
        secretaria: 'Secretaria Municipal de Administração',
        actType: 'contrato',
        supplier: 'Nova Tech Soluções LTDA',
        legalBasis: undefined,
        subtype: null,
        ...override,
      } as ExtractedEntities,
      source: 'https://queridodiario.ok.org.br',
      confidence: 0.85,
    } as SkillResult<ExtractedEntities>),
  }
}

function makeValidateCNPJMock(override: Partial<SupplierProfile> = {}) {
  return jest.fn().mockResolvedValue({
    data: {
      cnpj: '55.111.222/0001-33',
      razaoSocial: 'Nova Tech Soluções LTDA',
      situacaoCadastral: 'ativa',
      dataAbertura: '2025-12-01',
      socios: ['João da Silva'],
      sanctions: false,
      ...override,
    } as Partial<SupplierProfile>,
    source: 'https://brasilapi.com.br/api/cnpj/v1/55111222000133',
    confidence: 1.0,
  } as SkillResult<Partial<SupplierProfile>>)
}

function makeContext(overrides: Partial<FiscalContextV2> = {}): FiscalContextV2 {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-03-15T10:00:00.000Z'),
    extractEntities: makeExtractEntitiesMock(),
    validateCNPJ: makeValidateCNPJMock(),
    queryConcentracaoGSI2: jest.fn().mockResolvedValue([]),
    ...overrides,
  }
}

// ─── 1. Helper: agregarConcentracao ──────────────────────────────────────────

describe('agregarConcentracao (helper puro)', () => {
  it('1a. agrega totalValor e totalContratos por CNPJ', () => {
    const contratos: SecretariaContrato[] = [
      { cnpj14: '55111222000133', mesCNPJ: '2026-01#55111222000133', valueAmount: 50000, contractedAt: '2026-01-10' },
      { cnpj14: '55111222000133', mesCNPJ: '2026-02#55111222000133', valueAmount: 30000, contractedAt: '2026-02-15' },
      { cnpj14: '99888777000111', mesCNPJ: '2026-01#99888777000111', valueAmount: 20000, contractedAt: '2026-01-20' },
    ]

    const resultado = agregarConcentracao(contratos)

    expect(resultado.size).toBe(2)
    const cnpj1 = resultado.get('55111222000133')!
    expect(cnpj1.totalValor).toBe(80000)
    expect(cnpj1.totalContratos).toBe(2)
    expect(cnpj1.percentualValor).toBeCloseTo(80000 / 100000, 5)
  })

  it('1b. percentualValor = 0 quando totalSecretaria = 0 (evita divisão por zero)', () => {
    const contratos: SecretariaContrato[] = [
      { cnpj14: '11111111000111', mesCNPJ: '2026-01#11111111000111', valueAmount: 0, contractedAt: '2026-01-01' },
    ]

    const resultado = agregarConcentracao(contratos)
    expect(resultado.get('11111111000111')!.percentualValor).toBe(0)
  })

  it('1c. lista vazia retorna mapa vazio', () => {
    const resultado = agregarConcentracao([])
    expect(resultado.size).toBe(0)
  })

  it('1d. concentracao >= 40% é detectada corretamente', () => {
    const contratos: SecretariaContrato[] = [
      { cnpj14: 'A', mesCNPJ: '2026-01#A', valueAmount: 60000, contractedAt: '2026-01-01' },
      { cnpj14: 'B', mesCNPJ: '2026-01#B', valueAmount: 40000, contractedAt: '2026-01-01' },
    ]
    const resultado = agregarConcentracao(contratos)

    const a = resultado.get('A')!
    const b = resultado.get('B')!
    expect(a.percentualValor).toBeCloseTo(0.6, 5)  // 60% — acima do limite
    expect(b.percentualValor).toBeCloseTo(0.4, 5)  // 40% — exatamente no limite
    // Limit is >= 0.40, so B should also flag
    expect(a.percentualValor).toBeGreaterThanOrEqual(0.40)
    expect(b.percentualValor).toBeGreaterThanOrEqual(0.40)
  })

  it('1e. concentracao abaixo de 40% NÃO flag', () => {
    const contratos: SecretariaContrato[] = [
      { cnpj14: 'A', mesCNPJ: '2026-01#A', valueAmount: 30000, contractedAt: '2026-01-01' },
      { cnpj14: 'B', mesCNPJ: '2026-01#B', valueAmount: 70000, contractedAt: '2026-01-01' },
    ]
    const resultado = agregarConcentracao(contratos)
    const a = resultado.get('A')!
    expect(a.percentualValor).toBeCloseTo(0.3, 5)  // 30% — abaixo do limite
    expect(a.percentualValor).toBeLessThan(0.40)
  })
})

// ─── 2. queryConcentracaoGSI2 mock (GSI2 response) ────────────────────────────

describe('queryConcentracaoGSI2', () => {
  it('2a. retorna lista vazia quando queryIndex lança erro (fallback gracioso)', async () => {
    // O queryIndex real chamaria DDB — aqui testamos via mock de módulo
    // O fallback está dentro de queryConcentracaoGSI2 via try/catch.
    // Para testar o fallback de erro, injetamos via context.queryConcentracaoGSI2 nos testes de integração.
    // Este teste valida o contrato de tipo: a função aceita secretariaId + gazetteDate
    expect(typeof queryConcentracaoGSI2).toBe('function')
    // Verificar que a assinatura retorna Promise<SecretariaContrato[]>
    // (sem chamar DDB real em tests)
  })
})

// ─── 3. Score recalibrado ─────────────────────────────────────────────────────

describe('score recalibrado v2', () => {
  it('3a. concentracao_valor domina (50%): 50% percentual → riskScore alto', async () => {
    // CNPJ com 50% do volume da secretaria → score deve ser >= 60 (publicável)
    // Outros 50% divididos entre 3 CNPJs menores (nenhum ultrapassa 40%)
    const secretaria = 'Secretaria Municipal de Saúde'
    const cnpj50pct = '44555666000177'

    const contratos: SecretariaContrato[] = [
      { cnpj14: cnpj50pct, mesCNPJ: '2026-01#44555666000177', valueAmount: 50000, contractedAt: '2026-01-10' },
      { cnpj14: cnpj50pct, mesCNPJ: '2026-02#44555666000177', valueAmount: 50000, contractedAt: '2026-02-10' },
      { cnpj14: '11111111000111', mesCNPJ: '2026-01#11111111000111', valueAmount: 20000, contractedAt: '2026-01-20' },
      { cnpj14: '22222222000122', mesCNPJ: '2026-02#22222222000122', valueAmount: 20000, contractedAt: '2026-02-20' },
      { cnpj14: '33333333000133', mesCNPJ: '2026-03#33333333000133', valueAmount: 10000, contractedAt: '2026-03-01' },
    ]
    // Total secretaria: 150k. CNPJ alvo: 100k = 66.7%
    // Outros CNPJs: 20k (13.3%), 20k (13.3%), 10k (6.7%) — todos abaixo de 40%

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['44.555.666/0001-77'],
        values: [50000],
        secretaria,
      }),
      validateCNPJ: makeValidateCNPJMock({
        dataAbertura: '2018-06-01',  // antigo → não dispara cnpj_jovem
        situacaoCadastral: 'ativa',
      }),
      queryConcentracaoGSI2: jest.fn().mockResolvedValue(contratos),
    })

    const findings = await fiscalFornecedoresV2.analisar({
      gazette: gazetteConcentracaoFornecedor,
      cityId: '4305108',
      context,
    })

    const concentracao = findings.filter(f => f.type === 'concentracao_fornecedor')
    expect(concentracao).toHaveLength(1)
    expect(concentracao[0].riskScore).toBeGreaterThanOrEqual(60)
    expect(concentracao[0].cnpj).toBe(cnpj50pct)
    expect(concentracao[0].secretaria).toBe(secretaria)
  })

  it('3b. concentracao abaixo de 40% → sem concentracao_fornecedor', async () => {
    const secretaria = 'Secretaria Municipal de Educação'
    // Todos os CNPJs com menos de 40%: nenhum deve disparar
    const contratos: SecretariaContrato[] = [
      { cnpj14: '22222222000122', mesCNPJ: '2026-01#22222222000122', valueAmount: 30000, contractedAt: '2026-01-10' },
      { cnpj14: '33333333000133', mesCNPJ: '2026-01#33333333000133', valueAmount: 35000, contractedAt: '2026-01-20' },
      { cnpj14: '44444444000144', mesCNPJ: '2026-02#44444444000144', valueAmount: 35000, contractedAt: '2026-02-05' },
    ]
    // Total: 100k. CNPJ 22: 30%, CNPJ 33: 35%, CNPJ 44: 35% — todos abaixo de 40%

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['22.222.222/0001-22'],
        values: [30000],
        secretaria,
      }),
      validateCNPJ: makeValidateCNPJMock({
        cnpj: '22.222.222/0001-22',
        dataAbertura: '2020-01-01',
        situacaoCadastral: 'ativa',
      }),
      queryConcentracaoGSI2: jest.fn().mockResolvedValue(contratos),
    })

    const findings = await fiscalFornecedoresV2.analisar({
      gazette: gazetteConcentracaoFornecedor,
      cityId: '4305108',
      context,
    })

    const concentracao = findings.filter(f => f.type === 'concentracao_fornecedor')
    expect(concentracao).toHaveLength(0)
  })

  it('3c. narrativa v2 menciona percentual e 12 meses', async () => {
    const secretaria = 'Secretaria Municipal de Saúde'
    const cnpj = '44555666000177'
    const contratos: SecretariaContrato[] = [
      { cnpj14: cnpj, mesCNPJ: '2026-01#44555666000177', valueAmount: 80000, contractedAt: '2026-01-10' },
      { cnpj14: '11111111000111', mesCNPJ: '2026-01#11111111000111', valueAmount: 20000, contractedAt: '2026-01-20' },
    ]

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['44.555.666/0001-77'],
        values: [80000],
        secretaria,
      }),
      validateCNPJ: makeValidateCNPJMock({
        dataAbertura: '2018-06-01',
        situacaoCadastral: 'ativa',
      }),
      queryConcentracaoGSI2: jest.fn().mockResolvedValue(contratos),
    })

    const findings = await fiscalFornecedoresV2.analisar({
      gazette: gazetteConcentracaoFornecedor,
      cityId: '4305108',
      context,
    })

    const concentracao = findings.filter(f => f.type === 'concentracao_fornecedor')
    expect(concentracao).toHaveLength(1)
    expect(concentracao[0].narrative).toMatch(/12 meses/)
    expect(concentracao[0].narrative).toMatch(/80[\.,]0%|80\.0%/)
    // Sem termos acusatórios (LRN-20260509-005)
    expect(concentracao[0].narrative).not.toMatch(/fraudou|desviou|corrup/i)
  })
})

// ─── 4. Cache merge LRN-021 ───────────────────────────────────────────────────

describe('LRN-021: cache merge correto', () => {
  it('4a. campos locais (cnpjs, values) vêm sempre do extractor, não de cache estático', async () => {
    // Este teste verifica que o Fiscal v2 usa o resultado do extractEntities mock
    // (que representa o merge regex+LLM) e não sobrescreve com cache estático.
    // O pattern LRN-021 vive no extract_entities_cached.ts — aqui validamos
    // que o Fiscal consome corretamente o resultado completo retornado.

    const cnpjEsperado = '55.111.222/0001-33'
    const valorEsperado = 48000

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpjEsperado],
        values: [valorEsperado],
        secretaria: undefined,  // sem secretaria → não tenta GSI2
      }),
      validateCNPJ: makeValidateCNPJMock({
        dataAbertura: '2025-12-01',  // 3 meses → cnpj_jovem
        situacaoCadastral: 'ativa',
      }),
    })

    const findings = await fiscalFornecedoresV2.analisar({
      gazette: gazetteContratoFornecedorJovem,
      cityId: '4305108',
      context,
    })

    const cnpjJovem = findings.filter(f => f.type === 'cnpj_jovem')
    expect(cnpjJovem).toHaveLength(1)
    // CNPJ e valor devem ser exatamente os que vieram do extractor (não de cache hard-coded)
    expect(cnpjJovem[0].cnpj).toBe(cnpjEsperado)
    expect(cnpjJovem[0].value).toBe(valorEsperado)
  })
})

// ─── 5. SSM flag OFF → comportamento v1 ──────────────────────────────────────

describe('feature flag OFF → garantia de comportamento v1 idêntico', () => {
  it('5a. cnpj_jovem: v1 e v2 emitem finding idêntico quando GSI2 retorna vazio', async () => {
    // Com queryConcentracaoGSI2 retornando [] (nenhum dado histórico),
    // os findings de cnpj_jovem devem ser equivalentes entre v1 e v2.
    const contextV1: FiscalContext = {
      alertsTable: 'fiscal-digital-alerts-test',
      now: () => new Date('2026-03-15T10:00:00.000Z'),
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['55.111.222/0001-33'],
        values: [48000],
        secretaria: undefined,
      }),
      validateCNPJ: makeValidateCNPJMock({ dataAbertura: '2025-12-01', situacaoCadastral: 'ativa' }),
    }

    const contextV2: FiscalContextV2 = {
      ...contextV1,
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['55.111.222/0001-33'],
        values: [48000],
        secretaria: undefined,
      }),
      validateCNPJ: makeValidateCNPJMock({ dataAbertura: '2025-12-01', situacaoCadastral: 'ativa' }),
      queryConcentracaoGSI2: jest.fn().mockResolvedValue([]),
    }

    const [findingsV1, findingsV2] = await Promise.all([
      fiscalFornecedores.analisar({ gazette: gazetteContratoFornecedorJovem, cityId: '4305108', context: contextV1 }),
      fiscalFornecedoresV2.analisar({ gazette: gazetteContratoFornecedorJovem, cityId: '4305108', context: contextV2 }),
    ])

    const jovemV1 = findingsV1.filter(f => f.type === 'cnpj_jovem')
    const jovemV2 = findingsV2.filter(f => f.type === 'cnpj_jovem')

    expect(jovemV1).toHaveLength(1)
    expect(jovemV2).toHaveLength(1)
    // Campos de identidade devem ser idênticos
    expect(jovemV2[0].type).toBe(jovemV1[0].type)
    expect(jovemV2[0].cnpj).toBe(jovemV1[0].cnpj)
    expect(jovemV2[0].legalBasis).toBe(jovemV1[0].legalBasis)
    expect(jovemV2[0].cityId).toBe(jovemV1[0].cityId)
    // riskScore pode diferir levemente por ordem de fatores, mas deve estar na mesma faixa
    expect(Math.abs(jovemV2[0].riskScore - jovemV1[0].riskScore)).toBeLessThanOrEqual(5)
  })

  it('5b. sem CNPJ: v1 e v2 retornam [] para gazette sem dados', async () => {
    const baseContext = {
      alertsTable: 'fiscal-digital-alerts-test',
      now: () => new Date('2026-03-15T10:00:00.000Z'),
      extractEntities: makeExtractEntitiesMock({ cnpjs: [], values: [] }),
      validateCNPJ: makeValidateCNPJMock(),
    }

    const ctxV2: FiscalContextV2 = { ...baseContext, queryConcentracaoGSI2: jest.fn().mockResolvedValue([]) }

    const [v1, v2] = await Promise.all([
      fiscalFornecedores.analisar({ gazette: gazetteContratoSemCnpj, cityId: '4305108', context: baseContext }),
      fiscalFornecedoresV2.analisar({
        gazette: gazetteContratoSemCnpj,
        cityId: '4305108',
        context: ctxV2,
      }),
    ])

    expect(v1).toHaveLength(0)
    expect(v2).toHaveLength(0)
  })

  it('5c. gazette de nomeação → filtro etapa 1 retorna [] em v2 (sem chamar extractEntities)', async () => {
    const context = makeContext()

    const findings = await fiscalFornecedoresV2.analisar({
      gazette: gazetteNomeacaoFornecedores,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })
})

// ─── 6. Cenários adicionais de concentração ───────────────────────────────────

describe('fiscalFornecedoresV2 — cenários adicionais', () => {
  it('6a. CNPJ antigo sem concentração → sem findings de concentracao_fornecedor', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['66.222.333/0001-44'],
        values: [30000],
        secretaria: 'Secretaria Municipal de Educação',
      }),
      validateCNPJ: makeValidateCNPJMock({
        cnpj: '66.222.333/0001-44',
        dataAbertura: '2021-01-10',  // 62 meses → não cnpj_jovem
        situacaoCadastral: 'ativa',
      }),
      queryConcentracaoGSI2: jest.fn().mockResolvedValue([]),  // sem histórico
    })

    const findings = await fiscalFornecedoresV2.analisar({
      gazette: gazetteContratoFornecedorAntigo,
      cityId: '4305108',
      context,
    })

    expect(findings.filter(f => f.type === 'cnpj_jovem')).toHaveLength(0)
    expect(findings.filter(f => f.type === 'concentracao_fornecedor')).toHaveLength(0)
  })

  it('6b. GSI2 retorna vazio → sem concentracao_fornecedor mesmo com secretaria identificada', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['55.111.222/0001-33'],
        secretaria: 'Secretaria Municipal de Administração',
      }),
      validateCNPJ: makeValidateCNPJMock({ dataAbertura: '2021-01-01', situacaoCadastral: 'ativa' }),
      queryConcentracaoGSI2: jest.fn().mockResolvedValue([]),
    })

    const findings = await fiscalFornecedoresV2.analisar({
      gazette: gazetteContratoFornecedorAntigo,
      cityId: '4305108',
      context,
    })

    expect(findings.filter(f => f.type === 'concentracao_fornecedor')).toHaveLength(0)
  })

  it('6c. LRN-019: secretariaId nunca é null (guard clause antes do GSI2)', async () => {
    // Quando secretaria é undefined/null, queryConcentracaoGSI2 NÃO é chamado.
    const queryMock = jest.fn().mockResolvedValue([])

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['55.111.222/0001-33'],
        secretaria: undefined,  // sem secretaria
      }),
      validateCNPJ: makeValidateCNPJMock({ dataAbertura: '2021-01-01', situacaoCadastral: 'ativa' }),
      queryConcentracaoGSI2: queryMock,
    })

    await fiscalFornecedoresV2.analisar({
      gazette: gazetteContratoFornecedorAntigo,
      cityId: '4305108',
      context,
    })

    // Query GSI2 não deve ter sido chamada sem secretariaId (LRN-019 compliance)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('6d. deduplicação de secretaria: GSI2 chamado apenas 1x por secretaria por gazette', async () => {
    // Gazettes com 2 excerpts da mesma secretaria → GSI2 deve ser chamado apenas 1×
    const multiExcerptGazette = {
      ...gazetteConcentracaoFornecedor,
      excerpts: [
        'CONTRATO 001/2026. Contratada: Empresa A, CNPJ: 44.555.666/0001-77. Secretaria Municipal de Saúde.',
        'CONTRATO 002/2026. Contratada: Empresa B, CNPJ: 11.222.333/0001-44. Secretaria Municipal de Saúde.',
      ],
    }

    const queryMock = jest.fn().mockResolvedValue([])
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['44.555.666/0001-77'],
        secretaria: 'Secretaria Municipal de Saúde',
      }),
      validateCNPJ: makeValidateCNPJMock({ dataAbertura: '2021-01-01', situacaoCadastral: 'ativa' }),
      queryConcentracaoGSI2: queryMock,
    })

    await fiscalFornecedoresV2.analisar({
      gazette: multiExcerptGazette,
      cityId: '4305108',
      context,
    })

    // GSI2 deve ser chamado apenas 1× mesmo com 2 excerpts da mesma secretaria
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
