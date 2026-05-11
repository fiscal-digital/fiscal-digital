import { fiscalContratos } from '../contratos'
import type { FiscalContext } from '../types'
import type { Finding, SkillResult, ExtractedEntities } from '../../types'
import {
  gazetteAditivo30kContrato100k,
  gazetteAditivo20kContrato100k,
  gazetteAditivo25kExatoContrato100k,
  gazetteAditivo25k01Contrato100k,
  gazetteAditivoReforma40k,
  gazetteAditivoReforma51k,
  gazetteNomeacaoContratos,
  gazetteAditivoSemValorOriginal,
  gazetteProrrogacao2020,
  gazetteProrrogacao2014,
  gazetteAditivo30kNarrativa,
} from './contratos-fixtures'

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeExtractEntitiesMock(override: Partial<ExtractedEntities> = {}) {
  return {
    name: 'extract_entities',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({
      data: {
        cnpjs: ['12.345.678/0001-90'],
        values: [30000],
        dates: [],
        contractNumbers: ['042/2024'],
        secretaria: 'Secretaria Municipal de Administração',
        actType: 'aditivo',
        supplier: 'Tech Solutions LTDA',
        legalBasis: 'Lei 14.133/2021, Art. 125',
        subtype: null,
        valorOriginalContrato: undefined,
        ...override,
      } as ExtractedEntities,
      source: 'https://queridodiario.ok.org.br',
      confidence: 0.85,
    } as SkillResult<ExtractedEntities>),
  }
}

function makeContratoOriginalFinding(
  cnpj: string,
  contractNumber: string,
  valor: number,
  date = '2024-01-15',
): Finding {
  return {
    fiscalId: 'fiscal-contratos',
    cityId: '4305108',
    type: 'aditivo_abusivo',
    riskScore: 0,
    confidence: 0.85,
    evidence: [{ source: 'https://queridodiario.ok.org.br', excerpt: 'contrato original', date }],
    narrative: '',
    legalBasis: 'Lei 14.133/2021, Art. 125',
    cnpj,
    value: valor,
    contractNumber,
    // actType como campo extra para simular item DynamoDB
    ...(({ actType: 'contrato' }) as unknown as Record<string, unknown>),
  }
}

function makeProrrogacaoFinding(
  cnpj: string,
  contractNumber: string,
  date: string,
): Finding {
  return {
    fiscalId: 'fiscal-contratos',
    cityId: '4305108',
    type: 'aditivo_abusivo',
    riskScore: 0,
    confidence: 0.85,
    evidence: [{ source: 'https://queridodiario.ok.org.br', excerpt: 'contrato original', date }],
    narrative: '',
    legalBasis: 'Lei 14.133/2021, Art. 107',
    cnpj,
    contractNumber,
    ...(({ actType: 'contrato' }) as unknown as Record<string, unknown>),
  }
}

function makeQueryAlertsByCnpjMock(findings: Finding[] = []) {
  return jest.fn().mockResolvedValue(findings)
}

function makeQuerySuppliersContractMock(value?: number) {
  if (value === undefined) {
    return jest.fn().mockResolvedValue({
      data: null,
      source: 'dynamodb:fiscal-digital-suppliers-prod#NOTFOUND',
      confidence: 1.0,
    })
  }
  return jest.fn().mockResolvedValue({
    data: {
      cnpj: '12345678000190',
      cityId: '4305108',
      contractNumber: '042/2024',
      contractedAt: '2024-01-15',
      valueAmount: value,
    },
    source: 'dynamodb:fiscal-digital-suppliers-prod#mock',
    confidence: 1.0,
  })
}

function makeGenerateNarrativeMock(text = 'Narrativa mock gerada.') {
  return jest.fn().mockResolvedValue(text)
}

function makeSaveMemoryMock() {
  return {
    name: 'save_memory',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({
      data: undefined,
      source: 'dynamodb:fiscal-digital-alerts-test#mock',
      confidence: 1.0,
    }),
  }
}

function makeContext(overrides: Partial<FiscalContext> = {}): FiscalContext {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-03-15T10:00:00.000Z'),
    extractEntities: makeExtractEntitiesMock(),
    queryAlertsByCnpj: makeQueryAlertsByCnpjMock([]),
    generateNarrative: makeGenerateNarrativeMock(),
    saveMemory: makeSaveMemoryMock(),
    ...overrides,
  }
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('fiscalContratos', () => {
  // Caso 1 — Aditivo R$ 30k sobre contrato R$ 100k (lookup) → excede 25% → aditivo_abusivo Art. 125 §1º I
  it('1. positivo geral: aditivo R$ 30k sobre contrato R$ 100k → aditivo_abusivo, legalBasis Art. 125 §1º I', async () => {
    const cnpj = '12.345.678/0001-90'
    const contractNumber = '042/2024'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [30000],
        contractNumbers: [contractNumber],
        legalBasis: 'Lei 14.133/2021, Art. 125',
        subtype: null,
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeContratoOriginalFinding(cnpj, contractNumber, 100000),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivo30kContrato100k,
      cityId: '4305108',
      context,
    })

    const aditivoFindings = findings.filter(f => f.type === 'aditivo_abusivo')
    expect(aditivoFindings).toHaveLength(1)
    expect(aditivoFindings[0].legalBasis).toBe('Lei 14.133/2021, Art. 125, §1º, I')
    expect(aditivoFindings[0].riskScore).toBeGreaterThanOrEqual(60)
    expect(aditivoFindings[0].value).toBe(30000)
  })

  // Caso 2 — Aditivo R$ 20k sobre contrato R$ 100k → 20% < 25% → []
  it('2. negativo geral: aditivo R$ 20k sobre contrato R$ 100k → nenhum finding', async () => {
    const cnpj = '22.333.444/0001-55'
    const contractNumber = '043/2024'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [20000],
        contractNumbers: [contractNumber],
        subtype: null,
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeContratoOriginalFinding(cnpj, contractNumber, 100000),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivo20kContrato100k,
      cityId: '4305108',
      context,
    })

    const aditivoFindings = findings.filter(f => f.type === 'aditivo_abusivo')
    expect(aditivoFindings).toHaveLength(0)
  })

  // Caso 3 — Aditivo R$ 25k exato sobre contrato R$ 100k → teto exato 25% → []
  it('3. edge limite geral: aditivo R$ 25k exato (25.0%) → nenhum finding', async () => {
    const cnpj = '33.444.555/0001-66'
    const contractNumber = '044/2024'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [25000],
        contractNumbers: [contractNumber],
        subtype: null,
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeContratoOriginalFinding(cnpj, contractNumber, 100000),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivo25kExatoContrato100k,
      cityId: '4305108',
      context,
    })

    const aditivoFindings = findings.filter(f => f.type === 'aditivo_abusivo')
    expect(aditivoFindings).toHaveLength(0)
  })

  // Caso 4 — Aditivo R$ 25.000,01 (1 centavo acima de 25%) → dispara aditivo_abusivo
  it('4. edge 1 centavo: aditivo R$ 25.000,01 sobre contrato R$ 100k → dispara aditivo_abusivo', async () => {
    const cnpj = '44.555.666/0001-77'
    const contractNumber = '045/2024'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [25000.01],
        contractNumbers: [contractNumber],
        subtype: null,
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeContratoOriginalFinding(cnpj, contractNumber, 100000),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivo25k01Contrato100k,
      cityId: '4305108',
      context,
    })

    const aditivoFindings = findings.filter(f => f.type === 'aditivo_abusivo')
    expect(aditivoFindings).toHaveLength(1)
    expect(aditivoFindings[0].riskScore).toBeGreaterThanOrEqual(60)
  })

  // Caso 5 — Reforma de edifício R$ 40k sobre contrato R$ 100k → 40% < 50% → []
  it('5. reforma 40%: subtype=obra_engenharia, excerpt "reforma do edifício", aditivo R$ 40k → nenhum finding', async () => {
    const cnpj = '55.666.777/0001-88'
    const contractNumber = '046/2024'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [40000],
        contractNumbers: [contractNumber],
        subtype: 'obra_engenharia',
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeContratoOriginalFinding(cnpj, contractNumber, 100000),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivoReforma40k,
      cityId: '4305108',
      context,
    })

    const aditivoFindings = findings.filter(f => f.type === 'aditivo_abusivo')
    expect(aditivoFindings).toHaveLength(0)
  })

  // Caso 6 — Reforma de edifício R$ 51k sobre contrato R$ 100k → 51% > 50% → aditivo_abusivo Art. 125 §1º II
  it('6. reforma 51%: subtype=obra_engenharia, excerpt "reforma do edifício", aditivo R$ 51k → aditivo_abusivo Art. 125 §1º II', async () => {
    const cnpj = '66.777.888/0001-99'
    const contractNumber = '047/2024'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [51000],
        contractNumbers: [contractNumber],
        subtype: 'obra_engenharia',
        legalBasis: 'Lei 14.133/2021, Art. 125',
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeContratoOriginalFinding(cnpj, contractNumber, 100000),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivoReforma51k,
      cityId: '4305108',
      context,
    })

    const aditivoFindings = findings.filter(f => f.type === 'aditivo_abusivo')
    expect(aditivoFindings).toHaveLength(1)
    expect(aditivoFindings[0].legalBasis).toBe('Lei 14.133/2021, Art. 125, §1º, II')
  })

  // Caso 7 — Gazette de nomeação (sem aditivo nem prorrogação) → filtro etapa 1 retorna []
  it('7. sem aditivo: gazette de nomeação → filtro etapa 1 retorna []', async () => {
    const context = makeContext()

    const findings = await fiscalContratos.analisar({
      gazette: gazetteNomeacaoContratos,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    // extractEntities nunca deve ter sido chamado (filtro etapa 1)
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })

  // Caso 8 — Aditivo sem valor original (lookup vazio + valorOriginalContrato ausente) → skip silencioso []
  it('8. sem valor original: lookup vazio + valorOriginalContrato ausente → skip silencioso []', async () => {
    const cnpj = '77.888.999/0001-11'
    const contractNumber = '048/2024'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [30000],
        contractNumbers: [contractNumber],
        valorOriginalContrato: undefined,
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([]), // lookup vazio
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivoSemValorOriginal,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
  })

  // Caso 9 — Prorrogação com vigência inicial 2020-01-01 → < 10 anos em 2026 → []
  it('9. prorrogação ≤ 10 anos: vigência inicial 2020-01-01 → nenhum finding', async () => {
    const cnpj = '88.999.000/0001-22'
    const contractNumber = '010/2020'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [],
        contractNumbers: [contractNumber],
        actType: 'prorrogacao',
        subtype: null,
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeProrrogacaoFinding(cnpj, contractNumber, '2020-01-01'),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteProrrogacao2020,
      cityId: '4305108',
      context,
    })

    const prorrogacaoFindings = findings.filter(f => f.type === 'prorrogacao_excessiva')
    expect(prorrogacaoFindings).toHaveLength(0)
  })

  // Caso 10 — Prorrogação com vigência inicial 2014-01-01 + extensão 2026 → > 10 anos → prorrogacao_excessiva
  it('10. prorrogação > 10 anos: vigência inicial 2014-01-01 → prorrogacao_excessiva, legalBasis Art. 107', async () => {
    const cnpj = '99.000.111/0001-33'
    const contractNumber = '005/2014'

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpj],
        values: [],
        contractNumbers: [contractNumber],
        actType: 'prorrogacao',
        subtype: null,
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeProrrogacaoFinding(cnpj, contractNumber, '2014-01-01'),
      ]),
    })

    const findings = await fiscalContratos.analisar({
      gazette: gazetteProrrogacao2014,
      cityId: '4305108',
      context,
    })

    const prorrogacaoFindings = findings.filter(f => f.type === 'prorrogacao_excessiva')
    expect(prorrogacaoFindings).toHaveLength(1)
    expect(prorrogacaoFindings[0].legalBasis).toBe('Lei 14.133/2021, Art. 107, caput')
  })

  // Caso 11 — Linguagem factual: validar narrativa do template sem termos acusatórios
  it('11. linguagem factual: narrativa de aditivo abusivo não contém termos acusatórios', async () => {
    const cnpj = '11.222.333/0001-44'
    const contractNumber = '049/2024'

    // riskScore baixo: forçar template em vez de LLM
    // Valor mínimo de excesso (25.01%) + confiança 0.20 → riskScore < 60
    const mockExtract = {
      name: 'extract_entities',
      description: 'mock',
      execute: jest.fn().mockResolvedValue({
        data: {
          cnpjs: [cnpj],
          values: [25010], // 25.01% de R$ 100k
          dates: [],
          contractNumbers: [contractNumber],
          secretaria: 'Secretaria Municipal de Obras',
          actType: 'aditivo',
          supplier: 'Serviços Regionais LTDA',
          legalBasis: undefined, // sem base legal → value 50
          subtype: null,
          valorOriginalContrato: undefined,
        } as ExtractedEntities,
        source: 'https://queridodiario.ok.org.br',
        confidence: 0.20, // confiança muito baixa
      } as SkillResult<ExtractedEntities>),
    }

    const context: FiscalContext = {
      alertsTable: 'fiscal-digital-alerts-test',
      now: () => new Date('2026-03-15T10:00:00.000Z'),
      extractEntities: mockExtract,
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([
        makeContratoOriginalFinding(cnpj, contractNumber, 100000),
      ]),
      saveMemory: makeSaveMemoryMock(),
      // generateNarrative NÃO injetado — deve usar template factual
    }

    const findings = await fiscalContratos.analisar({
      gazette: gazetteAditivo30kNarrativa,
      cityId: '4305108',
      context,
    })

    const aditivoFindings = findings.filter(f => f.type === 'aditivo_abusivo')
    expect(aditivoFindings).toHaveLength(1)

    const narrativa = aditivoFindings[0].narrative

    // Validar ausência de termos acusatórios
    expect(narrativa).not.toMatch(/fraudou|desviou|corrup|il[íi]cito/i)

    // Validar linguagem factual obrigatória
    expect(narrativa).toMatch(/[Ii]dentificamos/)
    expect(narrativa).toMatch(/limite legal/)
    expect(narrativa).toMatch(/Lei 14\.133\/2021/)
    expect(narrativa).toMatch(/Art\. 125/)
  })

  // ── Regression tests do golden set fiscal-digital-evaluations (Ciclo 1) ──
  // ADR-001 — fiscal-contratos/ADR-001-missing-original-value.md
  // FPs originais: GS-082..086, 088, 089 (instrumento errado/reajuste/valor <R$5k/percentual declarado).
  // TP: GS-087 (deve continuar disparando).
  describe('regression tests (golden set FPs — ADR-001)', () => {
    function expectNoFinding(excerpt: string, label: string, values: number[]) {
      return async () => {
        const context: FiscalContext = {
          alertsTable: 'fiscal-digital-alerts-test',
          now: () => new Date('2026-05-10T10:00:00.000Z'),
          extractEntities: makeExtractEntitiesMock({ values }),
        }
        const gazette = {
          id: `gs-contratos-${label}`,
          territory_id: '4305108',
          date: '2026-04-10',
          url: `https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=contratos-${label}`,
          excerpts: [excerpt],
          edition: '1',
          is_extra: false,
        }
        const findings = await fiscalContratos.analisar({
          gazette,
          cityId: '4305108',
          context,
        })
        const aditivo = findings.filter(f => f.type === 'aditivo_abusivo')
        expect(aditivo).toHaveLength(0)
      }
    }

    it('GS-082: Termo aditivo a Termo de Compromisso (instrumento fora escopo)', expectNoFinding(
      'R$ 2.700.000,00. Modalidade: Inexigibilidade nº 2022/59. SEMMA – Contratante: Município. Contratado: MARCELO LISSOTT. Objeto: Termo aditivo n.º 01 ao TERMO DE COMPROMISSO firmado anteriormente.',
      '082',
      [2700000],
    ))

    it('GS-083: revisão anual (reajuste legal Art. 124)', expectNoFinding(
      'Contratado: MARISOL TRANSPORTE LTDA. Objeto: Termo Aditivo nº 05 ao Contrato 2019/192, para revisão anual de valores contratuais do transporte escolar. Valor estimado: R$ 25.850,00.',
      '083',
      [25850],
    ))

    it('GS-084: percentual declarado 20,22% (abaixo do limite — texto explícito)', expectNoFinding(
      'OBJETO: Alteração do valor do Contrato n. 388 de 28/9/2020. ALTERAÇÃO: Fica alterado o valor do contrato n. 388/2020. acréscimo de 20,22% no valor original conforme planilha anexa. Processo 136281/2019-21.',
      '084',
      [50000],
    ))

    it('GS-085: aditivo de R$ 2.200 (abaixo do floor R$ 5.000)', expectNoFinding(
      'OBJETO: Termo Aditivo n.º 01 ao Contrato n.º 049/2022 de prestação de serviços de confecção de impressos diversos, para acréscimo de quantidade. VALOR: R$ 2.200,00.',
      '085',
      [2200],
    ))

    it('GS-086: prorrogação por 12 meses sem alterar valor unitário (apostilamento)', expectNoFinding(
      'Objeto: Termo Aditivo nº 08 ao Contrato nº 2018/751 para prorrogar a vigência do contrato de 20/08/2023 até 19/08/2024. apostilamento de valor mensal. Valor: R$ 100.000,00.',
      '086',
      [100000],
    ))

    it('GS-088: aditivo de R$ 234,96 (abaixo do floor — ajuste operacional)', expectNoFinding(
      'Objeto: Termo aditivo nº 09 ao contrato 2019/159 para redução de quilometragem roteiro 803 M/T e acréscimo de quilometragem roteiro 903 M/T. Valor Estimado: R$ 234,96.',
      '088',
      [234.96],
    ))

    it('GS-089: aditivo a Termo de Compromisso (instrumento fora escopo)', expectNoFinding(
      'Modalidade de licitação: Termo de Compromisso. Processo 2020/23391. Contratado: FERNANDA PIVA. Objeto: Termo Aditivo nº 02 ao Termo de Compromisso. Valor estimado: R$ 10.752,00.',
      '089',
      [10752],
    ))

    // ── Padrões adicionais Ciclo 2 ──
    it('C2-REPACTUACAO-CCT: repactuação por Convenção Coletiva', expectNoFinding(
      'Termo Aditivo nº 03 ao Contrato 2024/100. Objeto: repactuação CCT 2024/2025 da categoria de vigilância. Reajuste por convenção coletiva. Valor: R$ 50.000,00.',
      'c2-repactuacao',
    [50000],
    ))

    it('C2-IPCA: reajuste anual pelo IPCA', expectNoFinding(
      'Termo Aditivo nº 02. Objeto: reajuste anual pelo IPCA acumulado de 4,5% no período. Aditivo de valor: R$ 80.000,00.',
      'c2-ipca',
      [80000],
    ))

    it('C2-FOMENTO-ADITIVO: aditivo a Termo de Fomento (Lei 13.019)', expectNoFinding(
      'Termo Aditivo nº 01 ao Termo de Fomento nº 005/2025. Objeto: prorrogação de parceria com OSC. Valor acrescido: R$ 100.000,00.',
      'c2-fomento',
      [100000],
    ))

    it('C2-SUPRESSAO: supressão de valor (negativo)', expectNoFinding(
      'Termo Aditivo nº 03 ao Contrato 100/2024. Objeto: supressão de valor por não execução de etapas. Impactação financeira negativa. Valor de R$ 0,00.',
      'c2-supressao',
      [0],
    ))

    it('C2-SUMULA: SÚMULA DE CONVÊNIOS E CONTRATOS (cross-block)', expectNoFinding(
      'SÚMULA DE CONVÊNIOS E CONTRATOS. Contratante: Município. Contratado: MITRA DIOCESANA. Objeto: Termo aditivo para prorrogação. Valor: R$ 80.000,00.',
      'c2-sumula',
      [80000],
    ))
  })

  // ── Cross-reference via skill querySuppliersContract (EVO-002) ─────────────
  // Resolve o ADR-001 follow-up: valor original via suppliers-prod GSI.
  describe('cross-reference suppliers-prod (querySuppliersContract)', () => {
    function makeAditivoExcerpt(valorAditivo: number, contractNum = '042/2024'): string {
      return `EXTRATO DE TERMO ADITIVO Nº 01 ao Contrato nº ${contractNum}. Acréscimo no valor de R$ ${valorAditivo.toLocaleString('pt-BR')},00. Contratada: Tech Solutions LTDA, CNPJ 12.345.678/0001-90.`
    }

    it('dispara aditivo_abusivo quando suppliers-prod retorna valor original e aditivo excede 25%', async () => {
      // Original R$ 100k, aditivo R$ 30k = 30% > 25% (limite Art. 125 §1º I)
      const querySuppliers = makeQuerySuppliersContractMock(100000)

      const context: FiscalContext = {
        alertsTable: 'fiscal-digital-alerts-test',
        now: () => new Date('2026-05-10T10:00:00.000Z'),
        extractEntities: makeExtractEntitiesMock({ values: [30000], contractNumbers: ['042/2024'] }),
        querySuppliersContract: querySuppliers,
        saveMemory: makeSaveMemoryMock(),
      }

      const findings = await fiscalContratos.analisar({
        gazette: {
          id: 'g-supplier-1',
          territory_id: '4305108',
          date: '2026-04-10',
          url: 'https://queridodiario.ok.org.br/test',
          excerpts: [makeAditivoExcerpt(30000)],
          edition: '1',
          is_extra: false,
        },
        cityId: '4305108',
        context,
      })

      expect(querySuppliers).toHaveBeenCalledWith({
        cnpj: '12.345.678/0001-90',
        cityId: '4305108',
        contractNumber: '042/2024',
      })

      const aditivo = findings.filter(f => f.type === 'aditivo_abusivo')
      expect(aditivo).toHaveLength(1)
      expect(aditivo[0].value).toBe(30000)
      expect(aditivo[0].riskScore).toBeGreaterThanOrEqual(60)
    })

    it('NÃO dispara quando suppliers-prod retorna valor original e aditivo está abaixo de 25%', async () => {
      // Original R$ 200k, aditivo R$ 30k = 15% < 25% — não emite
      const querySuppliers = makeQuerySuppliersContractMock(200000)

      const context: FiscalContext = {
        alertsTable: 'fiscal-digital-alerts-test',
        now: () => new Date('2026-05-10T10:00:00.000Z'),
        extractEntities: makeExtractEntitiesMock({ values: [30000], contractNumbers: ['042/2024'] }),
        querySuppliersContract: querySuppliers,
        saveMemory: makeSaveMemoryMock(),
      }

      const findings = await fiscalContratos.analisar({
        gazette: {
          id: 'g-supplier-2',
          territory_id: '4305108',
          date: '2026-04-10',
          url: 'https://queridodiario.ok.org.br/test',
          excerpts: [makeAditivoExcerpt(30000)],
          edition: '1',
          is_extra: false,
        },
        cityId: '4305108',
        context,
      })

      expect(querySuppliers).toHaveBeenCalled()
      expect(findings).toHaveLength(0)
    })

    it('skip silencioso quando suppliers-prod retorna null e sem fallback LLM nem alerts-prod', async () => {
      const querySuppliers = makeQuerySuppliersContractMock(undefined) // null
      const queryAlerts = makeQueryAlertsByCnpjMock([])

      const context: FiscalContext = {
        alertsTable: 'fiscal-digital-alerts-test',
        now: () => new Date('2026-05-10T10:00:00.000Z'),
        extractEntities: makeExtractEntitiesMock({ values: [30000], contractNumbers: ['042/2024'] }),
        querySuppliersContract: querySuppliers,
        queryAlertsByCnpj: queryAlerts,
        saveMemory: makeSaveMemoryMock(),
      }

      const findings = await fiscalContratos.analisar({
        gazette: {
          id: 'g-supplier-3',
          territory_id: '4305108',
          date: '2026-04-10',
          url: 'https://queridodiario.ok.org.br/test',
          excerpts: [makeAditivoExcerpt(30000)],
          edition: '1',
          is_extra: false,
        },
        cityId: '4305108',
        context,
      })

      expect(querySuppliers).toHaveBeenCalled()
      expect(findings).toHaveLength(0)
    })
  })
})
