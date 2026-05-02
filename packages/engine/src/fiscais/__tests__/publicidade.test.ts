import { fiscalPublicidade } from '../publicidade'
import type { FiscalContext } from '../types'
import type { Gazette } from '../../types'

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<FiscalContext> = {}): FiscalContext {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-08-15T10:00:00.000Z'),
    ...overrides,
  }
}

const BASE_GAZETTE: Omit<Gazette, 'id' | 'date' | 'excerpts'> = {
  territory_id: '4305108',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=publicidade-test',
  edition: '1',
  is_extra: false,
}

function gazette(id: string, date: string, excerpts: string[]): Gazette {
  return { ...BASE_GAZETTE, id, date, excerpts }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Caso 1 — Janela vedada 2026 + contratação publicitária com valor → dispara forte
const gazettePublicidadeJanelaVedada2026: Gazette = gazette(
  'gazette-pub-001',
  '2026-08-15',
  [
    'EXTRATO DE CONTRATO n° 145/2026. Objeto: contratação de serviços de publicidade ' +
    'institucional para divulgação de atos do governo municipal. ' +
    'Contratada: Agência Mídia Brasil LTDA, CNPJ: 11.222.333/0001-44. ' +
    'Valor: R$ 850.000,00. Secretaria Municipal de Comunicação.',
  ],
)

// Caso 2 — Janela vedada 2024 + propaganda com menção ao prefeito → dispara mais forte
const gazettePropagandaComPrefeito2024: Gazette = gazette(
  'gazette-pub-002',
  '2024-09-10',
  [
    'CONTRATO de inserção publicitária em mídia televisiva e digital, com veiculação ' +
    'de propaganda institucional sobre as obras da gestão do Prefeito Municipal. ' +
    'Empenho: R$ 320.000,00. Contratada: Mídia Top LTDA. ' +
    'Secretaria Municipal de Comunicação Social.',
  ],
)

// Caso 3 — FORA da janela vedada (março/2026) → não dispara mesmo com publicidade
const gazettePublicidadeForaJanela: Gazette = gazette(
  'gazette-pub-003',
  '2026-03-12',
  [
    'EXTRATO DE CONTRATO. Objeto: contratação de serviços de publicidade institucional ' +
    'para campanha de saúde pública. Valor: R$ 200.000,00. ' +
    'Secretaria Municipal de Comunicação.',
  ],
)

// Caso 4 — FORA da janela (junho/2026, antes do início da janela em 04/07) → não dispara
const gazettePublicidadeJunho2026: Gazette = gazette(
  'gazette-pub-004',
  '2026-06-30',
  [
    'CONTRATO de publicidade institucional. Valor: R$ 500.000,00. ' +
    'Contratada: Agência X LTDA. Secretaria de Comunicação.',
  ],
)

// Caso 5 — Dentro da janela mas SEM termo de contratação onerosa → não dispara
const gazetteMencionaPublicidadeSemContrato: Gazette = gazette(
  'gazette-pub-005',
  '2026-08-20',
  [
    'O Secretário Municipal participou de evento sobre publicidade institucional ' +
    'e divulgação de boas práticas de comunicação pública na região serrana.',
  ],
)

// Caso 6 — Excerpt sem termos de publicidade → filtro etapa 1 retorna []
const gazetteSemPublicidade: Gazette = gazette(
  'gazette-pub-006',
  '2026-08-15',
  [
    'DISPENSA DE LICITAÇÃO n° 055/2026. Objeto: aquisição de material de escritório. ' +
    'Valor: R$ 15.000,00. Secretaria Municipal de Administração.',
  ],
)

// Caso 7 — Janela vedada + publicidade SEM valor explícito → dispara com confidence reduzida
const gazettePublicidadeSemValor: Gazette = gazette(
  'gazette-pub-007',
  '2026-09-05',
  [
    'EXTRATO de aditivo contratual de serviços de publicidade institucional ' +
    'e veiculação publicitária. Contratada: Agência Comunicar LTDA, ' +
    'CNPJ: 33.444.555/0001-66. Secretaria Municipal de Comunicação.',
  ],
)

// Caso 8 — Janela vedada 2028 (limite inicial 01/07/2028) → dispara
const gazettePublicidadeJanelaInicio2028: Gazette = gazette(
  'gazette-pub-008',
  '2028-07-01',
  [
    'EXTRATO DE CONTRATO. Objeto: contratação de inserção paga em mídia para ' +
    'divulgação institucional dos programas municipais. Valor: R$ 400.000,00. ' +
    'Secretaria de Comunicação.',
  ],
)

// Caso 9 — Limite final da janela (31/12/2026) ainda dispara
const gazettePublicidadeJanelaFim2026: Gazette = gazette(
  'gazette-pub-009',
  '2026-12-31',
  [
    'CONTRATO de publicidade institucional. Empenho de R$ 100.000,00. ' +
    'Agência ABC LTDA. Secretaria Municipal de Comunicação.',
  ],
)

// Caso 10 — Múltiplos excerpts, alguns relevantes, outros não — filtra corretamente
const gazetteMultiplosExcerpts: Gazette = gazette(
  'gazette-pub-010',
  '2026-08-22',
  [
    'DISPENSA DE LICITAÇÃO n° 055/2026. Objeto: material de escritório. R$ 5.000,00.',
    'CONTRATO de propaganda institucional em mídia digital. Valor: R$ 250.000,00. ' +
    'Secretaria de Comunicação Social.',
    'Reunião do Conselho Municipal de Saúde — pauta livre.',
  ],
)

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('fiscalPublicidade', () => {
  it('1. positivo janela vedada 2026: contratação de publicidade R$ 850k em ago/2026 → dispara publicidade_eleitoral riskScore alto', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePublicidadeJanelaVedada2026,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('publicidade_eleitoral')
    expect(findings[0].fiscalId).toBe('fiscal-publicidade')
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(75)
    expect(findings[0].confidence).toBeGreaterThanOrEqual(0.70)
    expect(findings[0].legalBasis).toMatch(/Lei 9\.504\/97/)
    expect(findings[0].legalBasis).toMatch(/Art\.\s*73/)
    // Linguagem factual — sem termos acusatórios
    expect(findings[0].narrative).toMatch(/[Ii]dentificamos/)
    expect(findings[0].narrative).not.toMatch(/fraudou|desviou|corrup|ilícito|ilegal/i)
    expect(findings[0].narrative).toMatch(/janela vedada/i)
    expect(findings[0].evidence[0].source).toMatch(/queridodiario/)
    expect(findings[0].value).toBe(850000)
  })

  it('2. positivo janela vedada 2024 + menção ao prefeito → dispara com Art. 73 VI e VII', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePropagandaComPrefeito2024,
      cityId: '4305108',
      context: makeContext({ now: () => new Date('2024-09-15T10:00:00.000Z') }),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('publicidade_eleitoral')
    expect(findings[0].legalBasis).toMatch(/VII/)
    expect(findings[0].legalBasis).toMatch(/VI/)
    expect(findings[0].narrative).toMatch(/prefeit|gest[ãa]o municipal/i)
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(75)
  })

  it('3. negativo fora da janela: publicidade em mar/2026 → 0 findings', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePublicidadeForaJanela,
      cityId: '4305108',
      context: makeContext({ now: () => new Date('2026-03-12T10:00:00.000Z') }),
    })

    expect(findings).toHaveLength(0)
  })

  it('4. negativo borda inferior: publicidade em 30/06/2026 (1 dia antes da janela) → 0 findings', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePublicidadeJunho2026,
      cityId: '4305108',
      context: makeContext({ now: () => new Date('2026-06-30T10:00:00.000Z') }),
    })

    expect(findings).toHaveLength(0)
  })

  it('5. negativo janela vedada SEM contratação onerosa → 0 findings (filtro etapa 3)', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazetteMencionaPublicidadeSemContrato,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('6. negativo sem palavras-chave: gazette de licitação ordinária → filtro etapa 1 retorna []', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazetteSemPublicidade,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('7. positivo janela vedada SEM valor explícito → dispara com confidence reduzida e sem campo value', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePublicidadeSemValor,
      cityId: '4305108',
      context: makeContext({ now: () => new Date('2026-09-05T10:00:00.000Z') }),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('publicidade_eleitoral')
    expect(findings[0].confidence).toBeLessThan(0.80)
    // LRN-019: omissão condicional — value NÃO deve estar presente quando ausente
    expect(findings[0].value).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(findings[0], 'value')).toBe(false)
    expect(findings[0].narrative).toMatch(/não detalha valor/i)
  })

  it('8. positivo borda inicial janela 2028 (01/07/2028) → dispara', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePublicidadeJanelaInicio2028,
      cityId: '4305108',
      context: makeContext({ now: () => new Date('2028-07-01T10:00:00.000Z') }),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('publicidade_eleitoral')
    expect(findings[0].narrative).toMatch(/2028/)
  })

  it('9. positivo borda final janela 2026 (31/12/2026) → dispara', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePublicidadeJanelaFim2026,
      cityId: '4305108',
      context: makeContext({ now: () => new Date('2026-12-31T10:00:00.000Z') }),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('publicidade_eleitoral')
  })

  it('10. múltiplos excerpts: filtra os irrelevantes e dispara só no de propaganda', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazetteMultiplosExcerpts,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].evidence).toHaveLength(1)
    expect(findings[0].evidence[0].excerpt).toMatch(/propaganda institucional/i)
    expect(findings[0].value).toBe(250000)
  })

  it('11. metadata sanity: createdAt presente, fiscalId correto, cityId propagado', async () => {
    const findings = await fiscalPublicidade.analisar({
      gazette: gazettePublicidadeJanelaVedada2026,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings[0].fiscalId).toBe('fiscal-publicidade')
    expect(findings[0].cityId).toBe('4305108')
    expect(findings[0].createdAt).toBeDefined()
    expect(findings[0].evidence[0].date).toBe('2026-08-15')
    // GSI safety — cnpj não foi extraído, deve estar ausente (não NULL)
    expect(Object.prototype.hasOwnProperty.call(findings[0], 'cnpj')).toBe(false)
  })
})
