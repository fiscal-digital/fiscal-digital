/**
 * Feriados nacionais via BrasilAPI + cache em memória por instância Lambda.
 *
 * Estratégia:
 *   1. Primeira chamada para um ano → fetch BrasilAPI /feriados/v1/{year} (timeout 3s)
 *   2. Resultado armazenado em Map<year, Set<string>> — persiste entre invocações warm
 *   3. Se API falhar → fallback para Set estático pré-calculado importado de diarias.ts
 *
 * Zero dependência de DynamoDB ou Secrets Manager.
 * Zero mudança na assinatura síncrona de isFeriadoNacional (callers não precisam mudar).
 */

import { FERIADOS_NACIONAIS } from '../diarias'

const BRASIL_API_FERIADOS = 'https://brasilapi.com.br/api/feriados/v1'

interface BrasilAPIFeriado {
  date: string  // YYYY-MM-DD
  name: string
  type: string
}

// Cache module-level — persiste enquanto a instância Lambda está warm.
const cache = new Map<number, Set<string>>()

/**
 * Pré-carrega feriados nacionais do ano via BrasilAPI.
 * No-op se o ano já estiver em cache.
 * Chamar no início do analisar() antes de qualquer verificação de feriado.
 */
export async function preloadFeriadosNacionais(year: number): Promise<void> {
  if (cache.has(year)) return

  try {
    const res = await fetch(`${BRASIL_API_FERIADOS}/${year}`, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    })

    if (res.ok) {
      const data = (await res.json()) as BrasilAPIFeriado[]
      cache.set(year, new Set(data.map((f) => f.date)))
      return
    }
  } catch {
    // timeout, network error ou parse error — segue para fallback
  }

  // Fallback: filtra o Set estático para o ano solicitado
  const fallback = new Set<string>(
    [...FERIADOS_NACIONAIS].filter((d) => d.startsWith(`${year}-`)),
  )
  cache.set(year, fallback)
}

/**
 * Verifica se uma data ISO (YYYY-MM-DD) é feriado nacional.
 * Usa cache pré-carregado por preloadFeriadosNacionais.
 * Fallback síncrono ao Set estático se o cache ainda não foi populado.
 */
export function isFeriadoNacionalCached(dataISO: string): boolean {
  const year = parseInt(dataISO.slice(0, 4), 10)
  const cached = cache.get(year)
  if (cached) return cached.has(dataISO)
  // Cache frio (não houve preload) — usa Set estático como garantia
  return FERIADOS_NACIONAIS.has(dataISO)
}

/** Exporta o cache para inspeção em testes. */
export const _testHolidayCache = cache
