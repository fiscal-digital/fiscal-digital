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
    // Linguagem factual — sem termos acusatórios
    expect(pico[0].narrative).toMatch(/[Ii]dentificamos/)
    expect(pico[0].narrative).not.toMatch(/fraudou|desviou|corrup|ilícito/i)
    expect(pico[0].narrative).toMatch(/janela eleitoral/)
    expect(pico[0].evidence[0].source).toMatch(/queridodiario/)
  })

  // Caso 2 — Fora da janela eleitoral + 7 atos → não dispara (limiar fora = 10)
  it('2. positivo fora janela: 7 atos em mar/2026 → emite pico_nomeacoes (limiar calibrado 7, riskScore < 60)', async () => {
    const context = makeContext({
      now: () => new Date('2026-03-10T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoForaJanela7Atos,
      cityId: '4305108',
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(1)
    expect(pico[0].riskScore).toBeLessThan(60) // informativo fora janela
  })

  // Caso 3 — Fora da janela + 12 atos → dispara informativo (riskScore < 60)
  it('3. informativo fora janela: 12 atos em fev/2026 → emite pico_nomeacoes com riskScore < 60', async () => {
    const context = makeContext({
      now: () => new Date('2026-02-20T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoForaJanela12Atos,
      cityId: '4305108',
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(1)
    expect(pico[0].riskScore).toBeLessThan(60)
    expect(pico[0].narrative).toMatch(/[Ii]dentificamos/)
    expect(pico[0].narrative).toMatch(/informativo/)
  })

  // Caso 4 — Janela eleitoral + 3 atos → não dispara (abaixo do limiar 5)
  it('4. positivo janela eleitoral: 3 atos em set/2026 → emite pico_nomeacoes (limiar calibrado 3, riskScore >= 60)', async () => {
    const context = makeContext({
      now: () => new Date('2026-09-01T10:00:00.000Z'),
    })

    const findings = await fiscalPessoal.analisar({
      gazette: gazettePicoJanelaEleitoral3Atos,
      cityId: '4305108',
      context,
    })

    const pico = findings.filter(f => f.type === 'pico_nomeacoes')
    expect(pico).toHaveLength(1)
    expect(pico[0].riskScore).toBeGreaterThanOrEqual(60) // janela eleitoral = alto risco
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
    expect(rotatividade[0].narrative).toMatch(/[Ii]dentificamos/)
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
})
