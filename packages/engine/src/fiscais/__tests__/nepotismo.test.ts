import { fiscalNepotismo, extrairSobrenomeFinal, extrairNomeacoes } from '../nepotismo'
import type { FiscalContext } from '../types'
import {
  gazetteSobrenomeRaroTresVezes,
  gazetteSobrenomeComumCincoVezes,
  gazetteSobrenomeRaroUmaVez,
  gazetteSobrenomeRaroDuasVezes,
  gazetteSemCargoComissao,
  gazetteSemNomeacao,
  gazetteSobrenomeRaroQuatroVezes,
  gazetteDoisSobrenomesRarosCadaUmDuasVezes,
  gazetteNomeSimples,
  gazetteSobrenomeRaroMultiplosExcerpts,
} from './nepotismo-fixtures'

function makeContext(overrides: Partial<FiscalContext> = {}): FiscalContext {
  return {
    alertsTable: 'fiscal-digital-alerts-test',
    now: () => new Date('2026-05-10T10:00:00.000Z'),
    ...overrides,
  }
}

describe('fiscalNepotismo', () => {
  // ── Casos comportamentais ──────────────────────────────────────────────────

  it('1. positivo: sobrenome raro 3x em cargos em comissão → emite nepotismo_indicio', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroTresVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('nepotismo_indicio')
    expect(findings[0].fiscalId).toBe('fiscal-nepotismo')
    expect(findings[0].evidence[0].source).toMatch(/queridodiario/)
  })

  it('2. negativo: sobrenome COMUM (Silva) 5x → blocklist → não emite', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeComumCincoVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('3. negativo: sobrenome raro 1x → abaixo do limiar (3) → não emite', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroUmaVez,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('4. negativo: sobrenome raro 2x → abaixo do limiar (3) → não emite', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroDuasVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('5. negativo: nomeações para cargos efetivos (sem comissão) → filtro etapa 1 descarta', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSemCargoComissao,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('6. negativo: gazette sem nomeação (só licitação) → filtro etapa 1 descarta', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSemNomeacao,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  // ── Confidence threshold ──────────────────────────────────────────────────

  it('7. confidence sempre >= 0.95 quando emite (constraint crítico)', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroTresVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].confidence).toBeGreaterThanOrEqual(0.95)
    expect(findings[0].confidence).toBeLessThanOrEqual(0.97) // cap MVP
  })

  it('8. confidence cresce com mais ocorrências (4x > 3x), respeitando cap', async () => {
    const findings4x = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroQuatroVezes,
      cityId: '4305108',
      context: makeContext(),
    })
    const findings3x = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroTresVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings4x).toHaveLength(1)
    expect(findings3x).toHaveLength(1)
    expect(findings4x[0].confidence).toBeGreaterThan(findings3x[0].confidence)
    expect(findings4x[0].confidence).toBeLessThanOrEqual(0.97)
  })

  // ── Linguagem factual (Princípio inegociável) ─────────────────────────────

  it('9. linguagem factual: "identificamos coincidência" — NUNCA "é parente de"', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroTresVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    const narrative = findings[0].narrative
    // Deve conter linguagem factual
    expect(narrative).toMatch(/[Ii]dentificamos/)
    expect(narrative).toMatch(/coincid[êe]ncia/i)
    expect(narrative).toMatch(/recomenda.*verifica[çc][ãa]o\s+manual/i)
    // NUNCA pode afirmar parentesco ou usar termos acusatórios
    expect(narrative).not.toMatch(/é\s+parente\s+de/i)
    expect(narrative).not.toMatch(/[ée]\s+irm[ãa]o/i)
    expect(narrative).not.toMatch(/[ée]\s+filh[oa]/i)
    expect(narrative).not.toMatch(/[ée]\s+esposa?/i)
    expect(narrative).not.toMatch(/nepotismo\s+(comprovado|confirmado|configurado)/i)
    expect(narrative).not.toMatch(/fraudou|desviou|corrup|il[íi]cito/i)
    // Base legal mencionada
    expect(narrative).toMatch(/S[úu]mula\s+Vinculante\s+13/i)
  })

  it('10. legalBasis cita STF Súmula 13 e CF Art. 37', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroTresVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].legalBasis).toMatch(/S[úu]mula\s+Vinculante\s+13/i)
    expect(findings[0].legalBasis).toMatch(/CF.*Art\.?\s*37/i)
  })

  // ── riskScore moderado (50–60) ────────────────────────────────────────────

  it('11. riskScore moderado: indício, não acusação (50–65 esperado)', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroTresVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].riskScore).toBeGreaterThanOrEqual(50)
    expect(findings[0].riskScore).toBeLessThanOrEqual(65)
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('12. edge: sobrenomes raros DIFERENTES (2x cada) → não soma → não emite', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteDoisSobrenomesRarosCadaUmDuasVezes,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('13. edge: nome simples (1 token, sem sobrenome) → ignorado pela extração', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteNomeSimples,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(0)
  })

  it('14. consolidação: múltiplos excerpts da mesma gazette somam (3x Albuquerque) → emite', async () => {
    const findings = await fiscalNepotismo.analisar({
      gazette: gazetteSobrenomeRaroMultiplosExcerpts,
      cityId: '4305108',
      context: makeContext(),
    })

    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('nepotismo_indicio')
    // Evidências de excerpts distintos
    expect(findings[0].evidence.length).toBeGreaterThanOrEqual(1)
  })

  // ── Helpers internos (extrairSobrenomeFinal / extrairNomeacoes) ───────────

  it('15. extrairSobrenomeFinal: pega último token capitalizado, ignora conectivos', () => {
    expect(extrairSobrenomeFinal('Maria da Silva Pereira')).toBe('pereira')
    expect(extrairSobrenomeFinal('Carlos Souza')).toBe('souza')
    expect(extrairSobrenomeFinal('Ana Costa Albuquerque')).toBe('albuquerque')
    expect(extrairSobrenomeFinal('João dos Santos')).toBe('santos')
    expect(extrairSobrenomeFinal('Carlos')).toBeNull() // 1 token
    expect(extrairSobrenomeFinal('')).toBeNull()
  })

  it('16. extrairSobrenomeFinal: normaliza acento e case', () => {
    expect(extrairSobrenomeFinal('Maria Aragão')).toBe('aragao')
    expect(extrairSobrenomeFinal('JOÃO ALBUQUERQUE')).toBe('albuquerque')
  })

  it('17. extrairNomeacoes: extrai apenas nomes após verbo de nomeação', () => {
    const excerpt =
      'NOMEIA Carlos Albuquerque para Chefe de Divisão. ' +
      'EXONERA Pedro Silva do cargo. NOMEIA Maria da Silva para Diretora.'

    const nomes = extrairNomeacoes(excerpt)
    const sobrenomes = nomes.map(n => n.sobrenomeFinal).sort()
    expect(sobrenomes).toContain('albuquerque')
    expect(sobrenomes).toContain('silva')
    // Não deve incluir Pedro Silva (verbo é EXONERA, não NOMEIA)
    const exoneradoIncluso = nomes.some(n => n.nome.toLowerCase().includes('pedro'))
    expect(exoneradoIncluso).toBe(false)
  })
})
