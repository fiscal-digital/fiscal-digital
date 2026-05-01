import { fiscalFornecedores } from '../fornecedores'
import type { FiscalContext } from '../types'
import type { ExtractedEntities, SkillResult, SupplierProfile } from '../../types'
import {
  gazetteContratoFornecedorJovem,
  gazetteContratoFornecedorAntigo,
  gazetteContratoSemCnpj,
  gazetteContratoNaoEncontrado,
  gazetteConcentracaoFornecedor,
  gazetteContratosDiversificados,
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

function makeContext(overrides: Partial<FiscalContext> = {}): FiscalContext {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-03-15T10:00:00.000Z'),
    extractEntities: makeExtractEntitiesMock(),
    validateCNPJ: makeValidateCNPJMock(),
    ...overrides,
  }
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('fiscalFornecedores', () => {
  // Caso 1 — CNPJ aberto há 3 meses → dispara cnpj_jovem
  it('1. positivo cnpj_jovem: CNPJ aberto há 3 meses → emite cnpj_jovem', async () => {
    // gazette.date = 2026-03-15, dataAbertura = 2025-12-01 → 3 meses
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['55.111.222/0001-33'],
        values: [48000],
      }),
      validateCNPJ: makeValidateCNPJMock({ dataAbertura: '2025-12-01' }),
    })

    const findings = await fiscalFornecedores.analisar({
      gazette: gazetteContratoFornecedorJovem,
      cityId: '4305108',
      context,
    })

    const cnpjJovem = findings.filter(f => f.type === 'cnpj_jovem')
    expect(cnpjJovem).toHaveLength(1)
    expect(cnpjJovem[0].cnpj).toBe('55.111.222/0001-33')
    expect(cnpjJovem[0].riskScore).toBeGreaterThan(0)
    expect(cnpjJovem[0].legalBasis).toMatch(/Art\. 67/)
    // Narrativa factual — sem termos acusatórios
    expect(cnpjJovem[0].narrative).toMatch(/[Ii]dentificamos/)
    expect(cnpjJovem[0].narrative).not.toMatch(/fraudou|desviou|corrup/i)
  })

  // Caso 2 — CNPJ aberto há 5 anos → não dispara cnpj_jovem
  it('2. negativo cnpj_jovem: CNPJ aberto há 5 anos → nenhum cnpj_jovem', async () => {
    // gazette.date = 2026-03-15, dataAbertura = 2021-01-10 → ~62 meses → >= 6 → sem finding
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['66.222.333/0001-44'],
        values: [30000],
      }),
      validateCNPJ: makeValidateCNPJMock({
        cnpj: '66.222.333/0001-44',
        dataAbertura: '2021-01-10',
      }),
    })

    const findings = await fiscalFornecedores.analisar({
      gazette: gazetteContratoFornecedorAntigo,
      cityId: '4305108',
      context,
    })

    const cnpjJovem = findings.filter(f => f.type === 'cnpj_jovem')
    expect(cnpjJovem).toHaveLength(0)
  })

  // Caso 3 — Excerpt sem CNPJ extraído → retorna []
  it('3. sem CNPJ: extractEntities retorna cnpjs=[] → retorna []', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [],
        values: [20000],
      }),
    })

    const findings = await fiscalFornecedores.analisar({
      gazette: gazetteContratoSemCnpj,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
  })

  // Caso 4 — validateCNPJ retorna nao_encontrado → skip silencioso []
  it('4. nao_encontrado: validateCNPJ retorna situacaoCadastral=nao_encontrado → skip silencioso []', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['99.888.777/0001-11'],
        values: [60000],
      }),
      validateCNPJ: makeValidateCNPJMock({
        cnpj: '99.888.777/0001-11',
        situacaoCadastral: 'nao_encontrado',
        dataAbertura: undefined,
      }),
    })

    const findings = await fiscalFornecedores.analisar({
      gazette: gazetteContratoNaoEncontrado,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
  })

  // Caso 5 — Concentração: 4 contratos mesmo CNPJ mesma secretaria → dispara concentracao_fornecedor
  it('5. positivo concentracao_fornecedor: 4 contratos mesmo CNPJ → emite concentracao_fornecedor', async () => {
    const cnpj = '44.555.666/0001-77'
    const secretaria = 'Secretaria Municipal de Saúde'

    // Simula 4 CNPJs idênticos extraídos do excerpt em lote
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj, cnpj, cnpj, cnpj],
        values: [50000, 50000, 50000, 50000],
        secretaria,
      }),
      validateCNPJ: makeValidateCNPJMock({
        cnpj,
        dataAbertura: '2018-06-01',  // antigo → não dispara cnpj_jovem
        situacaoCadastral: 'ativa',
      }),
    })

    const findings = await fiscalFornecedores.analisar({
      gazette: gazetteConcentracaoFornecedor,
      cityId: '4305108',
      context,
    })

    const concentracao = findings.filter(f => f.type === 'concentracao_fornecedor')
    expect(concentracao).toHaveLength(1)
    expect(concentracao[0].cnpj).toBe(cnpj)
    expect(concentracao[0].secretaria).toBe(secretaria)
    expect(concentracao[0].legalBasis).toMatch(/Art\. 11/)
    expect(concentracao[0].narrative).toMatch(/[Ii]dentificamos/)
  })

  // Caso 6 — Contratos diversificados (CNPJs distintos) → não dispara concentracao_fornecedor
  it('6. negativo concentracao_fornecedor: CNPJs distintos → nenhum concentracao_fornecedor', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['11.111.111/0001-11', '22.222.222/0001-22'],
        values: [20000, 25000],
        secretaria: 'Secretaria Municipal de Educação',
      }),
      validateCNPJ: makeValidateCNPJMock({
        dataAbertura: '2019-05-01',
        situacaoCadastral: 'ativa',
      }),
    })

    const findings = await fiscalFornecedores.analisar({
      gazette: gazetteContratosDiversificados,
      cityId: '4305108',
      context,
    })

    const concentracao = findings.filter(f => f.type === 'concentracao_fornecedor')
    expect(concentracao).toHaveLength(0)
  })

  // Caso 7 — Gazette sem termos de contratação (nomeação) → filtro etapa 1 retorna []
  it('7. sem contratação: gazette de nomeação → filtro etapa 1 retorna [] sem chamar extractEntities', async () => {
    const context = makeContext()

    const findings = await fiscalFornecedores.analisar({
      gazette: gazetteNomeacaoFornecedores,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    // extractEntities não deve ter sido chamado (filtro etapa 1 bloqueou)
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })
})
