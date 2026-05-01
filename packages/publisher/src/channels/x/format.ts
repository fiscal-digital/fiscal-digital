import { getCityOrFallback, type Finding } from '@fiscal-digital/engine'

const X_TWEET_LIMIT = 280
const X_URL_LENGTH = 23 // t.co wrapping length, conforme docs.x.com
const ELLIPSIS = '…'

const FINDING_LABEL: Record<string, string> = {
  fracionamento: 'FRACIONAMENTO',
  cnpj_jovem: 'CNPJ JOVEM',
  aditivo_abusivo: 'ADITIVO',
  prorrogacao_excessiva: 'PRORROGAÇÃO',
  pico_nomeacoes: 'NOMEAÇÕES',
  concentracao_fornecedor: 'CONCENTRAÇÃO',
  dispensa_irregular: 'DISPENSA',
  inexigibilidade_sem_justificativa: 'INEXIGIBILIDADE',
}

function formatBRL(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

/**
 * Calcula o tamanho efetivo de um tweet para fins de limite do X.
 * URLs (https://...) são contadas como 23 chars cada, independente do tamanho real.
 */
export function tweetLength(text: string): number {
  const urlRegex = /https?:\/\/\S+/g
  const urls = text.match(urlRegex) ?? []
  let length = text.length
  for (const url of urls) {
    length = length - url.length + X_URL_LENGTH
  }
  return length
}

function truncateNarrative(narrative: string, available: number): string {
  if (narrative.length <= available) return narrative
  if (available <= 1) return ELLIPSIS
  return narrative.slice(0, available - 1).trimEnd() + ELLIPSIS
}

/**
 * Formata Finding como tweet único cabendo em 280 chars.
 *
 * Layout:
 *   🔍 [TIPO] [Cidade]
 *   [narrativa compacta — truncada se necessário]
 *
 *   [valor • secretaria]
 *   ⚖️ [base legal compacta]
 *   🔗 [URL Querido Diário]
 *   #FiscalDigital #[Cidade]
 *
 * Fonte é OBRIGATÓRIA — finding sem evidence.source não pode ser publicado.
 */
export function formatTweet(finding: Finding): string {
  const city = getCityOrFallback(finding.cityId)
  const tipo = FINDING_LABEL[finding.type] ?? finding.type.toUpperCase()
  const source = finding.evidence[0]?.source ?? ''

  if (!source) {
    throw new Error(
      `Finding ${finding.id ?? '<sem id>'} sem evidence.source — princípio "sempre citar a fonte" violado`,
    )
  }

  // Header
  const header = `🔍 ${tipo} ${city.name}`

  // Linha de meta (valor + secretaria, opcional)
  const metaParts: string[] = []
  if (finding.value !== undefined) metaParts.push(formatBRL(finding.value))
  if (finding.secretaria) metaParts.push(finding.secretaria)
  const metaLine = metaParts.length > 0 ? metaParts.join(' • ') : ''

  // Base legal compacta (primeira parte antes da vírgula, ex: "Lei 14.133/2021")
  const legalCompact = finding.legalBasis.split(',')[0].trim()
  const legalLine = `⚖️ ${legalCompact}`

  // Fonte e hashtags
  const sourceLine = `🔗 ${source}`
  const hashtagLine = `#FiscalDigital #${city.hashtag}`

  // Calcula chars fixos (tudo exceto narrativa)
  const fixedSections = [header, '', metaLine, legalLine, sourceLine, hashtagLine].filter(
    (s, i, arr) => !(s === '' && (i === 0 || arr[i - 1] === '')),
  )
  const fixedText = fixedSections.join('\n')
  const fixedLength = tweetLength(fixedText)

  // Espaço disponível para narrativa: limit - fixed - 2 (\n + \n separadores)
  const narrativeAvailable = X_TWEET_LIMIT - fixedLength - 2

  if (narrativeAvailable <= 10) {
    // Caso degenerado — finding com muita meta. Drop narrative.
    return fixedText
  }

  const narrative = truncateNarrative(finding.narrative, narrativeAvailable)

  // Reconstrói com narrativa
  const lines: string[] = [header, narrative]
  if (metaLine) lines.push(metaLine)
  lines.push(legalLine, sourceLine, hashtagLine)

  let tweet = lines.join('\n')

  // Defesa: se mesmo após truncamento passou (caso meta line longa), corta narrativa mais
  while (tweetLength(tweet) > X_TWEET_LIMIT && narrative.length > 1) {
    const newNarrative = truncateNarrative(narrative, narrativeAvailable - 5)
    lines[1] = newNarrative
    tweet = lines.join('\n')
    if (newNarrative === narrative) break
  }

  return tweet
}
