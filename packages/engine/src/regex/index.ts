const CNPJ_RE = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g
const VALUE_RE = /R\$\s*[\d.,]+/g
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g
const CONTRACT_RE = /(?:Contrato|Convênio|Ata)\s+(?:n[°º.]\s*)?(\d+\/\d{4})/gi

function normalizeCNPJ(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length !== 14) return raw
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

function parseValue(raw: string): number {
  // R$ 1.234.567,89 → 1234567.89
  return parseFloat(raw.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.'))
}

export function extractCNPJs(text: string): string[] {
  const matches = text.match(CNPJ_RE) ?? []
  return [...new Set(matches.map(normalizeCNPJ))]
}

export function extractValues(text: string): number[] {
  const matches = text.match(VALUE_RE) ?? []
  return matches.map(parseValue).filter(v => !isNaN(v) && v > 0)
}

export function extractDates(text: string): string[] {
  const dates: string[] = []
  const re = new RegExp(DATE_RE.source, DATE_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const [, day, month, year] = m
    const d = +day, mo = +month, y = +year
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2035) {
      dates.push(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`)
    }
  }
  return [...new Set(dates)]
}

export function extractContractNumbers(text: string): string[] {
  const numbers: string[] = []
  const re = new RegExp(CONTRACT_RE.source, CONTRACT_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    numbers.push(m[1])
  }
  return [...new Set(numbers)]
}

export function extractAll(text: string) {
  return {
    cnpjs: extractCNPJs(text),
    values: extractValues(text),
    dates: extractDates(text),
    contractNumbers: extractContractNumbers(text),
  }
}
