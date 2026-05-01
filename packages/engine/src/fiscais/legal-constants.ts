// Decreto 12.807/2025, vigência 2026-01-01. Reajuste anual via IPCA-E (Lei 14.133/2021, Art. 182).
// TODO(legal-constants): revisar em janeiro de cada ano.
// Ref: https://www.gov.br/compras/pt-br/acesso-a-informacao/comunicados/2025/no-47-25-decreto-altera-valores-da-lei-14-133-para-compras-publicas

export const LEI_14133_ART_75_I_LIMITE = 130984.20  // obras e serviços de engenharia
export const LEI_14133_ART_75_II_LIMITE = 65492.11  // demais serviços e compras
export const DECRETO_REFERENCIA = '12.807/2025'
export const VIGENCIA_DESDE = '2026-01-01'

/**
 * Lei 14.133/2021, Art. 125, §1º, I — Limite de aditivo para obras, serviços e compras em geral.
 * 25% do valor original do contrato.
 * TODO(legal-constants): verificar se decreto futuro altera este limite (Art. 125 não indexado ao IPCA-E).
 */
export const LEI_14133_ART_125_LIMITE_GERAL = 0.25   // 25% — obras, serviços e compras (inciso I)

/**
 * Lei 14.133/2021, Art. 125, §1º, II — Limite de aditivo para reforma de edifícios ou equipamentos.
 * 50% do valor original do contrato.
 * TODO(legal-constants): verificar se decreto futuro altera este limite.
 */
export const LEI_14133_ART_125_LIMITE_REFORMA = 0.50 // 50% — reforma de edifício/equipamento (inciso II)

/**
 * Lei 14.133/2021, Art. 107, caput — Vigência máxima de contratos de serviços contínuos.
 * Contratos com vigência total acima de 10 anos devem ser revistos.
 * TODO(legal-constants): verificar regulamentação futura de contratos específicos (Art. 107 §1º e §2º).
 */
export const LEI_14133_ART_107_VIGENCIA_MAXIMA_ANOS = 10 // decenal — Art. 107 caput
