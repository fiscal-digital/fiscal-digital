import { retryAfterMs, isRetryableStatus, MAX_RETRY_WAIT_MS } from '../retry'

describe('retry (compartilhado QD + BrasilAPI)', () => {
  it('isRetryableStatus: transitorio e rate limit sim; erro de cliente nao', () => {
    for (const s of [429, 502, 503, 504, 520, 522, 524]) expect(isRetryableStatus(s)).toBe(true)
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryableStatus(s)).toBe(false)
  })

  it('retryAfterMs: segundos, HTTP-date, teto e fallback', () => {
    expect(retryAfterMs(null, 3000)).toBe(3000)
    expect(retryAfterMs('5', 3000)).toBe(5000)
    expect(retryAfterMs('999', 3000)).toBe(MAX_RETRY_WAIT_MS)
    const now = Date.parse('2026-09-20T12:00:00Z')
    expect(retryAfterMs('Sun, 20 Sep 2026 12:00:10 GMT', 3000, now)).toBe(10_000)
    expect(retryAfterMs('lixo', 3000)).toBe(3000)
  })
})
