import { getCityOrFallback, type Finding } from '@fiscal-digital/engine'

const REDDIT_TITLE_LIMIT = 300
const REDDIT_BODY_LIMIT = 3_000
const FOOTER =
  '*Fiscal Digital — fiscalização autônoma de gastos públicos municipais.*'

/**
 * Mapeamento de FindingType → rótulo legível para o título do post Reddit.
 */
const FINDING_LABEL: Record<string, string> = {
  fracionamento: 'FRACIONAMENTO',
  cnpj_jovem: 'CNPJ JOVEM',
  aditivo_abusivo: 'ADITIVO',
  prorrogacao_excessiva: 'PRORROGAÇÃO',
  pico_nomeacoes: 'NOMEAÇÕES',
  rotatividade_anormal: 'ROTATIVIDADE',
  concentracao_fornecedor: 'CONCENTRAÇÃO',
  dispensa_irregular: 'DISPENSA',
  inexigibilidade_sem_justificativa: 'INEXIGIBILIDADE',
  padrao_recorrente: 'PADRÃO RECORRENTE',
}

/**
 * Mapeamento de FindingType → heading do corpo do post.
 * Textos factuais — nunca acusatórios.
 */
const FINDING_HEADING: Record<string, string> = {
  fracionamento: 'Identificamos um possível fracionamento de despesa',
  cnpj_jovem: 'Identificamos contratação de empresa com CNPJ recente',
  aditivo_abusivo: 'Identificamos aditivo contratual acima do limite legal',
  prorrogacao_excessiva: 'Identificamos prorrogação contratual potencialmente excessiva',
  pico_nomeacoes: 'Identificamos volume de nomeações acima da média histórica',
  rotatividade_anormal: 'Identificamos rotatividade de pessoal fora do padrão',
  concentracao_fornecedor: 'Identificamos concentração de contratos por fornecedor',
  dispensa_irregular: 'Identificamos dispensa de licitação com indícios de irregularidade',
  inexigibilidade_sem_justificativa:
    'Identificamos inexigibilidade de licitação sem justificativa',
  padrao_recorrente: 'Identificamos padrão recorrente de irregularidade',
}

/**
 * Formata um número como valor monetário brasileiro.
 * Ex: 123456.78 → "R$ 123.456,78"
 */
function formatBRL(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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
 * Trunca um texto adicionando "..." se exceder o limite.
 */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit - 3).trimEnd() + '...'
}

/**
 * Formata um Finding no template de post Reddit com markdown.
 *
 * Título: `[TIPO] Cidade — riskScore N/100`  (≤ 300 chars)
 * Body: heading + narrative + tabela de metadados + base legal + fonte + rodapé
 *
 * Regras:
 * - SEM hashtags (Reddit não usa hashtags como X)
 * - Tabela de metadados inclui apenas campos presentes no Finding
 * - Link do Querido Diário em formato markdown `[texto](url)`
 * - Body truncado em 3.000 chars se necessário
 *
 * @returns { title, body } prontos para client.submitText(token, subreddit, title, body)
 */
export function formatRedditPost(finding: Finding): { title: string; body: string } {
  const city = getCityOrFallback(finding.cityId)
  const label = FINDING_LABEL[finding.type] ?? finding.type.replace(/_/g, '-').toUpperCase()

  // --- Título ---
  const rawTitle = `[${label}] ${city.name} — riskScore ${finding.riskScore}/100`
  const title = truncate(rawTitle, REDDIT_TITLE_LIMIT)

  // --- Body ---
  const heading = FINDING_HEADING[finding.type] ?? `Identificamos ${label.toLowerCase()}`
  const lines: string[] = []

  lines.push(`## ${heading}`)
  lines.push('')
  lines.push(finding.narrative)
  lines.push('')

  // Tabela de metadados — apenas campos presentes
  const evidenceDate = finding.evidence.length > 0 ? finding.evidence[0].date : ''
  const tableRows: Array<[string, string]> = []

  if (finding.secretaria) tableRows.push(['Secretaria', finding.secretaria])
  if (finding.cnpj) tableRows.push(['Fornecedor', `CNPJ ${finding.cnpj}`])
  if (finding.value !== undefined) tableRows.push(['Valor', formatBRL(finding.value)])
  if (evidenceDate) tableRows.push(['Data', formatDateBR(evidenceDate)])
  if (finding.contractNumber) tableRows.push(['Contrato', finding.contractNumber])

  if (tableRows.length > 0) {
    lines.push('| Campo | Valor |')
    lines.push('|---|---|')
    for (const [campo, valor] of tableRows) {
      lines.push(`| ${campo} | ${valor} |`)
    }
    lines.push('')
  }

  lines.push(`⚖️ **Base legal:** ${finding.legalBasis}`)
  lines.push('')

  // Fonte — link markdown se houver evidence
  const source = finding.evidence.length > 0 ? finding.evidence[0].source : ''
  if (source) {
    lines.push(`🔗 **Fonte:** [Diário Oficial — Querido Diário](${source})`)
    lines.push('')
  }

  lines.push('---')
  lines.push(FOOTER)

  const rawBody = lines.join('\n')
  const body = truncate(rawBody, REDDIT_BODY_LIMIT)

  return { title, body }
}
