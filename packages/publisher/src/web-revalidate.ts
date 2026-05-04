import { createLogger, getCity, type Finding } from '@fiscal-digital/engine'

const logger = createLogger('web-revalidate')

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://fiscaldigital.org'
const REVALIDATE_TIMEOUT_MS = 5_000

/**
 * Notifica o site (route handler /api/revalidate) que cache de páginas
 * deve ser purgado imediatamente após publish. Reduz lag de ≤60s
 * (revalidate ISR) para ≤5s.
 *
 * Best-effort:
 * - Sem WEB_REVALIDATE_SECRET → loga e retorna (publish segue normal)
 * - Falha de rede / 4xx / 5xx → loga e retorna (publish já é sucesso)
 * - Timeout 5s — não bloqueia processamento de SQS
 *
 * Paths revalidados (PT + EN):
 * - /pt-br             (Home — métricas atualizam)
 * - /pt-br/alertas     (feed global)
 * - /pt-br/alertas/<id>  (página do finding)
 * - /pt-br/cidades/<slug>  (painel da cidade)
 * - /en + counterparts em EN
 */
export async function notifyWebRevalidate(finding: Finding): Promise<void> {
  const secret = process.env.WEB_REVALIDATE_SECRET
  if (!secret) {
    logger.warn('WEB_REVALIDATE_SECRET ausente — pulando revalidate')
    return
  }

  const findingId = finding.id ?? ''
  if (!findingId) {
    logger.warn('finding sem id — pulando revalidate')
    return
  }

  const city = getCity(finding.cityId)
  const citySlug = city?.slug

  const paths = ['/pt-br', '/pt-br/alertas', `/pt-br/alertas/${findingId}`]
  if (citySlug) paths.push(`/pt-br/cidades/${citySlug}`)
  paths.push('/en', '/en/alertas', `/en/alertas/${findingId}`)
  if (citySlug) paths.push(`/en/cidades/${citySlug}`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS)

  try {
    const res = await fetch(`${WEB_BASE_URL}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ paths }),
      signal: controller.signal,
    })

    if (!res.ok) {
      logger.warn('revalidate retornou erro', {
        findingId,
        status: res.status,
        body: await res.text().catch(() => '<unreadable>'),
      })
      return
    }

    const data = (await res.json().catch(() => null)) as
      | { count?: number }
      | null
    logger.info('site revalidado', {
      findingId,
      paths: paths.length,
      count: data?.count ?? null,
    })
  } catch (err) {
    logger.warn('revalidate falhou (best-effort, ignorado)', {
      findingId,
      err: err instanceof Error ? err.message : String(err),
    })
  } finally {
    clearTimeout(timeout)
  }
}
