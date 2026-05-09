import { fiscalGeral } from '../geral'
import type { Finding } from '../../types'

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeFinding(
  cnpj: string | undefined,
  type: Finding['type'],
  secretaria?: string,
  riskScore = 70,
  confidence = 0.85,
): Finding {
  return {
    fiscalId: 'fiscal-licitacoes',
    cityId: '4305108',
    type,
    riskScore,
    confidence,
    evidence: [
      {
        source: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=test',
        excerpt: `Excerpt de teste — ${type}`,
        date: '2026-03-15',
      },
    ],
    narrative: `Narrativa de teste para ${type}.`,
    legalBasis: 'Lei 14.133/2021',
    cnpj,
    secretaria,
    createdAt: '2026-03-15T10:00:00.000Z',
  }
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('fiscalGeral', () => {
  // Caso 1 — 3 findings mesmo CNPJ → meta-finding padrao_recorrente gerado
  it('1. positivo padrao_recorrente: 3 findings mesmo CNPJ → emite meta-finding padrao_recorrente', () => {
    const cnpj = '12.345.678/0001-90'
    const findings: Finding[] = [
      makeFinding(cnpj, 'dispensa_irregular', 'Secretaria Municipal de Saúde'),
      makeFinding(cnpj, 'cnpj_jovem', 'Secretaria Municipal de Saúde'),
      makeFinding(cnpj, 'aditivo_abusivo', 'Secretaria Municipal de Obras'),
    ]

    const resultado = fiscalGeral.consolidar({ findings, cityId: '4305108' })

    // Deve retornar os 3 findings originais + 1 meta-finding
    expect(resultado).toHaveLength(4)

    const meta = resultado.filter(f => f.type === 'padrao_recorrente')
    expect(meta).toHaveLength(1)
    expect(meta[0].cnpj).toBe(cnpj)
    expect(meta[0].riskScore).toBeGreaterThanOrEqual(90)
    expect(meta[0].fiscalId).toBe('fiscal-geral')
    // Linguagem factual — só validamos ausência de termos acusatórios (LRN-20260509-005).
    expect(meta[0].narrative).not.toMatch(/fraudou|desviou|corrup/i)
    // Evidências consolidadas: 1 por finding original = 3 total
    expect(meta[0].evidence).toHaveLength(3)
  })

  // Caso 2 — 2 findings mesmo CNPJ → não gera meta-finding
  it('2. negativo padrao_recorrente: 2 findings mesmo CNPJ → não gera meta-finding', () => {
    const cnpj = '22.333.444/0001-55'
    const findings: Finding[] = [
      makeFinding(cnpj, 'dispensa_irregular'),
      makeFinding(cnpj, 'fracionamento'),
    ]

    const resultado = fiscalGeral.consolidar({ findings, cityId: '4305108' })

    // Apenas os 2 originais, sem meta-finding
    expect(resultado).toHaveLength(2)
    const meta = resultado.filter(f => f.type === 'padrao_recorrente')
    expect(meta).toHaveLength(0)
  })

  // Caso 3 — findings vazios → retorna []
  it('3. vazio: findings [] → retorna []', () => {
    const resultado = fiscalGeral.consolidar({ findings: [], cityId: '4305108' })
    expect(resultado).toHaveLength(0)
  })

  // Caso 4 — findings de CNPJs distintos → retorna sem mudança, sem meta-finding
  it('4. CNPJs distintos: cada CNPJ com 1 finding → retorna sem meta-finding', () => {
    const findings: Finding[] = [
      makeFinding('11.111.111/0001-11', 'dispensa_irregular'),
      makeFinding('22.222.222/0001-22', 'cnpj_jovem'),
      makeFinding('33.333.333/0001-33', 'aditivo_abusivo'),
    ]

    const resultado = fiscalGeral.consolidar({ findings, cityId: '4305108' })

    expect(resultado).toHaveLength(3)
    const meta = resultado.filter(f => f.type === 'padrao_recorrente')
    expect(meta).toHaveLength(0)
  })

  // Caso 5 — riskScore consolidado cresce com número de findings acima do mínimo
  it('5. riskScore: 5 findings mesmo CNPJ → riskScore = 90 + 2*2 = 94', () => {
    const cnpj = '55.555.555/0001-55'
    const findings: Finding[] = [
      makeFinding(cnpj, 'dispensa_irregular'),
      makeFinding(cnpj, 'fracionamento'),
      makeFinding(cnpj, 'cnpj_jovem'),
      makeFinding(cnpj, 'aditivo_abusivo'),
      makeFinding(cnpj, 'concentracao_fornecedor'),
    ]

    const resultado = fiscalGeral.consolidar({ findings, cityId: '4305108' })

    const meta = resultado.filter(f => f.type === 'padrao_recorrente')
    expect(meta).toHaveLength(1)
    // 90 base + (5 - 3) * 2 bonus = 94
    expect(meta[0].riskScore).toBe(94)
  })

  // Caso 6 — findings sem CNPJ são ignorados pelo agrupador (não contam para padrão recorrente)
  it('6. sem CNPJ: findings sem cnpj → ignorados pelo agrupador, retornados sem mudança', () => {
    const findings: Finding[] = [
      makeFinding(undefined, 'prorrogacao_excessiva'),
      makeFinding(undefined, 'pico_nomeacoes'),
      makeFinding(undefined, 'dispensa_irregular'),
    ]

    const resultado = fiscalGeral.consolidar({ findings, cityId: '4305108' })

    // Retorna os 3 originais sem meta-finding (sem CNPJ = não agrupável)
    expect(resultado).toHaveLength(3)
    const meta = resultado.filter(f => f.type === 'padrao_recorrente')
    expect(meta).toHaveLength(0)
  })
})
