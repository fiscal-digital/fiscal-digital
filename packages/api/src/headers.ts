import crypto from 'node:crypto'
import type { APIGatewayProxyResultV2 } from 'aws-lambda'

/**
 * Headers de citação, atribuição e cache para a API pública.
 *
 * Decora toda resposta JSON/RSS com metadata que LLMs e crawlers agênticos
 * consomem para preservar atribuição correta (Querido Diário/OKFN + Fiscal
 * Digital) e habilitar cache eficiente via ETag/If-None-Match.
 *
 * Blueprint AI SEO Onda 1, Item 3 (Seções 5 e 6.6).
 */

const SITE_URL = 'https://fiscaldigital.org'
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

/**
 * Calcula ETag estável (strong, sha1 truncado em 16 chars) a partir do body
 * já serializado. Não inclui timestamp ou outras fontes voláteis — o objetivo
 * é que duas respostas idênticas em conteúdo retornem o mesmo ETag e
 * habilitem 304 Not Modified.
 */
export function computeEtag(body: string): string {
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)
  return `"${hash}"`
}

/**
 * Headers de citação + cache. Inclui CORS permissivo (`*`) porque a API é
 * pública por design e já é consumida por browsers (site fiscaldigital.org)
 * e por agentes server-side. ETag derivado do body via computeEtag.
 *
 * Last-Modified usa o instante atual da resposta — não casa com ETag para
 * fins de revalidação. O Last-Modified está aqui apenas como sinal informativo
 * para readers RSS e crawlers que preferem essa heurística; revalidação real
 * usa If-None-Match.
 */
export function citationHeaders(
  body: string,
  contentType: string,
  maxAge = 30,
): Record<string, string> {
  return {
    'content-type': contentType,
    'cache-control': `public, max-age=${maxAge}, must-revalidate`,
    etag: computeEtag(body),
    'last-modified': new Date().toUTCString(),
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'x-source': 'queridodiario.ok.org.br',
    'x-license': 'CC-BY-4.0',
    'x-attribution': 'Fiscal Digital (fiscaldigital.org)',
    link: `<${SITE_URL}>; rel="canonical", <${LICENSE_URL}>; rel="license"`,
  }
}

/**
 * Headers para preflight CORS (OPTIONS). Permite que browsers chamem qualquer
 * endpoint da API sem proxy. Lista métodos suportados + qualquer header de
 * request comum.
 */
export function corsPreflightHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type, If-None-Match, If-Modified-Since',
    'access-control-max-age': '86400',
  }
}

/**
 * Resposta 304 Not Modified — body vazio, apenas ETag de volta para o cliente
 * confirmar o cache match. Crawlers educados (GPTBot, ClaudeBot, CCBot) usam
 * esse padrão para evitar re-download de conteúdo inalterado.
 */
export function notModified(etag: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 304,
    headers: {
      etag,
      'cache-control': 'public, max-age=30, must-revalidate',
    },
    body: '',
  }
}
