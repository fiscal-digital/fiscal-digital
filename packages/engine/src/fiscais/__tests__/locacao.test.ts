import { fiscalLocacao } from '../locacao'
import type { FiscalContext } from '../types'
import type { Gazette, SkillResult, ExtractedEntities } from '../../types'

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeExtractEntitiesMock(override: Partial<ExtractedEntities> = {}) {
  return {
    name: 'extract_entities',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({
      data: {
        cnpjs: ['12.345.678/0001-90'],
        values: [25000],
        dates: ['2026-04-10'],
        contractNumbers: [],
        secretaria: 'Secretaria Municipal de Administração',
        actType: 'inexigibilidade',
        supplier: 'Imobiliária Centro LTDA',
        legalBasis: 'Lei 14.133/2021, Art. 74, III',
        subtype: null,
        ...override,
      } as ExtractedEntities,
      source: 'https://queridodiario.ok.org.br',
      confidence: 0.85,
    } as SkillResult<ExtractedEntities>),
  }
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

function makeGenerateNarrativeMock(text = 'Narrativa mock gerada.') {
  return jest.fn().mockResolvedValue(text)
}

function makeContext(overrides: Partial<FiscalContext> = {}): FiscalContext {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-04-10T10:00:00.000Z'),
    extractEntities: makeExtractEntitiesMock(),
    saveMemory: makeSaveMemoryMock(),
    generateNarrative: makeGenerateNarrativeMock(),
    ...overrides,
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_GAZETTE: Gazette = {
  id: 'gazette-locacao-001',
  territory_id: '4305108',
  date: '2026-04-10',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=loc',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

// 1. Locação SEM laudo nem justificativa → dispara
const gazetteLocacaoSemLaudo: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-001',
  excerpts: [
    'INEXIGIBILIDADE DE LICITAÇÃO n° 008/2026. Objeto: locação de imóvel destinado ao funcionamento da Secretaria Municipal de Cultura. Valor mensal: R$ 18.000,00. Locador: Imobiliária Centro LTDA, CNPJ: 12.345.678/0001-90. Base Legal: Lei 14.133/2021, Art. 74, III.',
  ],
}

// 2. Locação COM laudo e justificativa → NÃO dispara
const gazetteLocacaoComLaudo: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-002',
  excerpts: [
    'INEXIGIBILIDADE DE LICITAÇÃO n° 009/2026. Objeto: locação de imóvel para a Secretaria Municipal de Saúde. Valor mensal: R$ 12.000,00. Laudo de avaliação prévia anexo. Justificativa da escolha: única edificação na região com acesso PNE. Locador: Imobiliária Sul LTDA, CNPJ: 22.333.444/0001-55. Base Legal: Lei 14.133/2021, Art. 74, III.',
  ],
}

// 3. Locação SEM laudo e valor anual ALTO (R$ 30k/mês = R$ 360k/ano) → dispara com risco maior
const gazetteLocacaoValorAlto: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-003',
  excerpts: [
    'INEXIGIBILIDADE DE LICITAÇÃO n° 010/2026. Objeto: locação de imóvel para sede administrativa. Valor mensal: R$ 30.000,00. Locador: Empreendimentos JK LTDA, CNPJ: 33.444.555/0001-66. Base Legal: Art. 74.',
  ],
}

// 4. Locação SEM laudo e valor BAIXO (R$ 5k/mês = R$ 60k/ano) → dispara mas riskScore na faixa baixa
const gazetteLocacaoValorBaixo: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-004',
  excerpts: [
    'INEXIGIBILIDADE DE LICITAÇÃO n° 011/2026. Objeto: locação de pequeno imóvel para arquivo público. Valor mensal: R$ 5.000,00. Locador: Imóveis Caxias LTDA, CNPJ: 44.555.666/0001-77. Base Legal: Lei 14.133/2021, Art. 74.',
  ],
}

// 5. Locação SEM valor extraído → dispara mas com confidence/risk reduzidos
const gazetteLocacaoSemValor: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-005',
  excerpts: [
    'INEXIGIBILIDADE DE LICITAÇÃO. Objeto: locação de imóvel para abrigo temporário. Locador: Fundação Caxias do Sul. Base Legal: Art. 74.',
  ],
}

// 6. Gazette sem locação (nomeação) → filtro etapa 1 retorna []
const gazetteNomeacao: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-006',
  excerpts: [
    'PORTARIA n° 145/2026. NOMEIA o servidor João da Silva para o cargo de Diretor de Departamento, junto à Secretaria Municipal de Administração.',
  ],
}

// 7. Locação anual explícita acima do piso (R$ 300.000/ano) sem laudo → dispara
const gazetteLocacaoAnualAlto: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-007',
  excerpts: [
    'INEXIGIBILIDADE DE LICITAÇÃO n° 012/2026. Objeto: locação de imóvel para Secretaria de Educação. Valor anual: R$ 300.000,00. Locador: Real Estate LTDA, CNPJ: 55.666.777/0001-88. Base Legal: Lei 14.133/2021, Art. 74, III.',
  ],
}

// 8. "aluguel" sinônimo + "imóvel" → dispara via regex sem a palavra "locação"
const gazetteAluguelImovel: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-008',
  excerpts: [
    'INEXIGIBILIDADE n° 013/2026. Objeto: aluguel de imóvel para depósito de materiais escolares. Valor mensal: R$ 8.000,00. Locador: Galpões Sul LTDA, CNPJ: 66.777.888/0001-99. Base Legal: Art. 74.',
  ],
}

// 9. Apenas "locação de equipamento" — sem imóvel → NÃO dispara (filtro etapa 1)
const gazetteLocacaoEquipamento: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-009',
  excerpts: [
    'CONTRATAÇÃO n° 050/2026. Objeto: locação de equipamentos de informática para nova unidade escolar. Valor: R$ 45.000,00. CNPJ: 77.888.999/0001-11.',
  ],
}

// 10. Locação SEM laudo e CITA "valor de mercado" → NÃO dispara (validação satisfeita)
const gazetteLocacaoValorMercado: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-locacao-010',
  excerpts: [
    'INEXIGIBILIDADE n° 014/2026. Objeto: locação de imóvel para arquivo central. Valor mensal: R$ 10.000,00, compatível com valor de mercado da região. Locador: Imobiliária Norte LTDA, CNPJ: 88.999.000/0001-22. Base Legal: Lei 14.133/2021, Art. 74, III.',
  ],
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('fiscalLocacao', () => {
  it('1. positivo: locação SEM laudo nem justificativa → dispara locacao_sem_justificativa', async () => {
    const context = makeContext()
    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoSemLaudo,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('locacao_sem_justificativa')
    expect(findings[0].legalBasis).toBe('Lei 14.133/2021, Art. 74, III')
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(55)
    expect(findings[0].riskScore).toBeLessThanOrEqual(85)
    expect(findings[0].cnpj).toBe('12.345.678/0001-90')
  })

  it('2. negativo: locação COM laudo e justificativa → não dispara', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['22.333.444/0001-55'],
        values: [12000],
        supplier: 'Imobiliária Sul LTDA',
      }),
    })

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoComLaudo,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
  })

  it('3. valor alto: R$ 30k/mês (R$ 360k/ano) → dispara e riskScore acima da faixa base', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['33.444.555/0001-66'],
        values: [30000],
        supplier: 'Empreendimentos JK LTDA',
      }),
    })

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoValorAlto,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('locacao_sem_justificativa')
    // valor acima do piso → permite passar de 70 para até 85
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(60)
    expect(findings[0].riskScore).toBeLessThanOrEqual(85)
    expect(findings[0].value).toBe(30000)
  })

  it('4. valor baixo: R$ 5k/mês (R$ 60k/ano) → dispara, mas riskScore clampado em 55-70', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['44.555.666/0001-77'],
        values: [5000],
        supplier: 'Imóveis Caxias LTDA',
      }),
    })

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoValorBaixo,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(55)
    expect(findings[0].riskScore).toBeLessThanOrEqual(70)
    expect(findings[0].value).toBe(5000)
  })

  it('5. sem valor extraído: dispara com value undefined e confidence menor', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [],
        values: [],
        supplier: 'Fundação Caxias do Sul',
      }),
    })

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoSemValor,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].value).toBeUndefined()
    // sem cnpj nem valor → confidence cai
    expect(findings[0].confidence).toBeLessThanOrEqual(0.65)
    // riskScore ainda dentro da faixa indiciária
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(55)
    expect(findings[0].riskScore).toBeLessThanOrEqual(70)
  })

  it('6. sem locação: gazette de nomeação → filtro etapa 1 retorna [] e não chama LLM', async () => {
    const context = makeContext()

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteNomeacao,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })

  it('7. valor anual explícito > piso (R$ 300k/ano) → dispara com value=300000', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['55.666.777/0001-88'],
        values: [300000],
        supplier: 'Real Estate LTDA',
      }),
    })

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoAnualAlto,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].value).toBe(300000)
    // > R$ 240k/ano de piso → faixa elevada
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(60)
  })

  it('8. sinônimo "aluguel": aluguel de imóvel → dispara via filtro regex', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['66.777.888/0001-99'],
        values: [8000],
        supplier: 'Galpões Sul LTDA',
      }),
    })

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteAluguelImovel,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('locacao_sem_justificativa')
  })

  it('9. locação de equipamento (sem imóvel) → NÃO dispara', async () => {
    const context = makeContext()

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoEquipamento,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })

  it('10. cita "valor de mercado" → validação satisfeita, NÃO dispara', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['88.999.000/0001-22'],
        values: [10000],
        supplier: 'Imobiliária Norte LTDA',
      }),
    })

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoValorMercado,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
  })

  it('11. linguagem factual: narrativa template não contém termos acusatórios', async () => {
    // Forçar riskScore < 60 (faixa baixa) para usar o template factual
    // sem laudo + valor baixo + confidence baixa → narrativa template factual
    const context: FiscalContext = {
      alertsTable: 'fiscal-digital-alerts-test',
      now: () => new Date('2026-04-10T10:00:00.000Z'),
      extractEntities: {
        name: 'extract_entities',
        description: 'mock',
        execute: jest.fn().mockResolvedValue({
          data: {
            cnpjs: ['44.555.666/0001-77'],
            values: [5000],
            dates: [],
            contractNumbers: [],
            secretaria: 'Secretaria Municipal de Cultura',
            actType: 'inexigibilidade',
            supplier: 'Imóveis Caxias LTDA',
            legalBasis: undefined,
            subtype: null,
          } as ExtractedEntities,
          source: 'https://queridodiario.ok.org.br',
          confidence: 0.20,
        } as SkillResult<ExtractedEntities>),
      },
      saveMemory: makeSaveMemoryMock(),
      // generateNarrative NÃO injetado — não deve ser chamado para riskScore < 60
    }

    const findings = await fiscalLocacao.analisar({
      gazette: gazetteLocacaoValorBaixo,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    // Linguagem factual + base legal citada (LRN-20260509-005 — não fixa abertura).
    expect(finding.narrative).not.toMatch(
      /fraudou|desviou|corrup[ção]|ilícito|irregularidade comprovada/i,
    )
    expect(finding.narrative).toMatch(/Lei 14\.133\/2021/)
    expect(finding.narrative).toMatch(/Art\.\s*74/)
  })

  // ── Regression tests do golden set fiscal-digital-evaluations (Ciclo 1+2) ──
  // ADR-001 — fiscal-locacao/ADR-001-overmatch.md
  // Padrões identificados nos 10 FPs originais (GS-018, GS-060..064, GS-098..101)
  // + padrões adicionais descobertos no Ciclo 2 (n=250) e Ciclo 3 (n=476).
  // Todos devem retornar `no_finding` sem invocar a Camada 2 (extract_entities).

  describe('regression tests (golden set FPs — ADR-001)', () => {
    function expectNoFinding(excerpt: string, label: string) {
      return async () => {
        const context = makeContext()
        const findings = await fiscalLocacao.analisar({
          gazette: { ...BASE_GAZETTE, id: `gs-${label}`, excerpts: [excerpt] },
          cityId: '4305108',
          context,
        })
        expect(findings).toHaveLength(0)
        const execMock = context.extractEntities?.execute as jest.Mock | undefined
        expect(execMock?.mock.calls ?? []).toHaveLength(0)
      }
    }

    it('GS-018: Termo Aditivo nº 2 prorrogando contrato existente', expectNoFinding(
      'Interveniente: IMOBILIÁRIA BASSANESI LTDA. Objeto: Termo Aditivo nº 2 ao Contrato nº 2019/747, celebrado para prorrogar o prazo de vigência contratual de 20/03/2021 até 31/12/2021, tendo por objeto a locação de imóvel para a Secretaria.',
      '018',
    ))

    it('GS-060: cláusulas contratuais listadas (manutenção do imóvel)', expectNoFinding(
      'III - manutenção do imóvel nas condições em que foi recebido. IV - arcar com todas as despesas decorrentes de eventuais danos causados ao imóvel objeto do contrato de locação; V - adequar a data do vencimento do pagamento do aluguel à data do recebimento.',
      '060',
    ))

    it('GS-061: EXTRATO DE RESCISÃO de locação', expectNoFinding(
      'EXTRATO DE RESCISÃO PROCESSO: 4/5311/2013 CONTRATO: 001/SEMAD/2014 LOCATÁRIO: Sr. JOÃO LUIZ GONÇALVES GATTO OBJETO: Locação do Imóvel na Avenida Florípes Rocha, nº 380, Loja 02 e 03, Centro, Belford Roxo. FUNDAMENTAÇÃO LEGAL: As partes acordam em rescindir.',
      '061',
    ))

    it('GS-062: Portaria designando Gestor/Fiscal de Contrato de Locação', expectNoFinding(
      'DESIGNAR Servidor matrícula nº 9.902-6, GESTOR, e MARILEIDE PONTES DA SILVA, matrícula nº 17.226-0, FISCAL, lotados na Secretaria da Administração, para acompanhar e fiscalizar o contrato de Locação de Imóvel para funcionamento da Junta Médica.',
      '062',
    ))

    it('GS-063: Decreto regulamenta apresentação de cópia do contrato de locação', expectNoFinding(
      'Art. 5º O contribuinte deverá obedecer ao cronograma constante do Anexo deste Decreto e apresentar os seguintes documentos perante a Plataforma de Atendimento: I – cópia do contrato de locação ou de documento similar que comprove a utilização do imóvel por terceiro; II – comprovante de pagamento. Este decreto regulamenta o IPTU.',
      '063',
    ))

    it('GS-064: designação de Gestor/Fiscal de Contrato de Locação existente', expectNoFinding(
      'designar o servidor LUIZ CARLOS, matrícula nº 30.999, como Gestor de Contrato e Rosângela Pereira Marvila, matrícula nº 41.112, Coordenadora de Proteção de Média Complexidade, para atuar como Fiscal de Contrato, no que se refere a Locação de Imóvel referente ao Contrato nº 006L/2022.',
      '064',
    ))

    it('GS-098: Aviso de Procura / Edital de Chamamento para locação', expectNoFinding(
      'AVISO DE PROCURA — A Prefeitura comunica interesse em proposta para locação de imóvel devidamente transcrito pelo Registro de Imóveis, assim como os demais elementos necessários a aprovação de sua proposta e formalização de contrato de locação quais sejam: RG, CPF, comprovante de residência atualizado, como também CND.',
      '098',
    ))

    it('GS-099: Pregão Eletrônico para locação (modalidade competitiva)', expectNoFinding(
      'CONTRATO Nº 558/23 DATA: 17/10/2023 PARTES: MUNICÍPIO DE SÃO JOSÉ DOS CAMPOS. Modalidade: Pregão Eletrônico nº 045/2023. Objeto: locação de imóvel residencial. Assinatura do proprietário do imóvel da CGEE — Divisão de Formalização e Atos.',
      '099',
    ))

    it('GS-100: RATIFICO a renovação do contrato de locação', expectNoFinding(
      'à vista das manifestações da Secretaria de Justiça (docs. 3241406 e 3243676), RATIFICO a renovação do contrato de locação celebrado entre o Município de Campinas e o Sr. Edson Luiz Del Grande Silva, vigente até 31/12/2024.',
      '100',
    ))

    it('GS-101: ANEXO de Portaria com rol CONTRATO FORNECEDOR (cross-block)', expectNoFinding(
      'Art. 3º Esta Portaria entra em vigor na data de sua publicação, revogadas as disposições em contrário. ANEXO CONTRATO FORNECEDOR OBJETO 036/2020 T.L.S EMPREENDIMENTOS IMOBILIÁRIOS LTDA LOCAÇÃO DE IMÓVEL para arquivo.',
      '101',
    ))

    // ── Padrões adicionais Ciclo 2 (n=250) ──
    it('C2-LEI-13303: estatal (Lei 13.303/2016 regime próprio)', expectNoFinding(
      'A COMPANHIA MUNICIPAL DE TRANSPORTES, com base na Lei 13.303/2016 Art. 29, contrata locação de imóvel para garagem operacional. Valor mensal: R$ 18.000,00. Fundamentação: regulamento próprio da empresa pública.',
      'c2-13303',
    ))

    it('C2-FOMENTO: Termo de Fomento Lei 13.019 confundido com locação', expectNoFinding(
      'EXTRATO DE TERMO DE FOMENTO Nº 014/2026. OBJETO: parceria com OSC para apoio a famílias em situação de vulnerabilidade que precisem de locação de imóvel emergencial. Base legal: Lei 13.019/2014.',
      'c2-fomento',
    ))

    it('C2-SUMULA: SÚMULA DE CONTRATOS (cross-block matching)', expectNoFinding(
      'SÚMULA DE CONVÊNIOS E CONTRATOS — Contratante: Município. Contratado: MITRA DIOCESANA. Objeto: Termo de Cooperação para uso de espaço — referência genérica a locação de imóvel parcial.',
      'c2-sumula',
    ))

    it('C2-COMPETITIVA: Pregão Eletrônico para locação de imóvel (modalidade fora de escopo)', expectNoFinding(
      'AVISO DE LICITAÇÃO — Pregão Eletrônico nº 215/2026. Modalidade: Pregão Eletrônico. Objeto: locação de imóvel para depósito de materiais escolares. Cidade: Caxias do Sul.',
      'c2-competitiva',
    ))
  })

  it('12. GSI keys: nunca grava NULL em cnpj/secretaria — campos omitidos quando ausentes (LRN-019)', async () => {
    const saveMemoryMock = makeSaveMemoryMock()
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [],
        values: [],
        secretaria: undefined,
        supplier: undefined,
      }),
      saveMemory: saveMemoryMock,
    })

    await fiscalLocacao.analisar({
      gazette: gazetteLocacaoSemValor,
      cityId: '4305108',
      context,
    })

    // saveMemory deve ter sido chamado (persistência de histórico de locação)
    expect(saveMemoryMock.execute).toHaveBeenCalledTimes(1)
    const callArg = saveMemoryMock.execute.mock.calls[0][0]
    expect(callArg.item).toBeDefined()
    // GSI keys devem estar AUSENTES — nunca null
    expect('cnpj' in callArg.item).toBe(false)
    expect('secretaria' in callArg.item).toBe(false)
    expect(callArg.item.cnpj).toBeUndefined()
    expect(callArg.item.secretaria).toBeUndefined()
  })
})
