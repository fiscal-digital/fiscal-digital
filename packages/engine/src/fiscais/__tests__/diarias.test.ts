import {
  fiscalDiarias,
  parseDataBR,
  isFimDeSemana,
  isFeriadoNacional,
  DIARIA_VALOR_LIMITE,
  FERIADOS_NACIONAIS,
} from '../diarias'
import type { FiscalContext } from '../types'
import type { Gazette, SkillResult } from '../../types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const noopSaveMemory = {
  name: 'save_memory',
  description: 'mock',
  async execute(_input: { pk: string; table: string; item: Record<string, unknown> }) {
    return {
      data: { ok: true },
      source: 'internal:mock',
      confidence: 1.0,
    } as SkillResult<{ ok: true }>
  },
} as unknown as FiscalContext['saveMemory']

function makeContext(overrides: Partial<FiscalContext> = {}): FiscalContext {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-05-10T10:00:00.000Z'),
    saveMemory: noopSaveMemory,
    ...overrides,
  }
}

const BASE_GAZETTE: Gazette = {
  id: 'gazette-diarias-base',
  territory_id: '4305108',
  date: '2026-05-12',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=diarias-test',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

function gazetteWith(id: string, date: string, excerpt: string): Gazette {
  return { ...BASE_GAZETTE, id, date, excerpts: [excerpt] }
}

// ─── Helpers de testes diretos ────────────────────────────────────────────────

describe('parseDataBR', () => {
  it('parseia DD/MM/YYYY válida', () => {
    expect(parseDataBR('15', '08', '2026')).toBe('2026-08-15')
  })
  it('parseia DD/MM/YY assumindo 20YY', () => {
    expect(parseDataBR('05', '04', '26')).toBe('2026-04-05')
  })
  it('rejeita mês inválido', () => {
    expect(parseDataBR('05', '13', '2026')).toBeNull()
  })
  it('rejeita ano fora do intervalo', () => {
    expect(parseDataBR('01', '01', '1999')).toBeNull()
    expect(parseDataBR('01', '01', '2100')).toBeNull()
  })
})

describe('isFimDeSemana', () => {
  it('detecta sábado', () => {
    // 2026-05-09 é um sábado
    expect(isFimDeSemana('2026-05-09')).toBe(true)
  })
  it('detecta domingo', () => {
    // 2026-05-10 é um domingo
    expect(isFimDeSemana('2026-05-10')).toBe(true)
  })
  it('rejeita dia útil', () => {
    // 2026-05-11 é uma segunda-feira
    expect(isFimDeSemana('2026-05-11')).toBe(false)
    // 2026-05-13 é uma quarta-feira
    expect(isFimDeSemana('2026-05-13')).toBe(false)
  })
})

describe('isFeriadoNacional', () => {
  it('detecta feriado fixo (Tiradentes)', () => {
    expect(isFeriadoNacional('2026-04-21')).toBe(true)
  })
  it('detecta feriado fixo (Natal)', () => {
    expect(isFeriadoNacional('2026-12-25')).toBe(true)
  })
  it('detecta feriado variável (Sexta da Paixão 2026)', () => {
    expect(isFeriadoNacional('2026-04-03')).toBe(true)
  })
  it('detecta feriado variável (Carnaval 2025)', () => {
    expect(isFeriadoNacional('2025-03-04')).toBe(true)
  })
  it('detecta feriado variável (Corpus Christi 2027)', () => {
    expect(isFeriadoNacional('2027-05-27')).toBe(true)
  })
  it('rejeita data não-feriado', () => {
    expect(isFeriadoNacional('2026-04-22')).toBe(false)
  })
  it('cobre intervalo 2024-2028', () => {
    // Confraternização Universal em todos os anos suportados
    expect(FERIADOS_NACIONAIS.has('2024-01-01')).toBe(true)
    expect(FERIADOS_NACIONAIS.has('2025-01-01')).toBe(true)
    expect(FERIADOS_NACIONAIS.has('2026-01-01')).toBe(true)
    expect(FERIADOS_NACIONAIS.has('2027-01-01')).toBe(true)
    expect(FERIADOS_NACIONAIS.has('2028-01-01')).toBe(true)
  })
})

// ─── Casos do Fiscal ──────────────────────────────────────────────────────────

describe('fiscalDiarias', () => {
  // Caso 1 — dia útil normal, valor abaixo do limite → nenhum finding
  it('1. negativo dia útil + valor baixo → nenhum finding', async () => {
    const gazette = gazetteWith(
      'g-001',
      '2026-05-13', // quarta
      'CONCEDE diária a João da Silva, servidor da Secretaria de Saúde, ' +
        'no valor de R$ 350,00, para deslocamento em 13/05/2026 a Porto Alegre.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  // Caso 2 — sábado sem justificativa → dispara
  it('2. positivo sábado sem justificativa → emite diaria_irregular', async () => {
    const gazette = gazetteWith(
      'g-002',
      '2026-05-11', // gazette publicada segunda
      'CONCEDE diária a Maria dos Santos no valor de R$ 400,00 para deslocamento ' +
        'em 09/05/2026 (sábado) à cidade de Gramado.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    const irregular = findings.filter(f => f.type === 'diaria_irregular')
    expect(irregular).toHaveLength(1)
    expect(irregular[0].legalBasis).toMatch(/Lei 8\.112\/90/)
    expect(irregular[0].legalBasis).toMatch(/Art\. 58/)
    // Linguagem factual + presença do conceito-chave (LRN-20260509-005).
    expect(irregular[0].narrative).not.toMatch(/fraudou|desviou|corrup|ilícito/i)
    expect(irregular[0].narrative).toMatch(/sábado/i)
    expect(irregular[0].evidence[0].source).toBe(gazette.url)
  })

  // Caso 3 — domingo sem justificativa → dispara
  it('3. positivo domingo sem justificativa → emite diaria_irregular', async () => {
    const gazette = gazetteWith(
      'g-003',
      '2026-05-11',
      'PORTARIA. CONCEDE diária no valor de R$ 500,00 para viagem em 10/05/2026 a São Paulo.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    const irregular = findings.filter(f => f.type === 'diaria_irregular')
    expect(irregular).toHaveLength(1)
    expect(irregular[0].narrative).toMatch(/domingo/i)
  })

  // Caso 4 — feriado fixo (Tiradentes) sem justificativa → dispara
  it('4. positivo feriado fixo (Tiradentes 21/04/2026) → emite diaria_irregular', async () => {
    const gazette = gazetteWith(
      'g-004',
      '2026-04-22',
      'CONCEDE diária no valor de R$ 600,00 para deslocamento em 21/04/2026 a Brasília.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    const irregular = findings.filter(f => f.type === 'diaria_irregular')
    expect(irregular).toHaveLength(1)
    expect(irregular[0].narrative).toMatch(/feriado/i)
  })

  // Caso 5 — feriado variável (Sexta da Paixão 2026 = 03/04) → dispara
  it('5. positivo feriado variável (Sexta da Paixão 03/04/2026) → emite diaria_irregular', async () => {
    const gazette = gazetteWith(
      'g-005',
      '2026-04-06',
      'CONCEDE diária no valor de R$ 300,00 referente à viagem em 03/04/2026 a Curitiba.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    const irregular = findings.filter(f => f.type === 'diaria_irregular')
    expect(irregular).toHaveLength(1)
    expect(irregular[0].narrative).toMatch(/feriado/i)
  })

  // Caso 6 — valor acima do limite em dia útil → dispara por excesso
  it('6. positivo valor acima do limite em dia útil → emite diaria_irregular por excesso', async () => {
    const valorAcima = DIARIA_VALOR_LIMITE + 500
    const gazette = gazetteWith(
      'g-006',
      '2026-05-13', // quarta
      `CONCEDE diária no valor de R$ ${valorAcima.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ` +
        'para deslocamento em 13/05/2026 a Florianópolis.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    const irregular = findings.filter(f => f.type === 'diaria_irregular')
    expect(irregular).toHaveLength(1)
    expect(irregular[0].narrative).toMatch(/limite indiciário/i)
    expect(irregular[0].value).toBe(valorAcima)
  })

  // Caso 7 — sem data extraível → usa gazette.date (que é fim de semana) → dispara
  it('7. fallback gazette.date quando excerpt não contém data → dispara em domingo', async () => {
    const gazette = gazetteWith(
      'g-007',
      '2026-05-10', // domingo
      'CONCEDE diária ao servidor para realização de viagem oficial.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    const irregular = findings.filter(f => f.type === 'diaria_irregular')
    expect(irregular).toHaveLength(1)
  })

  // Caso 8 — sábado COM justificativa explícita → não dispara
  it('8. negativo sábado com justificativa (plantão) → nenhum finding', async () => {
    const gazette = gazetteWith(
      'g-008',
      '2026-05-11',
      'CONCEDE diária a servidor de plantão da Secretaria de Saúde no valor de R$ 400,00, ' +
        'em regime de plantão emergencial em 09/05/2026.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  // Caso 9 — excerpt sem termos de diária → filtro etapa 1 retorna []
  it('9. negativo excerpt sem termos de diária → filtro etapa 1 retorna []', async () => {
    const gazette = gazetteWith(
      'g-009',
      '2026-05-09', // sábado
      'DISPENSA DE LICITAÇÃO n° 055/2026. Objeto: aquisição de material de escritório.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  // Caso 10 — fim de semana + valor acima → dispara DOIS findings (FdS + excesso)
  it('10. positivo combinado: domingo + valor acima do limite → 2 findings (data e excesso)', async () => {
    const valorAcima = DIARIA_VALOR_LIMITE + 1000
    const gazette = gazetteWith(
      'g-010',
      '2026-05-11',
      `CONCEDE diária no valor de R$ ${valorAcima.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ` +
        'para deslocamento em 10/05/2026 (domingo).',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings.length).toBeGreaterThanOrEqual(2)
    const tipos = findings.map(f => f.type)
    expect(tipos.every(t => t === 'diaria_irregular')).toBe(true)
    // Um finding deve mencionar "domingo", outro "limite indiciário"
    const narrativas = findings.map(f => f.narrative).join('\n')
    expect(narrativas).toMatch(/domingo/i)
    expect(narrativas).toMatch(/limite indiciário/i)
  })

  // Caso 11 — confidence reduzida quando data não foi extraída do texto
  it('11. confidence menor quando excerpt não traz data explícita', async () => {
    const gazette = gazetteWith(
      'g-011',
      '2026-05-10', // domingo
      'CONCEDE diária ao servidor para viagem oficial.',
    )

    const findings = await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext(),
    })

    const irregular = findings.filter(f => f.type === 'diaria_irregular')
    expect(irregular).toHaveLength(1)
    expect(irregular[0].confidence).toBeLessThanOrEqual(0.6)
  })

  // ── Regression tests do golden set fiscal-digital-evaluations (Ciclo 1+2) ──
  // ADR-001 — fiscal-diarias/ADR-001-overmatch.md
  // Padrões identificados nos 10 FPs originais (GS-014, 015, 046..049, 090..093)
  // + padrões adicionais Ciclo 2 (polissemia "diária": jornada/multa/publicação/sessões).
  // Todos devem retornar `no_finding`.
  describe('regression tests (golden set FPs — ADR-001)', () => {
    function expectNoFinding(excerpt: string, label: string, gazetteDate = '2026-05-12') {
      return async () => {
        const gazette = gazetteWith(`gs-${label}`, gazetteDate, excerpt)
        const findings = await fiscalDiarias.analisar({
          gazette,
          cityId: '4305108',
          context: makeContext(),
        })
        expect(findings).toHaveLength(0)
      }
    }

    it('GS-014/GS-091: Técnicas de tiro (sem palavra-chave diária)', expectNoFinding(
      'Técnicas de tiro: tiro duplo, acompanhamento do alvo. Panes/incidentes de tiro: identificação e saneamento. Identificação de meios de proteção. Curso de treinamento envolve deslocamento dos servidores.',
      '014',
    ))

    it('GS-015/GS-048: ATA DE REGISTRO DE PREÇOS para Diária em Hotel (Pregão Eletrônico)', expectNoFinding(
      'OBJETO: ATA DE REGISTRO DE PREÇOS PARA A PRESTAÇÃO DE SERVIÇO DE DIÁRIA EM HOTEL - APARTAMENTO SIMPLES. PRAZO: 12 MESES. VALOR: R$ 136.500,00. MODALIDADE: PREGAO ELETRONICO - 302/2023. Concede contratação.',
      '015',
    ))

    it('GS-046: Despesas de Viagem em ata de Pregão (sem diária)', expectNoFinding(
      'VIII- Despesas de Viagem: R$ 2.329,52. Pedro Mousinho Gomes. ATA DA SESSÃO PÚBLICA. PREGÃO ELETRÔNICO Nº 001/2022. Processo nº 01.010910.22.98.',
      '046',
    ))

    it('GS-047: Aditivo de valor global da diária do contrato (locação de veículo)', expectNoFinding(
      'Reajuste de 3,415370%, o valor global da diária do contrato passará de R$ 2.208,00 (dois mil, duzentos e oito reais), para R$ 2.283,48, gerando impactação financeira. Concede reajuste contratual de locação de veículo.',
      '047',
    ))

    it('GS-049: Boa Viagem (proper noun)', expectNoFinding(
      'Praça do Derby (nos sentidos Boa Viagem e Olinda) e Praça do Amorim - com distribuição de panfletos, faixas informativas e diálogo direto com motoristas, passageiros.',
      '049',
    ))

    it('GS-090: "diaria-mente" com quebra de linha', expectNoFinding(
      'A gente vai garantir que cerca de 60 mil pessoas, diaria-\nmente, sejam beneficiadas diretamente. A Prefeitura segue trabalhando aumentando muito o investimento e concede atenção integral.',
      '090',
    ))

    it('GS-092: Boa Viagem (loja) — proper noun', expectNoFinding(
      'Para a loja de Boa Viagem, a Prefeitura do Recife, através da Secretaria de Desenvolvimento Econômico, apoiou nas contratações, paga consultoria.',
      '092',
    ))

    it('GS-093: Dotação orçamentária 3.3.90.14 (autorização contábil)', expectNoFinding(
      '3.3.90.14.00.00.00.00.0500 DIÁRIAS - PESSOAL CIVIL R$ 1.000,00. Dotação Orçamentária. Crédito Suplementar. Concede dotação.',
      '093',
    ))

    // ── Padrões adicionais Ciclo 2 (polissemia "diária") ──
    it('C2-DIVISAO: "Divisão de Diárias e Passagens" (unidade administrativa)', expectNoFinding(
      'Lotação: Divisão de Diárias e Passagens da Secretaria Municipal de Administração. Concede gratificação ao chefe da divisão.',
      'c2-divisao',
    ))

    it('C2-JORNADA: "jornada diária" (carga horária)', expectNoFinding(
      'Concede ao servidor José da Silva jornada diária de 6 horas, conforme regulamento. Valor da gratificação: R$ 200,00.',
      'c2-jornada',
    ))

    it('C2-MULTA: "multa diária" (cláusula contratual)', expectNoFinding(
      'CONTRATO Nº 045/2026. Cláusula 12: multa diária de R$ 500,00 em caso de descumprimento. Paga multa por atraso.',
      'c2-multa',
    ))

    it('C2-SESSAO: "sessões diárias" (sessões de teatro)', expectNoFinding(
      'Programação cultural com sessões diárias de teatro infantil na Casa de Cultura. Autoriza programação. Valor total: R$ 30.000,00.',
      'c2-sessao',
    ))

    it('C2-PUBLICACAO: "publicação diária" (periodicidade do DO)', expectNoFinding(
      'A publicação diária do diário oficial municipal será mantida. Autoriza renovação do contrato de impressão R$ 12.000,00 mensais.',
      'c2-publicacao',
    ))

    it('C2-ALIMENTACAO: "alimentação diária" (programa social)', expectNoFinding(
      'Programa Bom Prato fornece alimentação diária aos cidadãos em situação de vulnerabilidade. Paga subsídio R$ 5.000,00 mensais.',
      'c2-alimentacao',
    ))
  })

  // Caso 12 — saveMemory recebe item sem campos NULL (LRN-019)
  it('12. saveMemory: item nunca contém NULL em campos opcionais (LRN-019)', async () => {
    const itensSalvos: Array<Record<string, unknown>> = []

    const captureSaveMemory = {
      name: 'save_memory',
      description: 'capture',
      async execute(input: { pk: string; table: string; item: Record<string, unknown> }) {
        itensSalvos.push(input.item)
        return {
          data: { ok: true },
          source: 'internal:capture',
          confidence: 1.0,
        }
      },
    } as unknown as FiscalContext['saveMemory']

    const gazette = gazetteWith(
      'g-012',
      '2026-05-11',
      'CONCEDE diária para viagem em 09/05/2026 (sábado).',
    )

    await fiscalDiarias.analisar({
      gazette,
      cityId: '4305108',
      context: makeContext({ saveMemory: captureSaveMemory }),
    })

    expect(itensSalvos.length).toBeGreaterThan(0)
    for (const item of itensSalvos) {
      for (const [key, value] of Object.entries(item)) {
        expect(value).not.toBeNull()
        // Se o valor for undefined, ele NÃO deveria estar presente no objeto
        // (omissão condicional). Como undefined é serializado como ausência em
        // DynamoDB, basta garantir que não há `null` literal. Mantemos a checagem.
        if (value === undefined) {
          throw new Error(`Field ${key} é undefined — deveria ser omitido`)
        }
      }
    }
  })
})
