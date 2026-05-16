import { fiscalConvenios } from '../convenios'
import {
  LEI_13019_CONVENIO_VALOR_REFERENCIA,
  LEI_13019_REPASSE_RECORRENTE_MINIMO,
} from '../legal-constants'
import type { FiscalContext } from '../types'
import type { Finding, Gazette, SkillResult, ExtractedEntities } from '../../types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_GAZETTE: Gazette = {
  id: 'gazette-conv-base',
  territory_id: '4305108',
  date: '2026-04-10',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=conv',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

const CNPJ_OSC_A = '12.345.678/0001-90'
const CNPJ_OSC_B = '88.999.000/0001-11'

// Convênio acima do limiar SEM menção a chamamento → DEVE disparar
const gazConvenioSemChamamento: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-001',
  excerpts: [
    'TERMO DE FOMENTO n° 005/2026. Celebração entre o Município e a Organização da Sociedade Civil ' +
      'Instituto Apoio Caxias. Valor: R$ 800.000,00. Objeto: programa de assistência social. ' +
      `Contratada: Instituto Apoio Caxias, CNPJ: ${CNPJ_OSC_A}. Secretaria Municipal de Assistência Social.`,
  ],
}

// Convênio acima do limiar COM chamamento público → NÃO dispara
const gazConvenioComChamamento: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-002',
  excerpts: [
    'TERMO DE COLABORAÇÃO n° 011/2026. Após chamamento público nº 003/2026 (Edital publicado em ' +
      '15/02/2026), celebra-se parceria com a OSC Educar Caxias. Valor: R$ 750.000,00. ' +
      `CNPJ: ${CNPJ_OSC_B}. Secretaria Municipal de Educação.`,
  ],
}

// Convênio abaixo do limiar → NÃO dispara por valor
const gazConvenioBaixoValor: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-003',
  excerpts: [
    'TERMO DE FOMENTO n° 014/2026. Parceria com a OSC Cultura Viva. Valor: R$ 200.000,00. ' +
      `CNPJ: ${CNPJ_OSC_A}. Secretaria Municipal de Cultura.`,
  ],
}

// Acordo de cooperação puro (sem repasse) → fora de escopo
const gazAcordoCooperacao: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-004',
  excerpts: [
    'ACORDO DE COOPERAÇÃO n° 008/2026. Entre o Município e a OSC Saúde Solidária para ' +
      'desenvolvimento de atividades educativas em saúde, sem repasse de recursos financeiros.',
  ],
}

// Convênio sem CNPJ → ainda dispara mas sem GSI cnpj
const gazConvenioSemCnpj: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-005',
  excerpts: [
    'TERMO DE FOMENTO n° 022/2026. Parceria com Organização da Sociedade Civil para programa ' +
      'esportivo. Valor: R$ 700.000,00. Secretaria Municipal de Esporte.',
  ],
}

// Convênio com valor exatamente no limiar → NÃO dispara (estrito >)
const gazConvenioExatoLimiar: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-006',
  excerpts: [
    'TERMO DE FOMENTO n° 025/2026. Parceria com OSC Vida Caxias. ' +
      `Valor: R$ 600.000,00. CNPJ: ${CNPJ_OSC_A}. Secretaria Municipal de Saúde.`,
  ],
}

// Gazette sem nenhum termo de convênio → filtro etapa 1 retorna []
const gazSemConvenio: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-007',
  excerpts: [
    'PORTARIA n° 142/2026. O Prefeito Municipal nomeia o servidor João da Silva para o cargo ' +
      'de Diretor de Departamento, junto à Secretaria Municipal de Administração.',
  ],
}

// Convênio com inexigibilidade Art. 30 → NÃO dispara
const gazConvenioInexigibilidade: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-008',
  excerpts: [
    'TERMO DE COLABORAÇÃO n° 030/2026. Inexigibilidade de chamamento público com fundamento no ' +
      'Art. 30 da Lei 13.019/2014, dada a singularidade do objeto. Parceria com OSC Centro Cultural ' +
      `Histórico Caxias. Valor: R$ 900.000,00. CNPJ: ${CNPJ_OSC_A}.`,
  ],
}

// Convênio para repasse recorrente
const gazRepasseRecorrente: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-conv-009',
  excerpts: [
    'TERMO DE FOMENTO n° 040/2026. Repasse à OSC parceira para continuidade de programa social. ' +
      `Valor: R$ 200.000,00. CNPJ: ${CNPJ_OSC_A}. Secretaria Municipal de Assistência Social.`,
  ],
}

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeExtractEntitiesMock(override: Partial<ExtractedEntities> = {}) {
  return {
    name: 'extract_entities',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({
      data: {
        cnpjs: [CNPJ_OSC_A],
        values: [800000],
        dates: ['2026-04-10'],
        contractNumbers: [],
        secretaria: 'Secretaria Municipal de Assistência Social',
        actType: 'termo_fomento',
        supplier: 'Instituto Apoio Caxias',
        legalBasis: 'Lei 13.019/2014',
        subtype: null,
        ...override,
      } as ExtractedEntities,
      source: 'https://queridodiario.ok.org.br',
      confidence: 0.85,
    } as SkillResult<ExtractedEntities>),
  }
}

function makeQueryAlertsByCnpjMock(findings: Finding[] = []) {
  return jest.fn().mockResolvedValue(findings)
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
    now: () => new Date('2026-04-10T10:00:00.000Z'),
    extractEntities: makeExtractEntitiesMock(),
    queryAlertsByCnpj: makeQueryAlertsByCnpjMock([]),
    generateNarrative: makeGenerateNarrativeMock(),
    saveMemory: makeSaveMemoryMock(),
    ...overrides,
  }
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('fiscalConvenios', () => {
  // 1 — POSITIVO: termo de fomento R$ 800k sem chamamento → emite convenio_sem_chamamento
  it('1. positivo: termo de fomento R$ 800k sem chamamento → emite convenio_sem_chamamento', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [800000],
        cnpjs: [CNPJ_OSC_A],
        supplier: 'Instituto Apoio Caxias',
      }),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazConvenioSemChamamento,
      cityId: '4305108',
      context,
    })

    const semChamamento = findings.filter(f => f.type === 'convenio_sem_chamamento')
    expect(semChamamento).toHaveLength(1)
    expect(semChamamento[0].legalBasis).toBe('Lei 13.019/2014, Art. 24')
    expect(semChamamento[0].value).toBe(800000)
    expect(semChamamento[0].cnpj).toBe(CNPJ_OSC_A)
    expect(semChamamento[0].riskScore).toBeGreaterThanOrEqual(60)
  })

  // 2 — NEGATIVO: convênio R$ 750k COM chamamento público → não dispara
  it('2. negativo: convênio com chamamento público citado → nenhum convenio_sem_chamamento', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [750000],
        cnpjs: [CNPJ_OSC_B],
        supplier: 'Educar Caxias',
      }),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazConvenioComChamamento,
      cityId: '4305108',
      context,
    })

    const semChamamento = findings.filter(f => f.type === 'convenio_sem_chamamento')
    expect(semChamamento).toHaveLength(0)
  })

  // 3 — NEGATIVO: valor abaixo do limiar → não dispara
  it('3. negativo: convênio R$ 200k abaixo do limiar → nenhum finding', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [200000],
      }),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazConvenioBaixoValor,
      cityId: '4305108',
      context,
    })

    const semChamamento = findings.filter(f => f.type === 'convenio_sem_chamamento')
    expect(semChamamento).toHaveLength(0)
  })

  // 4 — EDGE: valor exatamente no limiar (R$ 600.000) → não dispara (estrito >)
  it('4. edge: valor exato R$ 600.000 no limiar → nenhum convenio_sem_chamamento', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [LEI_13019_CONVENIO_VALOR_REFERENCIA],
      }),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazConvenioExatoLimiar,
      cityId: '4305108',
      context,
    })

    const semChamamento = findings.filter(f => f.type === 'convenio_sem_chamamento')
    expect(semChamamento).toHaveLength(0)
  })

  // 5 — Acordo de cooperação puro (sem repasse) → fora de escopo
  it('5. acordo de cooperação sem repasse → não emite finding (fora de escopo)', async () => {
    const context = makeContext()

    const findings = await fiscalConvenios.analisar({
      gazette: gazAcordoCooperacao,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    // extractEntities NÃO deve ter sido chamado para acordo puro
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })

  // 6 — Filtro etapa 1: gazette sem termo de convênio → filtro retorna []
  it('6. filtro etapa 1: gazette sem termo de convênio → []', async () => {
    const context = makeContext()

    const findings = await fiscalConvenios.analisar({
      gazette: gazSemConvenio,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })

  // 7 — Convênio sem CNPJ → finding emitido SEM atributo cnpj (omissão, nunca null)
  it('7. sem CNPJ: convenio_sem_chamamento emitido sem atributo cnpj (omissão, nunca null)', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [], // sem CNPJ
        values: [700000],
        supplier: 'OSC Esportiva',
      }),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazConvenioSemCnpj,
      cityId: '4305108',
      context,
    })

    const semChamamento = findings.filter(f => f.type === 'convenio_sem_chamamento')
    expect(semChamamento).toHaveLength(1)
    // CRÍTICO: cnpj NÃO deve estar presente como null — deve estar ausente (LRN-019)
    expect('cnpj' in semChamamento[0]).toBe(false)
    expect(semChamamento[0].value).toBe(700000)
  })

  // 8 — Inexigibilidade Art. 30 → não dispara
  it('8. inexigibilidade Art. 30 fundamentada → não dispara convenio_sem_chamamento', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [900000],
        cnpjs: [CNPJ_OSC_A],
      }),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazConvenioInexigibilidade,
      cityId: '4305108',
      context,
    })

    const semChamamento = findings.filter(f => f.type === 'convenio_sem_chamamento')
    expect(semChamamento).toHaveLength(0)
  })

  // 9 — Repasse recorrente: 2 convênios anteriores ao mesmo CNPJ + atual = 3 → dispara
  it('9. repasse recorrente: 3 repasses ao mesmo CNPJ em 12 meses → emite repasse_recorrente_osc', async () => {
    const conveniosAnteriores: Finding[] = [
      {
        fiscalId: 'fiscal-convenios',
        cityId: '4305108',
        type: 'convenio_sem_chamamento',
        riskScore: 0,
        confidence: 0.85,
        evidence: [
          { source: 'https://queridodiario.ok.org.br', excerpt: 'convênio anterior 1', date: '2025-12-10' },
        ],
        narrative: '',
        legalBasis: 'Lei 13.019/2014, Art. 24',
        cnpj: CNPJ_OSC_A,
        value: 200000,
        ...(({ actType: 'convenio' }) as unknown as Record<string, unknown>),
      },
      {
        fiscalId: 'fiscal-convenios',
        cityId: '4305108',
        type: 'convenio_sem_chamamento',
        riskScore: 0,
        confidence: 0.85,
        evidence: [
          { source: 'https://queridodiario.ok.org.br', excerpt: 'convênio anterior 2', date: '2026-02-10' },
        ],
        narrative: '',
        legalBasis: 'Lei 13.019/2014, Art. 24',
        cnpj: CNPJ_OSC_A,
        value: 200000,
        ...(({ actType: 'convenio' }) as unknown as Record<string, unknown>),
      },
    ]

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [CNPJ_OSC_A],
        values: [200000],
        supplier: 'OSC Parceira',
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock(conveniosAnteriores),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazRepasseRecorrente,
      cityId: '4305108',
      context,
    })

    const recorrencias = findings.filter(f => f.type === 'repasse_recorrente_osc')
    expect(recorrencias).toHaveLength(1)
    expect(recorrencias[0].legalBasis).toBe('Lei 13.019/2014, Art. 33 e 35')
    expect(recorrencias[0].cnpj).toBe(CNPJ_OSC_A)
    expect(recorrencias[0].value).toBe(600000) // soma 200k * 3
  })

  // 10 — Não-recorrência: apenas 1 convênio anterior + atual = 2 → < mínimo (3) → não dispara
  it('10. não recorrência: 2 repasses < mínimo (3) → não emite repasse_recorrente_osc', async () => {
    const conveniosAnteriores: Finding[] = [
      {
        fiscalId: 'fiscal-convenios',
        cityId: '4305108',
        type: 'convenio_sem_chamamento',
        riskScore: 0,
        confidence: 0.85,
        evidence: [
          { source: 'https://queridodiario.ok.org.br', excerpt: 'convênio anterior', date: '2026-01-10' },
        ],
        narrative: '',
        legalBasis: 'Lei 13.019/2014, Art. 24',
        cnpj: CNPJ_OSC_A,
        value: 200000,
        ...(({ actType: 'convenio' }) as unknown as Record<string, unknown>),
      },
    ]

    expect(LEI_13019_REPASSE_RECORRENTE_MINIMO).toBe(3)

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [CNPJ_OSC_A],
        values: [200000],
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock(conveniosAnteriores),
    })

    const findings = await fiscalConvenios.analisar({
      gazette: gazRepasseRecorrente,
      cityId: '4305108',
      context,
    })

    const recorrencias = findings.filter(f => f.type === 'repasse_recorrente_osc')
    expect(recorrencias).toHaveLength(0)
  })

  // 11 — Linguagem factual: narrativa do fallback não contém termos acusatórios
  // Forçamos riskScore < 60 (confidence baixa + valor pouco acima do limiar)
  // para garantir que o fallback factual seja usado (sem chamada Bedrock).
  it('11. linguagem factual: narrativa fallback não contém termos acusatórios', async () => {
    const mockExtract = {
      name: 'extract_entities',
      description: 'mock',
      execute: jest.fn().mockResolvedValue({
        data: {
          cnpjs: [CNPJ_OSC_A],
          values: [600100], // ligeiramente acima do limiar de R$ 600.000
          dates: ['2026-04-10'],
          contractNumbers: [],
          secretaria: 'Secretaria Municipal de Assistência Social',
          actType: 'termo_fomento',
          supplier: 'Instituto Apoio Caxias',
          legalBasis: undefined,
          subtype: null,
        } as ExtractedEntities,
        source: 'https://queridodiario.ok.org.br',
        confidence: 0.10, // confiança muito baixa força riskScore < 60
      } as SkillResult<ExtractedEntities>),
    }

    const context: FiscalContext = {
      alertsTable: 'fiscal-digital-alerts-test',
      now: () => new Date('2026-04-10T10:00:00.000Z'),
      extractEntities: mockExtract,
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([]),
      saveMemory: makeSaveMemoryMock(),
      // generateNarrative NÃO injetado e riskScore < 60 → fallback factual
    }

    const findings = await fiscalConvenios.analisar({
      gazette: gazConvenioSemChamamento,
      cityId: '4305108',
      context,
    })

    const semChamamento = findings.filter(f => f.type === 'convenio_sem_chamamento')
    expect(semChamamento.length).toBeGreaterThanOrEqual(1)
    for (const f of semChamamento) {
      // Linguagem factual, sem termos acusatórios. Tom é validado por ausência
      // de termos vetados; abertura varia entre Haiku e fallback (LRN-20260509-005).
      expect(f.narrative).not.toMatch(/fraudou|desviou|corrup[ção]|ilícito|crim(?:e|inoso)|irregularidade comprovada/i)
      expect(f.narrative).toMatch(/Lei 13\.019\/2014/)
    }
  })

  // ── Regression tests do golden set fiscal-digital-evaluations (Ciclo 1+2) ──
  // ADR-001 — fiscal-convenios/ADR-001-contrato-repasse.md
  // 10 FPs originais (GS-017, GS-055..059, GS-094..097) sobre n=75 (universo
  // amostral de Convênios totalmente esgotado em prod).
  describe('regression tests (golden set FPs — ADR-001)', () => {
    function expectNoFinding(excerpt: string, label: string) {
      return async () => {
        const gazette: Gazette = { ...BASE_GAZETTE, id: `gs-${label}`, excerpts: [excerpt] }
        const findings = await fiscalConvenios.analisar({
          gazette,
          cityId: '4305108',
          context: makeContext(),
        })
        expect(findings).toHaveLength(0)
      }
    }

    it('GS-017: "convênio com a PUCC" (universidade — contraparte não-OSC)', expectNoFinding(
      'R$ 66.215.000,00. Considerando a necessidade de ajustar a execução orçamentária para prorrogação do convênio com a PUCC, conforme informações constantes no processo SEI nº PMC.2025.00061252-07/SMS. Crédito Suplementar.',
      '017',
    ))

    it('GS-055: "fonte: 0124 de convênio" (decreto orçamentário)', expectNoFinding(
      'O valor orçado na subação 1047 esta incluso a fonte: 0124 de convênio no valor de R$ 2.397.000,00 que teve somente 2% da sua execução. SEMDEC - Reforma Administrativa (Lei 076/2020).',
      '055',
    ))

    it('GS-056/GS-095: CONTRATO DE REPASSE Nº 909091/2020/MTUR/CAIXA', expectNoFinding(
      '13.392.1006.1070 AQUISIÇÃO, CONSTRUÇÃO E REFORMA DE BENS MÓVEIS E IMÓVEIS. 449051 OBRAS E INSTALAÇÕES. 05.100.563 GERAL - CONTRATO DE REPASSE Nº909091/2020/MTUR/CAIXA R$ 5.000.000,00. SECRETÁRIA MUNICIPAL DE INFRA ESTRUTURA.',
      '056',
    ))

    it('GS-057: CONTRATO DE REPASSE Nº 903505/2020/MDR/CAIXA', expectNoFinding(
      '15.451.3012.1118 AMPLIAR A MALHA VIÁRIA. 449051 OBRAS E INSTALAÇÕES. 05.100.503 GERAL CONTRATO DE REPASSE N° 903505/2020/MDR/CAIXA R$ 723.352,00. II - nos termos do artigo 4º, § 1º, inciso.',
      '057',
    ))

    it('GS-058: CONTRATO REPASSE Nº 903505/2020/MDR/CAIXA + crédito suplementar', expectNoFinding(
      'OBRAS E INSTALAÇÕES. 05.100.503 GERAL - CONTRATO REPASSE Nº903505/2020/MDR/CAIXA R$ 723.352,00. Artigo 2º - O Crédito aberto pelo artigo anterior será coberto com recurso. Lei 4.320 de 17/03/64.',
      '058',
    ))

    it('GS-059: Contrato de Repasse nº 907854/2020/MAPA/Caixa (texto narrativo)', expectNoFinding(
      'Comunicamos que a Caixa Econômica Federal efetuou, em 15 de junho de 2022, liberação de recurso financeiro ao Município de Caxias do Sul, no âmbito do Contrato de Repasse nº 907854/2020/MAPA/Caixa, para execução de pavimentação asfáltica em CBUQ na Estrada Municipal.',
      '059',
    ))

    it('GS-094: repasse em favor do Hospital Metropolitano Odilon Behrens (fundação pública)', expectNoFinding(
      'Fundo Municipal de Saúde – FMS – R$7.944.525,00. Despesa com pagamento de auxílio transporte no terceiro trimestre de 2024. Gastos com os contratos administrativos (CADM) e repasse em favor do Hospital Metropolitano Odilon Behrens.',
      '094',
    ))

    it('GS-096: "OSC que NÃO PODERÁ ter o Termo de Colaboração" (polaridade negativa)', expectNoFinding(
      'CRÉDITO SUPLEMENTAR, NO VALOR DE R$ 1.145.800,00. Considerando a necessidade de realizar a contratação de empresa destinada ao acolhimento de usuários de uma OSC que não poderá ter o Termo de Colaboração renovado em virtude de inadimplência.',
      '096',
    ))

    it('GS-097: CONTRATO REPASSE Nº 920231/2021/MCIDADANIA/CAIXA', expectNoFinding(
      'ADMINISTRAÇÃO REGIONAIS E SUB PREFEITURAS. 15.452.3017.1162 AQUISIÇÃO E REFORMA DE BENS MÓVEIS E IMÓVEIS. 449051 OBRAS E INSTALAÇÕES. 05.800.684 TUDEPI - CONTRATO REPASSE Nº920231/2021/MCIDADANIA/CAIXA R$ 2.500.000,00.',
      '097',
    ))

    // ── Padrões adicionais Ciclo 2 ──
    it('C2-FUNDACAO: Fundação Pública Universitária (contraparte não-OSC)', expectNoFinding(
      'Convênio entre o Município e a Fundação Universitária de Apoio ao Ensino - FUAE para programa de extensão acadêmica. Valor: R$ 800.000,00. Sem chamamento público (fundação pública está fora da Lei 13.019).',
      'c2-fundacao',
    ))

    it('C2-SANTA-CASA: Santa Casa (entidade filantrópica histórica — não-OSC)', expectNoFinding(
      'Convênio entre Município e Santa Casa de Misericórdia para apoio em saúde pública municipal. Valor: R$ 1.200.000,00. Pio Sodalício mantenedor.',
      'c2-santa-casa',
    ))

    it('C2-AUTARQUIA: autarquia municipal (administração indireta)', expectNoFinding(
      'Termo de Cooperação entre Município e autarquia municipal de água e saneamento para programa de regularização. Valor: R$ 500.000,00.',
      'c2-autarquia',
    ))
  })

  // 12 — Persistência: convenio é salvo com pk = CONVENIO#... e SEM null em GSI fields
  it('12. persistência: salvar convenio com pk CONVENIO# e omitir cnpj quando ausente', async () => {
    const saveMock = makeSaveMemoryMock()
    const context = makeContext({
      saveMemory: saveMock,
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [], // sem CNPJ
        values: [700000],
      }),
    })

    await fiscalConvenios.analisar({
      gazette: gazConvenioSemCnpj,
      cityId: '4305108',
      context,
    })

    const calls = (saveMock.execute as jest.Mock).mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const firstCall = calls[0][0] as { pk: string; item: Record<string, unknown> }
    expect(firstCall.pk).toMatch(/^CONVENIO#/)
    expect(firstCall.pk).toContain('NOCNPJ')
    // CRÍTICO: cnpj não deve estar presente como null no item gravado
    expect('cnpj' in firstCall.item).toBe(false)
    expect(firstCall.item.actType).toBe('convenio')
  })
})
