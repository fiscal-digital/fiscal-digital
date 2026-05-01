import type { Gazette } from '../../types'

const BASE_GAZETTE: Gazette = {
  id: 'gazette-test-001',
  territory_id: '4305108',
  date: '2026-03-15',
  url: 'https://queridodiario.ok.org.br/api/gazettes/4305108?excerpt=test',
  excerpts: [],
  edition: '1',
  is_extra: false,
}

// Caso 1 — Dispensa serviço R$ 80.000 (acima do teto II)
export const gazetteDispensaServicoAcimaTeto: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-001',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 012/2026. Objeto: contratação de serviços de consultoria em tecnologia da informação. Valor: R$ 80.000,00. Base Legal: Lei 14.133/2021, Art. 75, II. Contratada: Tech Solutions LTDA, CNPJ: 12.345.678/0001-90. Secretaria Municipal de Administração.',
  ],
}

// Caso 2 — Dispensa serviço R$ 30.000 (abaixo do teto II)
export const gazetteDispensaServicoAbaixoTeto: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-002',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 007/2026. Objeto: contratação de serviços de manutenção de equipamentos. Valor: R$ 30.000,00. Base Legal: Lei 14.133/2021, Art. 75, II. Contratada: Manutenções Brasil LTDA, CNPJ: 22.333.444/0001-55. Secretaria Municipal de Saúde.',
  ],
}

// Caso 3 — Dispensa serviço R$ 65.492,11 (exatamente no teto II)
export const gazetteDispensaServicoExatoTeto: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-003',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 018/2026. Objeto: prestação de serviços de assessoria jurídica. Valor: R$ 65.492,11. Base Legal: Lei 14.133/2021, Art. 75, II. Contratada: Advocacia Caxias LTDA, CNPJ: 33.444.555/0001-66. Secretaria Municipal de Finanças.',
  ],
}

// Caso 4 — Dispensa serviço R$ 65.492,12 (1 centavo acima do teto II)
export const gazetteDispensaServico1CentavoAcima: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-004',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 019/2026. Objeto: prestação de serviços de design gráfico. Valor: R$ 65.492,12. Base Legal: Lei 14.133/2021, Art. 75. Contratada: Criativo Studio LTDA, CNPJ: 44.555.666/0001-77. Secretaria Municipal de Comunicação.',
  ],
}

// Caso 5 — Obra de reforma R$ 150.000 (acima do teto I)
export const gazetteDispensaObraAcimaTeto: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-005',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 023/2026. Objeto: reforma do prédio da escola municipal. Valor: R$ 150.000,00. Base Legal: Lei 14.133/2021, Art. 75, I. Contratada: Construções Caxias LTDA, CNPJ: 55.666.777/0001-88. Secretaria Municipal de Educação.',
  ],
}

// Caso 6 — Obra de pavimentação R$ 125.000 (abaixo do teto I, acima do teto II)
export const gazetteDispensaObraAbaixoTetoI: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-006',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 025/2026. Objeto: obra de pavimentação da rua XV de Novembro. Valor: R$ 125.000,00. Base Legal: Lei 14.133/2021, Art. 75, I. Contratada: Pavimenta Sul LTDA, CNPJ: 66.777.888/0001-99. Secretaria Municipal de Obras.',
  ],
}

// Caso 7 — Gazette sem dispensa (nomeação)
export const gazetteNomeacao: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-007',
  excerpts: [
    'PORTARIA n° 142/2026. O Prefeito Municipal no uso das atribuições que lhe confere a Lei Orgânica Municipal, NOMEIA o servidor João da Silva para o cargo de Diretor de Departamento, junto à Secretaria Municipal de Administração, a partir de 01/03/2026.',
  ],
}

// Caso 8 — Fracionamento: 2 dispensas anteriores de R$ 25k + atual R$ 25k (soma R$ 75k > teto II)
export const gazetteDispensaFracionamento: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-008',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 030/2026. Objeto: serviços de limpeza e conservação. Valor: R$ 25.000,00. Base Legal: Lei 14.133/2021, Art. 75, II. Contratada: Limpeza Caxias LTDA, CNPJ: 77.888.999/0001-11. Secretaria Municipal de Administração.',
  ],
}

// Caso 9 — Não-fracionamento: 1 dispensa anterior R$ 25k + atual R$ 25k = R$ 50k (< teto II)
export const gazetteDispensaNaoFracionamento: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-009',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 031/2026. Objeto: serviços de jardinagem e paisagismo. Valor: R$ 25.000,00. Base Legal: Lei 14.133/2021, Art. 75, II. Contratada: Verde Parques LTDA, CNPJ: 88.999.000/0001-22. Secretaria Municipal de Obras.',
  ],
}

// Caso 10 — Risco baixo (riskScore < 60) para validar narrativa factual sem LLM
// Dispensa levemente acima do teto II para checar o template factual
export const gazetteDispensaBaixoRisco: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-010',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 035/2026. Objeto: serviços de tradução de documentos. Valor: R$ 65.500,00. Base Legal: Art. 75. Contratada: Traduções BR LTDA, CNPJ: 99.000.111/0001-33. Secretaria Municipal de Relações Internacionais.',
  ],
}

// Caso 11 — "Reforma de equipamento de informática" R$ 80k com subtype='compra'
// Falso negativo histórico: antes do MIT-01, "reforma" disparava OBRA_RE → inciso I (teto R$ 130k)
// → valor R$ 80k abaixo do teto → sem alerta. Com subtype='compra' → inciso II → dispara corretamente.
export const gazetteDispensaReformaEquipamento: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-011',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 041/2026. Objeto: reforma de equipamento de informática e substituição de componentes. Valor: R$ 80.000,00. Base Legal: Lei 14.133/2021, Art. 75, II. Contratada: InfoTech Soluções LTDA, CNPJ: 55.444.333/0001-22. Secretaria Municipal de Educação.',
  ],
}

// Caso 12 — Dispensa obra R$ 120k com subtype=null → fallback regex classifica como inciso I
// R$ 120k < teto I (R$ 130.984,20) → sem alerta. Valida que o fallback OBRA_RE ainda funciona
// corretamente quando o LLM não classifica (subtype null).
export const gazetteDispensaObraFallbackRegex: Gazette = {
  ...BASE_GAZETTE,
  id: 'gazette-test-012',
  excerpts: [
    'DISPENSA DE LICITAÇÃO n° 042/2026. Objeto: obra de ampliação do Centro Comunitário. Valor: R$ 120.000,00. Base Legal: Lei 14.133/2021, Art. 75, I. Contratada: Construtora Regional LTDA, CNPJ: 11.222.333/0001-44. Secretaria Municipal de Obras.',
  ],
}
