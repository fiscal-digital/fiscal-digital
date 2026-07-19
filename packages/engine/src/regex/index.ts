// CNPJ — aceita o formato numérico legado (14 dígitos) E o alfanumérico novo
// (Lei 14.973/2024 / IN RFB nº 2.229/2024, vigência 07/2026): 12 caracteres
// alfanuméricos (raiz + ordem) + 2 dígitos verificadores SEMPRE numéricos.
// `[A-Z\d]` cobre os dois formatos — dígito é subconjunto de alfanumérico —
// então nenhuma captura numérica legada deixa de bater. Flag `i` porque
// texto de diário pode trazer a letra em minúscula por erro de digitação;
// `normalizeCNPJ` sempre uppercase o resultado.
//
// `\b` nas duas pontas (revisão adversarial do PR #97): alargar para
// `[A-Z\d]` sem âncora deixaria o regex casar substrings de 14 caracteres
// dentro de tokens alfanuméricos maiores e não-relacionados a CNPJ — ex.:
// chassi `9BWZZZ377VT004251` ou `PORTARIASEQUENCIAL2026` (a cauda
// `SEQUENCIAL2026` bateria as 14 posições). `\b` exige que o match comece/
// termine numa fronteira de palavra, então só compara contra tokens
// isolados — não elimina falsos positivos que sejam eles mesmos um token
// de 14 caracteres (ex.: `SEI23067000123`, `2026NE00012345`); esses são
// descartados pelo filtro de dígito verificador em `extractCNPJs`.
const CNPJ_RE = /\b[A-Z\d]{2}\.?[A-Z\d]{3}\.?[A-Z\d]{3}\/?[A-Z\d]{4}-?\d{2}\b/gi
const VALUE_RE = /R\$\s*[\d.,]+/g
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g
const CONTRACT_RE = /(?:Contrato|Convênio|Ata)\s+(?:n[°º.]\s*)?(\d+\/\d{4})/gi

/**
 * Módulo 11 — pesos padrão do CNPJ (inalterados pelo CNPJ alfanumérico; a
 * IN RFB 2.229/2024 mantém a fórmula, só troca a conversão de caractere
 * para valor). `weights[i+1..12]` calcula DV1 sobre os 12 primeiros
 * caracteres; `weights[0..11]` + `weights[12]*dv1` calcula DV2 sobre os
 * 12 + DV1. Fonte: Receita Federal, "Manual de Cálculo do DV do CNPJ
 * Alfanumérico" (gov.br/receitafederal/.../documentos-tecnicos/cnpj) —
 * algoritmo replicado a partir do código de referência publicado pela RFB
 * (github.com/marcelo-lourenco/validador-cnpj-alfanumerico) e conferido
 * neste PR contra o CNPJ numérico conhecido 11.222.333/0001-81 (DV 8-1).
 */
const CNPJ_DV_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

function normalizeCNPJ(raw: string): string {
  // Preserva letras (CNPJ alfanumérico) — remove apenas máscara e espaços,
  // depois uppercase. NUNCA usar /\D/g aqui: isso descarta os caracteres
  // alfabéticos do CNPJ novo e corrompe o valor.
  const clean = raw.replace(/[.\-/\s]/g, '').toUpperCase()
  if (clean.length !== 14) return raw
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12)}`
}

/**
 * Valida o dígito verificador de um CNPJ — numérico legado OU alfanumérico
 * (Lei 14.973/2024 / IN RFB nº 2.229/2024). Aceita com ou sem máscara.
 *
 * Conversão de caractere para valor: código ASCII do caractere menos o
 * código ASCII de '0' (ASCII - 48). Dígitos '0'-'9' mantêm valor 0-9;
 * letras 'A'-'Z' (maiúsculas) mapeiam para 17-42. Os 2 dígitos
 * verificadores finais são sempre numéricos.
 */
export function isValidCNPJ(raw: string): boolean {
  const clean = raw.replace(/[.\-/\s]/g, '').toUpperCase()
  if (!/^[A-Z0-9]{12}\d{2}$/.test(clean)) return false
  if (/^0+$/.test(clean)) return false

  const base = clean.slice(0, 12)
  const zeroCode = '0'.charCodeAt(0)

  let sumDV1 = 0
  let sumDV2 = 0
  for (let i = 0; i < 12; i++) {
    const value = base.charCodeAt(i) - zeroCode
    sumDV1 += value * CNPJ_DV_WEIGHTS[i + 1]
    sumDV2 += value * CNPJ_DV_WEIGHTS[i]
  }

  const remDV1 = sumDV1 % 11
  const dv1 = remDV1 < 2 ? 0 : 11 - remDV1
  sumDV2 += dv1 * CNPJ_DV_WEIGHTS[12]

  const remDV2 = sumDV2 % 11
  const dv2 = remDV2 < 2 ? 0 : 11 - remDV2

  return clean.slice(12) === `${dv1}${dv2}`
}

function parseValue(raw: string): number {
  // R$ 1.234.567,89 → 1234567.89
  return parseFloat(raw.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.'))
}

export function extractCNPJs(text: string): string[] {
  // Revisão adversarial do PR #97 (BLOQUEANTE): o regex alargado para
  // alfanumérico casa qualquer token de 14 caracteres no formato certo,
  // inclusive códigos que não são CNPJ (SEI, empenho, chassi/RENAVAM,
  // portaria concatenada). Filtrar por `isValidCNPJ` (dígito verificador,
  // módulo 11) antes de retornar evita candidatos falsos que inflariam
  // chamadas à BrasilAPI/CGU (Camada 2) e poluiriam o cache/DDB com
  // "fornecedores" que não existem.
  const matches = text.match(CNPJ_RE) ?? []
  return [...new Set(matches.map(normalizeCNPJ))].filter(isValidCNPJ)
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
