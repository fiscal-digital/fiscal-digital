import { RateLimitError } from '../channels/types'

/**
 * Token bucket em-memória para controlar taxa de posts no Reddit.
 * 60 posts por janela deslizante de 60 segundos (Reddit API: 60 req/10min).
 *
 * Válido para uma invocação Lambda única — suficiente para o MVP.
 * Em caso de múltiplas instâncias concorrentes, o rate limit do servidor
 * (via x-ratelimit-remaining no RedditClient) serve como segunda camada.
 */

const MAX_PER_MINUTE = 60
const WINDOW_MS = 60_000

// Exportado apenas para facilitar reset em testes
export const timestamps: number[] = []

/**
 * Verifica se é seguro fazer mais um post no Reddit.
 * Remove timestamps expirados e conta os que restam na janela atual.
 * Lança RateLimitError se o limite foi atingido, incluindo quantos segundos aguardar.
 *
 * @throws {RateLimitError} quando >= 60 posts foram feitos no último minuto
 */
export function checkRedditRateLimit(): void {
  const now = Date.now()

  // Remove timestamps fora da janela deslizante
  while (timestamps.length > 0 && now - timestamps[0] > WINDOW_MS) {
    timestamps.shift()
  }

  if (timestamps.length >= MAX_PER_MINUTE) {
    const waitMs = WINDOW_MS - (now - timestamps[0]) + 100
    throw new RateLimitError(
      'reddit',
      Math.ceil(waitMs / 1000),
      `Reddit rate limit: ${timestamps.length} posts no último minuto`,
    )
  }

  timestamps.push(now)
}
