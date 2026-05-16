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
 * Headers de citação + cache. ETag derivado do body via computeEtag.
 *
 * Last-Modified usa o instante atual da resposta — não casa com ETag para
 * fins de revalidação. Last-Modified está aqui apenas como sinal informativo
 * para readers RSS e crawlers que preferem essa heurística; revalidação real
 * usa If-None-Match.
 *
 * CORS NÃO é gerenciado aqui (LRN-20260516-002). Lambda Function URL com
 * `cors { allow_origins = ["*"] }` já adiciona `Access-Control-Allow-Origin`
 * automaticamente, refletindo o `Origin` header da request. Adicionar `*`
 * aqui causava duplicação no wire ("*, https://fiscaldigital.org"); browser
 * rejeitava com CORS error. Resultado: site não conseguia carregar /alerts.
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
    'x-source': 'queridodiario.ok.org.br',
    'x-license': 'CC-BY-4.0',
    'x-attribution': 'Fiscal Digital (fiscaldigital.org)',
    link: `<${SITE_URL}>; rel="canonical", <${LICENSE_URL}>; rel="license"`,
  }
}

/**
 * Headers para OPTIONS preflight quando a request chega no handler. Em prática,
 * a Lambda Function URL responde preflight sem invocar a Lambda (LRN-20260503-027);
 * este handler é fallback. Não inclui `access-control-allow-origin` para
 * evitar duplicação (LRN-20260516-002) — Function URL já adiciona.
 */
export function corsPreflightHeaders(): Record<string, string> {
  return {
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
