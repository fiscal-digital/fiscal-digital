/**
 * Helpers para o cache de PDFs em `gazettes.fiscaldigital.org`.
 *
 * O cache espelha o path do Querido Diário 1:1 — só troca o domínio.
 * Isso permite derivar a URL do CDN diretamente de qualquer URL QD,
 * sem precisar fazer lookup no DynamoDB.
 *
 * Exemplo:
 *   QD:  https://data.queridodiario.ok.org.br/3205200/2022-08-18/abc.pdf
 *   CDN: https://gazettes.fiscaldigital.org/3205200/2022-08-18/abc.pdf
 *
 * Convenção do collector: a chave S3 é exatamente o path da URL QD
 * (sem o prefixo do host). Backfill segue a mesma convenção.
 */

import crypto from 'node:crypto'

const QD_HOSTS = [
  'data.queridodiario.ok.org.br',
  'queridodiario.ok.org.br',
]

const CDN_HOST = 'gazettes.fiscaldigital.org'

/**
 * Converte uma URL de gazette do Querido Diário em URL do nosso cache CDN.
 * Retorna `null` se a URL não for do QD ou for inválida.
 */
export function pdfCacheUrl(qdSourceUrl: string | undefined | null): string | null {
  if (!qdSourceUrl) return null
  try {
    const u = new URL(qdSourceUrl)
    if (!QD_HOSTS.includes(u.hostname)) return null
    if (!u.pathname.toLowerCase().endsWith('.pdf')) return null
    return `https://${CDN_HOST}${u.pathname}`
  } catch {
    return null
  }
}

/**
 * Extrai a chave S3 a partir da URL QD.
 * Path do URL QD = chave S3. Retorna `null` se URL inválida.
 *
 * Usado pelo collector e pelo backfill.
 */
export function pdfCacheS3Key(qdSourceUrl: string | undefined | null): string | null {
  if (!qdSourceUrl) return null
  try {
    const u = new URL(qdSourceUrl)
    if (!QD_HOSTS.includes(u.hostname)) return null
    // Remove leading slash do pathname para virar chave S3 válida
    const key = u.pathname.replace(/^\//, '')
    if (!key.toLowerCase().endsWith('.pdf')) return null
    return key
  } catch {
    return null
  }
}

export const GAZETTES_CDN_HOST = CDN_HOST

/**
 * Chave de idempotência derivada da URL da gazette. **Estável por URL** —
 * substitui `gazette.id` do Querido Diário, que pode mudar entre queries para
 * a mesma URL e por isso causa duplicação em DDB.
 *
 * Para URLs do QD: retorna `{territory_id}#{date}#{filenameHash}` extraído do
 * path. O `filenameHash` já é SHA1 do conteúdo do PDF (convenção do QD), então
 * é determinístico por documento.
 *
 * Para URLs não-QD (não temos hoje, mas resiliente para o futuro): retorna
 * `URLHASH#{sha256-32chars}` calculado da URL inteira.
 *
 * Retorna `null` se a URL é vazia/inválida — caller deve cair no fallback.
 *
 * Use como pk de gazettes (`GAZETTE#{key}`) e prefixo de pks de memória dos
 * Fiscais (`DISPENSA#{key}#...`, `ADITIVO#{key}#...` etc).
 */
export function gazetteKey(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (QD_HOSTS.includes(u.hostname)) {
      const m = u.pathname.match(/^\/(\d+)\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]+)\.pdf$/i)
      if (m) return `${m[1]}#${m[2]}#${m[3]}`
    }
    return `URLHASH#${crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)}`
  } catch {
    return null
  }
}
