import type { Gazette } from '../../types'

const BASE_GAZETTE: Gazette = {
  id: 'gazette-fornecedores-001',
  territory_id: '4305108',
  date: '2026-03-15',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=fornecedores-test',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

// Caso 1 — CNPJ aberto há 3 meses (2025-12-01) → dispara cnpj_jovem
export const gazetteContratoFornecedorJovem: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-fornecedores-001',
  date: '2026-03-15',
  excerpts: [
    'CONTRATO n° 012/2026. Objeto: prestação de serviços de consultoria em TI. ' +
    'Valor: R$ 48.000,00. Contratada: Nova Tech Soluções LTDA, CNPJ: 55.111.222/0001-33. ' +
    'Secretaria Municipal de Administração. Vigência: 12 meses.',
  ],
}

// Caso 2 — CNPJ aberto há 5 anos (2021-01-10) → não dispara
export const gazetteContratoFornecedorAntigo: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-fornecedores-002',
  date: '2026-03-15',
  excerpts: [
    'CONTRATO n° 013/2026. Objeto: fornecimento de material de escritório. ' +
    'Valor: R$ 30.000,00. Contratada: Papelaria RS LTDA, CNPJ: 66.222.333/0001-44. ' +
    'Secretaria Municipal de Educação. Vigência: 6 meses.',
  ],
}

// Caso 3 — Excerpt sem CNPJ extraído → retorna []
export const gazetteContratoSemCnpj: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-fornecedores-003',
  date: '2026-03-15',
  excerpts: [
    'CONTRATO n° 014/2026. Objeto: serviços de limpeza urbana. ' +
    'Valor: R$ 20.000,00. Contratada: Limpeza Caxias. ' +
    'Secretaria Municipal de Obras.',
  ],
}

// Caso 4 — validateCNPJ retorna nao_encontrado → log + skip silencioso (retorna [])
export const gazetteContratoNaoEncontrado: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-fornecedores-004',
  date: '2026-03-15',
  excerpts: [
    'CONTRATO n° 015/2026. Objeto: prestação de serviços de segurança patrimonial. ' +
    'Valor: R$ 60.000,00. Contratada: Segurança Total LTDA, CNPJ: 99.888.777/0001-11. ' +
    'Secretaria Municipal de Saúde.',
  ],
}

// Caso 5 — 4 contratos mesmo CNPJ mesma secretaria no excerpt → dispara concentracao_fornecedor
export const gazetteConcentracaoFornecedor: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-fornecedores-005',
  date: '2026-03-15',
  excerpts: [
    'CONTRATOS nos 016, 017, 018, 019/2026 — Secretaria Municipal de Saúde. ' +
    'Objeto: serviços de saúde especializados. ' +
    'Contratada: MegaSaúde Serviços LTDA, CNPJ: 44.555.666/0001-77 (contrato 016), ' +
    'CNPJ: 44.555.666/0001-77 (contrato 017), ' +
    'CNPJ: 44.555.666/0001-77 (contrato 018), ' +
    'CNPJ: 44.555.666/0001-77 (contrato 019). ' +
    'Valores: R$ 50.000,00 cada.',
  ],
}

// Caso 6 — Contratos diversificados (CNPJs distintos) → não dispara concentracao_fornecedor
export const gazetteContratosDiversificados: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-fornecedores-006',
  date: '2026-03-15',
  excerpts: [
    'CONTRATOS nos 020, 021/2026 — Secretaria Municipal de Educação. ' +
    'Contrato 020: CNPJ: 11.111.111/0001-11, valor R$ 20.000,00. ' +
    'Contrato 021: CNPJ: 22.222.222/0001-22, valor R$ 25.000,00.',
  ],
}

// Gazette sem nenhum termo de contratação (filtro etapa 1) → retorna []
export const gazetteNomeacaoFornecedores: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-fornecedores-007',
  excerpts: [
    'PORTARIA n° 200/2026. O Prefeito Municipal NOMEIA João da Silva para o cargo de ' +
    'Assessor Técnico junto à Secretaria Municipal de Finanças, a partir de 01/03/2026.',
  ],
}
