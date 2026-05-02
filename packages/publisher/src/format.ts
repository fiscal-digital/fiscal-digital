import { getCityOrFallback, type Finding } from '@fiscal-digital/engine'

/**
 * Mapeamento de FindingType → descrição curta para o campo ⚠️ do alerta.
 * Textos factuais — nunca acusatórios.
 */
const FINDING_REASON: Record<string, string> = {
  fracionamento: 'Possível fracionamento de despesa para fugir de licitação',
  cnpj_jovem: 'Empresa com menos de 6 meses na data da contratação',
  aditivo_abusivo: 'Aditivo contratual superior ao limite legal de 25%',
  prorrogacao_excessiva: 'Prorrogação contratual que pode exceder prazo legal',
  pico_nomeacoes: 'Volume de nomeações acima da média histórica no período',
  concentracao_fornecedor: 'Concentração de contratos acima de 40% por secretaria',
  dispensa_irregular: 'Dispensa de licitação com indícios de irregularidade',
  inexigibilidade_sem_justificativa:
    'Inexigibilidade de licitação sem justificativa identificada',
  locacao_sem_justificativa:
    'Locação de imóvel sem menção a laudo de avaliação ou justificativa',
}

/**
 * Formata um número como valor monetário brasileiro.
 * Ex: 123456.78 → "123.456,78"
 */
function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Converte uma data ISO (YYYY-MM-DD) para o formato DD/MM/YYYY.
 */
function formatDateBR(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}/${month}/${year}`
}

/**
 * Formata um Finding no template de alerta do CLAUDE.md ("Formato de Alerta Publicado").
 * Campos opcionais são omitidos se ausentes.
 */
export function formatAlertText(finding: Finding): string {
  const tipo = finding.type.replace(/_/g, '-').toUpperCase()
  const city = getCityOrFallback(finding.cityId)
  const evidenceDate =
    finding.evidence.length > 0 ? finding.evidence[0].date : ''
  const source =
    finding.evidence.length > 0 ? finding.evidence[0].source : ''

  const lines: string[] = []

  lines.push(`🔍 ${tipo} — ${city.name}`)
  lines.push('')
  lines.push(finding.narrative)

  if (finding.contractNumber) {
    lines.push('')
    lines.push(`📋 ${finding.contractNumber}`)
  }

  if (finding.value !== undefined) {
    lines.push(`💰 Valor: R$ ${formatBRL(finding.value)}`)
  }

  if (finding.cnpj) {
    // Supplier name não está no Finding; usa CNPJ com placeholder
    // TODO: enriquecer com razaoSocial via lookup_memory ou validate_cnpj
    lines.push(`🏢 Fornecedor: (CNPJ: ${finding.cnpj})`)
  }

  if (finding.secretaria) {
    lines.push(`🏛️ Secretaria: ${finding.secretaria}`)
  }

  if (evidenceDate) {
    lines.push(`📅 Data: ${formatDateBR(evidenceDate)}`)
  }

  lines.push('')

  const reason = FINDING_REASON[finding.type] ?? finding.type
  lines.push(`⚠️ ${reason}`)
  lines.push(`⚖️ Base legal: ${finding.legalBasis}`)

  if (source) {
    lines.push('')
    lines.push(`🔗 Fonte: ${source}`)
  }

  lines.push(`#FiscalDigital #${city.hashtag} #TransparênciaPublica`)

  return lines.join('\n')
}
