import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { createLogger, getCity, type Finding } from '@fiscal-digital/engine'

const logger = createLogger('web-revalidate')
const secretsClient = new SecretsManagerClient({})

// Locales do site — espelha `fiscal-digital-web/i18n/routing.ts`. Desde o
// web#81, `/pt` e `/en` são só redirects 308: revalidar esses paths não
// purgava página nenhuma.
export const WEB_LOCALES = ['pt-br', 'en-us'] as const

// Token lido do Secrets Manager pelo ARN (fiscal-digital#240) — o valor não
// fica mais na env da Lambda. Cache por container; null = já tentou e falhou.
let cachedSecret: string | null | undefined

async function loadRevalidateSecret(): Promise<string | null> {
  if (cachedSecret !== undefined) return cachedSecret
  const arn = process.env.WEB_REVALIDATE_SECRET_ARN
  if (!arn) {
    cachedSecret = null
    return null
  }
  try {
    const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }))
    cachedSecret = res.SecretString || null
  } catch (err) {
    logger.warn('falha ao ler o token de revalidate', {
      err: err instanceof Error ? err.message : String(err),
    })
    cachedSecret = null
  }
  return cachedSecret
}

/** @internal — testes */
export function _resetRevalidateSecretForTests(): void {
  cachedSecret = undefined
}

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://fiscaldigital.org'
const REVALIDATE_TIMEOUT_MS = 5_000

/**
 * Notifica o site (route handler /api/revalidate) que cache de páginas
 * deve ser purgado imediatamente após publish. Reduz lag de ≤60s
 * (revalidate ISR) para ≤5s.
 *
 * Best-effort:
 * - Sem token (WEB_REVALIDATE_SECRET_ARN ausente ou ilegível) → loga e retorna
 * - Falha de rede / 4xx / 5xx → loga e retorna (publish já é sucesso)
 * - Timeout 5s — não bloqueia processamento de SQS
 *
 * Paths revalidados, para cada locale de WEB_LOCALES:
 * - /<locale>                 (Home — métricas atualizam)
 * - /<locale>/alertas         (feed global)
 * - /<locale>/alertas/<id>    (página do finding)
 * - /<locale>/cidades/<slug>  (painel da cidade)
 */
export async function notifyWebRevalidate(finding: Finding): Promise<void> {
  const secret = await loadRevalidateSecret()
  if (!secret) {
    logger.warn('token de revalidate indisponível — pulando revalidate')
    return
  }

  const findingId = finding.id ?? ''
  if (!findingId) {
    logger.warn('finding sem id — pulando revalidate')
    return
  }

  const city = getCity(finding.cityId)
  const citySlug = city?.slug

  const paths = WEB_LOCALES.flatMap(locale => [
    `/${locale}`,
    `/${locale}/alertas`,
    `/${locale}/alertas/${findingId}`,
    ...(citySlug ? [`/${locale}/cidades/${citySlug}`] : []),
  ])

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
