import { fiscalPessoal } from '../pessoal'
import type { FiscalContext } from '../types'
import {
  gazettePicoNomeacoesJanelaEleitoral,
  gazettePicoForaJanela7Atos,
  gazettePicoForaJanela12Atos,
  gazettePicoJanelaEleitoral3Atos,
  gazetteRotatividadeAnormal,
  gazettesSemTermosPessoal,
} from './pessoal-fixtures'

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<FiscalContext> = {}): FiscalContext {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-08-15T10:00:00.000Z'),
    ...overrides,
  }
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('fiscalPessoal', () => {
  // Caso 1 — Janela eleitoral 2026 + 7 atos → dispara pico_nomeacoes com riskScore alto
  it('1. positivo janela eleitoral: 7 atos em ago/2026 → emite pico_nomeacoes (riskScore >= 60)', async () => {
    const context = makeContext({
      now: () => new Date('2026-08-15T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoNomeacoesJanelaEleitoral,
      cityId: '4305108',
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(1)
    expect(pico[0].riskScore).toBeGreaterThanOrEqual(60)
    expect(pico[0].legalBasis).toMatch(/Lei 9\.504\/97/)
    expect(pico[0].legalBasis).toMatch(/Art\. 73/)
    // Linguagem factual — sem termos acusatórios. Narrativa é gerada pelo Haiku
    // (Onda 2), então o tom é validado por ausência de termos acusatórios + presença
    // de contexto eleitoral. Aberturas variam ("Identificamos", "Os dados...",
    // "A análise..."), por isso não fixamos o verbo inicial.
    expect(pico[0].narrative).not.toMatch(/fraudou|desviou|corrup|ilícito/i)
    expect(pico[0].narrative).toMatch(/eleitoral/i)
    expect(pico[0].evidence[0].source).toMatch(/queridodiario/)
  })

  // Caso 2 — Calibração 2026-05-06: 7 atos fora janela em medium (Caxias 463k) →
  // NÃO dispara (limiar medium fora janela = 10).
  it('2. medium fora janela: 7 atos < limiar 10 → NÃO dispara pico_nomeacoes', async () => {
    const context = makeContext({
      now: () => new Date('2026-03-10T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoForaJanela7Atos,
      cityId: '4305108', // Caxias 463k → medium
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(0)
  })

  // Caso 3 — Fora da janela + 12 atos: gate auditoria (Onda 3 / 7-ajustes)
  // bloqueia findings com riskScore < 60 para não poluir DDB.
  // Em medium (Caxias), 12 atos fora janela = baseRisco 45 + excesso < 60.
  it('3. fora janela: 12 atos em fev/2026 → NÃO dispara (riskScore < 60 blocked)', async () => {
    const context = makeContext({
      now: () => new Date('2026-02-20T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoForaJanela12Atos,
      cityId: '4305108',
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(0)
  })

  // Caso 4 — Calibração 2026-05-06: 3 atos eleitoral em medium (Caxias) →
  // NÃO dispara (limiar medium eleitoral = 5).
  it('4. medium eleitoral: 3 atos < limiar 5 → NÃO dispara pico_nomeacoes', async () => {
    const context = makeContext({
      now: () => new Date('2026-09-01T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoJanelaEleitoral3Atos,
      cityId: '4305108', // Caxias → medium
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(0)
  })

  // Caso 4.b — Calibração 2026-05-06: a mesma gazette de 7 atos em cidade large
  // (São Paulo 11M) NÃO dispara (limiar large eleitoral = 10).
  it('4.b large eleitoral: 7 atos < limiar 10 → NÃO dispara pico_nomeacoes', async () => {
    const context = makeContext({
      now: () => new Date('2026-08-15T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoNomeacoesJanelaEleitoral, // 7 atos
      cityId: '3550308', // São Paulo 11M → large
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(0)
  })

  // Caso 5 — Exoneração + nomeação cargo comissionado no mesmo excerpt → dispara rotatividade_anormal
  it('5. positivo rotatividade: exoneração + nomeação mesmo cargo comissionado → emite rotatividade_anormal', async () => {
    const context = makeContext({
      now: () => new Date('2026-05-10T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazetteRotatividadeAnormal,
      cityId: '4305108',
      context,
    })

    const rotatividade = findings.filter(f => f.type === 'rotatividade_anormal')
    expect(rotatividade).toHaveLength(1)
    expect(rotatividade[0].legalBasis).toMatch(/CF.*Art\. 37/)
    // Linguagem factual — só validamos ausência de termos acusatórios (LRN-20260509-005).
    expect(rotatividade[0].narrative).not.toMatch(/fraudou|desviou|corrup/i)
    expect(rotatividade[0].evidence[0].source).toMatch(/queridodiario/)
  })

  // Caso 6 — Excerpt sem palavras-chave de pessoal → retorna []
  it('6. sem palavras-chave: excerpt de licitação → filtro etapa 1 retorna []', async () => {
    const context = makeContext()

    const findings = await fiscalPessoal.analisar({
      gazette: gazettesSemTermosPessoal,
      cityId: '4305108',
      context,
    })

    expect(findings).toHaveLength(0)
  })

  // ── Regression tests do golden set fiscal-digital-evaluations (Ciclo 1+2+3) ──
  // ADR-001 — fiscal-pessoal/ADR-001-regex-conjugacao.md
  // Padrões C2/C3: comunicado convocação, vaga substituição, texto normativo,
  // ratificação retroativa, Lei Complementar quadro, FG/GIP, concurso público.
  describe('regression tests (golden set FPs — ADR-001 + Ciclo 3)', () => {
    function expectNoFinding(excerpts: string[], label: string, date = '2026-08-15') {
      return async () => {
        const gazette = {
          id: `gs-pessoal-${label}`,
          territory_id: '4305108',
          date,
          url: `https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=pessoal-${label}`,
          excerpts,
          edition: '1',
          is_extra: false,
        }
        const findings = await fiscalPessoal.analisar({
          gazette,
          cityId: '4305108',
          context: makeContext({ now: () => new Date(`${date}T10:00:00.000Z`) }),
        })
        expect(findings).toHaveLength(0)
      }
    }

    // ── GS originais (Ciclo 1) — devem retornar no_finding ──
    it('GS-071: ratificação retroativa de nomeação de 2005', expectNoFinding(
      [
        'PORTARIA n° 050/2026. Ratificação retroativa da nomeação de CUELLAR LOPEZ, a contar de 12/05/2005, conforme decisão judicial. Cargo: Assessor Especial.',
      ],
      '071',
    ))

    it('GS-072: janeiro pós-eleição municipal (transição de mandato)', expectNoFinding(
      [
        'NOMEIA Maria Silva Diretora; NOMEIA João Souza Coordenador; NOMEIA Pedro Lima Assessor; EXONERA Carlos Mendes; NOMEIA Ana Costa; NOMEIA Lucia Pereira; NOMEIA Roberto Alves; EXONERA Paulo Santos.',
      ],
      '072',
      '2025-01-15', // janeiro pós-eleição 2024
    ))

    // ── Padrões novos descobertos no Ciclo 3 ──
    it('C3-COMUNICADO: comunicado de nomeação sem vínculo efetivo (GS-1289)', expectNoFinding(
      [
        'COMUNICADO – NOMEAÇÃO SEM VÍNCULO EFETIVO. Convoca para vaga em comissão. Sr. JOSÉ DA SILVA, classificado em processo seletivo simplificado.',
      ],
      'c3-comunicado',
    ))

    it('C3-SUBSTITUICAO: vaga decorrente de exoneração individual (GS-1290)', expectNoFinding(
      [
        'Para o cargo em comissão de Assessor de Gabinete. Vaga decorrente da exoneração de Wagner Souza. NOMEIA José Lima.',
      ],
      'c3-substituicao',
    ))

    it('C3-NORMATIVO: texto de lei vedando nomeações (GS-1291)', expectNoFinding(
      [
        'DECRETO Nº 1.234. VEDA A NOMEAÇÃO PELA ADMINISTRAÇÃO PÚBLICA DE PESSOAS CONDENADAS PELA LEI MARIA DA PENHA, conforme entendimento jurisprudencial consolidado.',
      ],
      'c3-normativo',
    ))

    it('C3-LEI-COMPLEMENTAR: Lei Complementar cria quadro funcional', expectNoFinding(
      [
        'Considerando o disposto na Lei Complementar nº 247, de 29 de dezembro de 2017, que dispõe sobre a Organização da Administração Direta do Poder Executivo. NOMEIA quadro de funcionários públicos efetivos.',
      ],
      'c3-lei-comp',
    ))

    it('C3-TORNAR-SEM-EFEITO: anulação em massa de portarias', expectNoFinding(
      [
        'Resolve TORNAR SEM EFEITO as nomeações constantes das Portarias nº 100 a 150/2024, em razão de vício formal.',
      ],
      'c3-tornar-sem-efeito',
    ))

    it('C3-FG-GIP: cargo de Função Gratificada (não comissionado)', expectNoFinding(
      [
        'NOMEIA José da Silva para o cargo de Função Gratificada FG-3, junto à Secretaria de Administração. NOMEIA Maria Souza FG-2.',
      ],
      'c3-fg',
    ))

    it('C3-CONCURSO: concurso público regular homologado (não comissionado)', expectNoFinding(
      [
        'NOMEIA em caráter efetivo os candidatos aprovados no Concurso Público nº 001/2024, homologação publicada em 15/01/2026: João da Silva, Maria Souza, Pedro Lima.',
      ],
      'c3-concurso',
    ))

    it('C3-A-PEDIDO: exoneração a pedido individual', expectNoFinding(
      [
        'EXONERAR, a pedido, do servidor TÚLIO REBELO, matrícula 12345, do cargo em comissão de Assessor Especial.',
      ],
      'c3-a-pedido',
    ))
  })
})
