import type { Gazette } from '../../types'

const BASE_GAZETTE: Gazette = {
  id: 'gazette-contratos-001',
  territory_id: '4305108',
  date: '2026-03-15',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=contratos-test',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

// Caso 1 — Aditivo R$ 30k sobre contrato R$ 100k (lookup) → excede 25% → aditivo_abusivo
export const gazetteAditivo30kContrato100k: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-001',
  excerpts: [
    'TERMO ADITIVO n° 001/2026 ao Contrato n° 042/2024. Objeto: acréscimo de serviços de TI. Valor do aditivo: R$ 30.000,00. CNPJ: 12.345.678/0001-90. Empresa: Tech Solutions LTDA. Secretaria Municipal de Administração.',
  ],
}

// Caso 2 — Aditivo R$ 20k sobre contrato R$ 100k (lookup) → dentro do limite 20% < 25% → []
export const gazetteAditivo20kContrato100k: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-002',
  excerpts: [
    'TERMO ADITIVO n° 002/2026 ao Contrato n° 043/2024. Objeto: acréscimo de serviços de limpeza. Valor do aditivo: R$ 20.000,00. CNPJ: 22.333.444/0001-55. Empresa: Limpeza Caxias LTDA. Secretaria Municipal de Saúde.',
  ],
}

// Caso 3 — Aditivo R$ 25k exato (limite geral) sobre contrato R$ 100k → teto exato 25% → []
export const gazetteAditivo25kExatoContrato100k: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-003',
  excerpts: [
    'TERMO ADITIVO n° 003/2026 ao Contrato n° 044/2024. Objeto: reequilíbrio econômico-financeiro. Valor do aditivo: R$ 25.000,00. CNPJ: 33.444.555/0001-66. Empresa: Consultoria RS LTDA. Secretaria Municipal de Finanças.',
  ],
}

// Caso 4 — Aditivo R$ 25.000,01 (1 centavo acima do limite geral) sobre contrato R$ 100k → dispara
export const gazetteAditivo25k01Contrato100k: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-004',
  excerpts: [
    'TERMO ADITIVO n° 004/2026 ao Contrato n° 045/2024. Objeto: ampliação de prazo e escopo. Valor do aditivo: R$ 25.000,01. CNPJ: 44.555.666/0001-77. Empresa: Serviços Gerais LTDA. Secretaria Municipal de Obras.',
  ],
}

// Caso 5 — Reforma de edifício 40% sobre contrato R$ 100k → dentro do limite 50% reforma → []
export const gazetteAditivoReforma40k: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-005',
  excerpts: [
    'TERMO ADITIVO n° 005/2026 ao Contrato n° 046/2024. Objeto: acréscimo de serviços de reforma do edifício da sede. Valor do aditivo: R$ 40.000,00. CNPJ: 55.666.777/0001-88. Empresa: Construtora Caxias LTDA. Secretaria Municipal de Educação.',
  ],
}

// Caso 6 — Reforma de edifício R$ 51k sobre contrato R$ 100k → excede 50% → aditivo_abusivo Art. 125 §1º II
export const gazetteAditivoReforma51k: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-006',
  excerpts: [
    'TERMO ADITIVO n° 006/2026 ao Contrato n° 047/2024. Objeto: ampliação da reforma do edifício da escola municipal. Valor do aditivo: R$ 51.000,00. CNPJ: 66.777.888/0001-99. Empresa: Reformas RS LTDA. Secretaria Municipal de Educação.',
  ],
}

// Caso 7 — Gazette de nomeação (sem aditivo) → filtro etapa 1 retorna []
export const gazetteNomeacaoContratos: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-007',
  excerpts: [
    'PORTARIA n° 143/2026. O Prefeito Municipal NOMEIA Maria da Silva para o cargo de Coordenadora, junto à Secretaria Municipal de Saúde, a partir de 01/03/2026.',
  ],
}

// Caso 8 — Aditivo R$ 30k sem valor original (lookup vazio + valorOriginalContrato ausente) → skip []
export const gazetteAditivoSemValorOriginal: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-008',
  excerpts: [
    'TERMO ADITIVO n° 007/2026 ao Contrato n° 048/2024. Objeto: ampliação de escopo de serviços. Valor do aditivo: R$ 30.000,00. CNPJ: 77.888.999/0001-11. Empresa: Serviços Plus LTDA. Secretaria Municipal de Administração.',
  ],
}

// Caso 9 — Prorrogação de contrato firmado em 2020-01-01 → vigência < 10 anos em 2026 → []
export const gazetteProrrogacao2020: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-009',
  excerpts: [
    'PRORROGAÇÃO CONTRATUAL n° 001/2026 ao Contrato n° 010/2020. Objeto: prorrogação de contrato de serviços de limpeza e conservação. Novo prazo: até 31/12/2026. CNPJ: 88.999.000/0001-22. Empresa: Limpeza Total LTDA. Secretaria Municipal de Administração.',
  ],
}

// Caso 10 — Prorrogação de contrato firmado em 2014-01-01 + nova extensão 2026 → > 10 anos → prorrogacao_excessiva
export const gazetteProrrogacao2014: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-010',
  excerpts: [
    'PRORROGAÇÃO CONTRATUAL n° 002/2026 ao Contrato n° 005/2014. Objeto: prorrogação de contrato de serviços contínuos de vigilância patrimonial. Novo prazo: até 31/12/2026. CNPJ: 99.000.111/0001-33. Empresa: Vigilância Caxias LTDA. Secretaria Municipal de Segurança.',
  ],
}

// Caso 11 — Aditivo R$ 30k sobre contrato R$ 100k (lookup) → para validar narrativa factual
export const gazetteAditivo30kNarrativa: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-contratos-011',
  excerpts: [
    'TERMO ADITIVO n° 008/2026 ao Contrato n° 049/2024. Objeto: acréscimo de serviços adicionais. Valor do aditivo: R$ 30.000,00. CNPJ: 11.222.333/0001-44. Empresa: Serviços Regionais LTDA. Secretaria Municipal de Obras.',
  ],
}
