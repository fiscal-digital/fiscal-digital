/**
 * Retentativa única para fontes externas (Querido Diário, BrasilAPI).
 *
 * A regra é a mesma para todas: UMA nova tentativa em 429/5xx transitório ou
 * falha de rede, honrando `Retry-After` quando vier (segundos ou HTTP-date),
 * com teto para não segurar a Lambda até o timeout. Mais que uma retentativa
 * é carga em cima de quem já está caído — e as fontes que usamos pedem
 * "bom senso" (QD) e "natureza de uma pessoa real" (BrasilAPI), não volume.
 *
 * Nasceu em query_diario.ts (instabilidade do QD em 14-15/09/2026) e foi
 * extraído para cá quando validate_cnpj.ts precisou do mesmo desenho.
 */
export const RETRYABLE_STATUS = new Set([429, 502, 503, 504, 520, 522, 524])
export const MAX_RETRY_WAIT_MS = 30_000

export function retryAfterMs(header: string | null | undefined, fallbackMs: number, now = Date.now()): number {
  if (!header) return fallbackMs
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS)
  const at = Date.parse(header)
  if (!Number.isNaN(at)) return Math.min(Math.max(0, at - now), MAX_RETRY_WAIT_MS)
  return fallbackMs
}

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status)
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
