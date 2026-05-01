import { fiscalLicitacoes } from '../licitacoes'
import { LEI_14133_ART_75_I_LIMITE, LEI_14133_ART_75_II_LIMITE } from '../legal-constants'
import type { FiscalContext } from '../types'
import type { Finding, SkillResult, ExtractedEntities } from '../../types'
import {
  gazetteDispensaServicoAcimaTeto,
  gazetteDispensaServicoAbaixoTeto,
  gazetteDispensaServicoExatoTeto,
  gazetteDispensaServico1CentavoAcima,
  gazetteDispensaObraAcimaTeto,
  gazetteDispensaObraAbaixoTetoI,
  gazetteNomeacao,
  gazetteDispensaFracionamento,
  gazetteDispensaNaoFracionamento,
  gazetteDispensaBaixoRisco,
  gazetteDispensaReformaEquipamento,
  gazetteDispensaObraFallbackRegex,
} from './fixtures'

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeExtractEntitiesMock(override: Partial<ExtractedEntities> = {}) {
  return {
    name: 'extract_entities',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({
      data: {
        cnpjs: ['12.345.678/0001-90'],
        values: [80000],
        dates: ['2026-03-15'],
        contractNumbers: [],
        secretaria: 'Secretaria Municipal de Administração',
        actType: 'dispensa',
        supplier: 'Tech Solutions LTDA',
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
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

// Contexto base com mocks — sem AWS real, sem Anthropic real
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

describe('fiscalLicitacoes', () => {
  // Caso 1 — Dispensa serviço R$ 80.000 → dispensa_irregular, inciso II
  it('1. positivo II: dispensa serviço R$ 80k → emite dispensa_irregular com inciso II', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [80000],
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaServicoAcimaTeto,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('dispensa_irregular')
    expect(findings[0].legalBasis).toBe('Lei 14.133/2021, Art. 75, II')
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(60)
    expect(findings[0].value).toBe(80000)
  })

  // Caso 2 — Dispensa serviço R$ 30.000 → []
  it('2. negativo II: dispensa serviço R$ 30k → nenhum finding', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [30000],
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaServicoAbaixoTeto,
      cityId: '4305108',
      context,
    })

    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')
    expect(dispensa_irregular).toHaveLength(0)
  })

  // Caso 3 — Edge: teto exato II R$ 65.492,11 → []
  it('3. edge teto exato II: R$ 65.492,11 → nenhuma dispensa_irregular', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [LEI_14133_ART_75_II_LIMITE],
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaServicoExatoTeto,
      cityId: '4305108',
      context,
    })

    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')
    expect(dispensa_irregular).toHaveLength(0)
  })

  // Caso 4 — Edge: 1 centavo acima do teto II → emite Finding
  it('4. edge 1 centavo acima do teto II: R$ 65.492,12 → emite dispensa_irregular', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [65492.12],
        legalBasis: 'Art. 75',
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaServico1CentavoAcima,
      cityId: '4305108',
      context,
    })

    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')
    expect(dispensa_irregular).toHaveLength(1)
    expect(dispensa_irregular[0].riskScore).toBeGreaterThanOrEqual(60)
  })

  // Caso 5 — Obra R$ 150.000 → emite Finding com inciso I
  it('5. positivo I (obra): dispensa reforma R$ 150k → emite dispensa_irregular com inciso I', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [150000],
        legalBasis: 'Lei 14.133/2021, Art. 75, I',
        subtype: 'obra_engenharia',
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaObraAcimaTeto,
      cityId: '4305108',
      context,
    })

    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')
    expect(dispensa_irregular).toHaveLength(1)
    expect(dispensa_irregular[0].legalBasis).toBe('Lei 14.133/2021, Art. 75, I')
    expect(dispensa_irregular[0].value).toBe(150000)
    // Teto I = 130984.20, o valor excede este limite
    expect(dispensa_irregular[0].value!).toBeGreaterThan(LEI_14133_ART_75_I_LIMITE)
  })

  // Caso 6 — Obra de pavimentação R$ 125.000 → [] (abaixo do teto I, classificado corretamente)
  it('6. negativo I: obra de pavimentação R$ 125k → nenhuma dispensa_irregular (abaixo teto I)', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        values: [125000],
        legalBasis: 'Lei 14.133/2021, Art. 75, I',
        subtype: 'obra_engenharia',
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaObraAbaixoTetoI,
      cityId: '4305108',
      context,
    })

    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')
    expect(dispensa_irregular).toHaveLength(0)
  })

  // Caso 7 — Gazette sem dispensa (nomeação) → []
  it('7. sem dispensa: gazette de nomeação → filtro etapa 1 retorna []', async () => {
    const context = makeContext()

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteNomeacao,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
    // extractEntities nunca deve ter sido chamado (filtro etapa 1)
    const execMock = context.extractEntities?.execute as jest.Mock | undefined
    expect(execMock?.mock.calls ?? []).toHaveLength(0)
  })

  // Caso 8 — Fracionamento: 2 dispensas R$ 25k + atual R$ 25k = R$ 75k > teto II
  it('8. fracionamento: 2 dispensas anteriores R$ 25k + atual R$ 25k → emite fracionamento', async () => {
    const cnpjFracionamento = '77.888.999/0001-11'

    const dispensasAnteriores: Finding[] = [
      {
        fiscalId: FISCAL_ID,
        cityId: '4305108',
        type: 'dispensa_irregular',
        riskScore: 0,
        confidence: 0.85,
        evidence: [{ source: 'https://queridodiario.ok.org.br', excerpt: 'dispensa anterior 1', date: '2026-01-10' }],
        narrative: '',
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
        cnpj: cnpjFracionamento,
        value: 25000,
        // actType como campo extra — simula o item DynamoDB
        ...(({ actType: 'dispensa' }) as unknown as Record<string, unknown>),
      },
      {
        fiscalId: FISCAL_ID,
        cityId: '4305108',
        type: 'dispensa_irregular',
        riskScore: 0,
        confidence: 0.85,
        evidence: [{ source: 'https://queridodiario.ok.org.br', excerpt: 'dispensa anterior 2', date: '2026-02-20' }],
        narrative: '',
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
        cnpj: cnpjFracionamento,
        value: 25000,
        ...(({ actType: 'dispensa' }) as unknown as Record<string, unknown>),
      },
    ]

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpjFracionamento],
        values: [25000],
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock(dispensasAnteriores),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaFracionamento,
      cityId: '4305108',
      context,
    })

    const fracionamentos = findings.filter(f => f.type === 'fracionamento')
    expect(fracionamentos).toHaveLength(1)
    expect(fracionamentos[0].legalBasis).toBe('Lei 14.133/2021, Art. 75, §1º')
    expect(fracionamentos[0].value).toBe(75000) // soma total
  })

  // Caso 9 — Não-fracionamento: 1 dispensa anterior R$ 25k + atual R$ 25k = R$ 50k < teto II
  it('9. não-fracionamento: 1 dispensa anterior R$ 25k + atual R$ 25k = R$ 50k → sem fracionamento', async () => {
    const cnpjNaoFracionamento = '88.999.000/0001-22'

    const dispensaAnterior: Finding[] = [
      {
        fiscalId: FISCAL_ID,
        cityId: '4305108',
        type: 'dispensa_irregular',
        riskScore: 0,
        confidence: 0.85,
        evidence: [{ source: 'https://queridodiario.ok.org.br', excerpt: 'dispensa anterior', date: '2026-01-15' }],
        narrative: '',
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
        cnpj: cnpjNaoFracionamento,
        value: 25000,
        ...(({ actType: 'dispensa' }) as unknown as Record<string, unknown>),
      },
    ]

    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: [cnpjNaoFracionamento],
        values: [25000],
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
      }),
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock(dispensaAnterior),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaNaoFracionamento,
      cityId: '4305108',
      context,
    })

    const fracionamentos = findings.filter(f => f.type === 'fracionamento')
    expect(fracionamentos).toHaveLength(0)
  })

  // Caso 10 — Linguagem factual: riskScore < 60 → template sem LLM, sem "fraudou", "desviou"
  it('10. linguagem factual: narrativa de baixo risco não contém termos acusatórios', async () => {
    // Para forçar riskScore < 60: valor muito próximo ao teto (pouco excesso) + confiança baixa
    // R$ 65.500 = excesso de ~0.01% sobre teto II → excede_teto value ~= 60.01 * 0.6 = 36
    // confidence 0.2 → confianca_extracao: 20 * 0.2 = 4
    // base_legal_citada: sem 14.133 e 75 → 50 * 0.2 = 10
    // riskScore total = (36 + 4 + 10) = 50 < 60
    const mockExtract = {
      name: 'extract_entities',
      description: 'mock',
      execute: jest.fn().mockResolvedValue({
        data: {
          cnpjs: ['99.000.111/0001-33'],
          values: [65500],
          dates: ['2026-03-15'],
          contractNumbers: [],
          secretaria: 'Secretaria Municipal de Relações Internacionais',
          actType: 'dispensa',
          supplier: 'Traduções BR LTDA',
          legalBasis: undefined,  // sem base legal → legalBasisCitada = 50
          subtype: null,
        } as ExtractedEntities,
        source: 'https://queridodiario.ok.org.br',
        confidence: 0.20,  // confiança baixa → riskScore mais baixo
      } as SkillResult<ExtractedEntities>),
    }

    const context: FiscalContext = {
      alertsTable: 'fiscal-digital-alerts-test',
      now: () => new Date('2026-03-15T10:00:00.000Z'),
      extractEntities: mockExtract,
      queryAlertsByCnpj: makeQueryAlertsByCnpjMock([]),
      saveMemory: makeSaveMemoryMock(),
      // generateNarrative NÃO injetado — não deve ser chamado para riskScore < 60
    }

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaBaixoRisco,
      cityId: '4305108',
      context,
    })

    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')

    // Verificar que não há termos acusatórios
    for (const finding of dispensa_irregular) {
      expect(finding.narrative).not.toMatch(/fraudou|desviou|corrup[ção]|ilícito|irregularidade comprovada/i)
      // Verificar linguagem factual
      expect(finding.narrative).toMatch(/[Ii]dentificamos/)
      // Verificar menção ao limite legal
      expect(finding.narrative).toMatch(/limite legal/)
      expect(finding.narrative).toMatch(/Lei 14\.133\/2021/)
    }
  })

  // Caso 11 — "reforma de equipamento" R$ 80k com subtype='compra' → dispensa_irregular inciso II
  // Resolve falso negativo histórico: antes do MIT-01, "reforma" disparava OBRA_RE → inciso I (teto
  // maior, R$ 130k) → valor R$ 80k não excedia o teto → nenhum alerta. Agora o Haiku classifica
  // corretamente como 'compra' → inciso II (teto R$ 65.492,11) → dispara dispensa_irregular.
  it('11. subtype compra: reforma de equipamento R$ 80k → dispensa_irregular inciso II (falso negativo resolvido)', async () => {
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['55.444.333/0001-22'],
        values: [80000],
        legalBasis: 'Lei 14.133/2021, Art. 75, II',
        subtype: 'compra',
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaReformaEquipamento,
      cityId: '4305108',
      context,
    })

    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')
    expect(dispensa_irregular).toHaveLength(1)
    expect(dispensa_irregular[0].legalBasis).toBe('Lei 14.133/2021, Art. 75, II')
    expect(dispensa_irregular[0].value).toBe(80000)
    expect(dispensa_irregular[0].value!).toBeGreaterThan(LEI_14133_ART_75_II_LIMITE)
  })

  // Caso 12 — sem subtype (Haiku retornou null) + excerpt contendo "obra" → fallback regex → inciso I
  it('12. fallback regex: subtype null + excerpt com "obra" → classificado como inciso I via OBRA_RE', async () => {
    // Valor R$ 120k: abaixo teto I (R$ 130.984,20) → nenhuma dispensa_irregular
    // Se fallback falhar e usar inciso II, R$ 120k > R$ 65.492,11 → geraria falso positivo
    const context = makeContext({
      extractEntities: makeExtractEntitiesMock({
        cnpjs: ['11.222.333/0001-44'],
        values: [120000],
        legalBasis: 'Lei 14.133/2021, Art. 75, I',
        subtype: null,
      }),
    })

    const findings = await fiscalLicitacoes.analisar({
      gazette: gazetteDispensaObraFallbackRegex,
      cityId: '4305108',
      context,
    })

    // R$ 120k < teto I (R$ 130.984,20) → sem dispensa_irregular (fallback corretamente aplicou inciso I)
    const dispensa_irregular = findings.filter(f => f.type === 'dispensa_irregular')
    expect(dispensa_irregular).toHaveLength(0)
  })
})

// Variável dummy para evitar erro no teste 8 (actType como campo extra)
const FISCAL_ID = 'fiscal-licitacoes'
