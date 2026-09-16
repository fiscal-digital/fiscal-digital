import { RateLimiter, type LimiterClock } from '../rate_limiter'

/**
 * Relogio falso: `sleep` so REGISTRA a espera pedida, nao avanca o tempo.
 *
 * Modelo fiel ao que se testa: a reserva de vaga depende de `nextSlot`, nunca
 * de quando um sono termina. Se o sono avancasse o relogio de forma sincrona,
 * a reserva seguinte ja veria o tempo adiantado e o teste mediria o relogio
 * falso, nao o limitador. Tempo passa so por `advance()`, explicitamente.
 */
function fakeClock(start = 0) {
  let t = start
  const waits: number[] = []
  const clock: LimiterClock = {
    now: () => t,
    sleep: async ms => {
      waits.push(ms)
    },
  }
  return { clock, waits, advance: (ms: number) => { t += ms } }
}

describe('RateLimiter — reserva de vaga', () => {
  it('50 chamadas concorrentes a 60/min recebem 50 vagas distintas, 1 s entre elas', async () => {
    // Regressao do bug medido em prod: a versao antiga deixava as 50 passarem
    // no mesmo segundo. Aqui cada uma tem que esperar a sua vaga.
    const { clock, waits } = fakeClock()
    const limiter = new RateLimiter(60, clock)

    await Promise.all(Array.from({ length: 50 }, () => limiter.acquire()))

    // A primeira nao espera; as outras 49 esperam 1s, 2s, ..., 49s.
    expect(waits).toHaveLength(49)
    expect([...waits].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 49 }, (_, i) => (i + 1) * 1000),
    )
    // Nenhuma vaga repetida — e exatamente o que a versao antiga violava.
    expect(new Set(waits).size).toBe(49)
  })

  it('chamadas sequenciais com tempo sobrando nao esperam', async () => {
    const { clock, waits, advance } = fakeClock()
    const limiter = new RateLimiter(60, clock)

    await limiter.acquire()
    advance(5_000)
    await limiter.acquire()
    advance(5_000)
    await limiter.acquire()

    expect(waits).toEqual([])
  })

  it('chamada logo apos outra espera exatamente o intervalo restante', async () => {
    const { clock, waits, advance } = fakeClock()
    const limiter = new RateLimiter(60, clock)

    await limiter.acquire()
    advance(300)
    await limiter.acquire()

    expect(waits).toEqual([700])
  })

  it('respeita a taxa configurada', async () => {
    const { clock, waits } = fakeClock()
    const limiter = new RateLimiter(120, clock) // 500 ms

    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()])

    expect([...waits].sort((a, b) => a - b)).toEqual([500, 1000])
  })

  it('rejeita taxa invalida', () => {
    expect(() => new RateLimiter(0)).toThrow(/deve ser > 0/)
    expect(() => new RateLimiter(-5)).toThrow(/deve ser > 0/)
  })

  it('com relogio real, chamadas concorrentes de fato se espacam', async () => {
    // Prova com timer real, taxa alta para o teste ser rapido:
    // 6000/min = 10 ms entre vagas; 6 chamadas => ao menos 50 ms no total.
    const limiter = new RateLimiter(6000)
    const t0 = Date.now()
    await Promise.all(Array.from({ length: 6 }, () => limiter.acquire()))
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45)
  })
})
