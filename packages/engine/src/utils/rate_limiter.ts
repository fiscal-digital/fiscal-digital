/**
 * Limitador de taxa com RESERVA DE VAGA.
 *
 * A versao anterior lia `lastCallAt`, esperava e so entao gravava. Sob
 * concorrencia isso nao limita nada: N chamadas simultaneas leem o mesmo
 * `lastCallAt`, calculam a mesma espera e disparam juntas. Medido em prod
 * (collector, 50 cidades em `Promise.allSettled`): 50 requisicoes ao Querido
 * Diario no MESMO segundo, todo dia util as 07:00 UTC, contra uma referencia
 * documentada de 60 por minuto. Cinquenta vezes acima.
 *
 * A correcao e reservar o proximo horario livre de forma SINCRONA, antes de
 * qualquer `await`. Cada chamada concorrente recebe uma vaga distinta:
 * 0, 1000, 2000, ... ms. So depois cada uma dorme ate a sua vaga.
 *
 * `clock` e injetavel para o teste ser deterministico e instantaneo — o teste
 * de concorrencia e o que teria pego o bug original.
 */
export interface LimiterClock {
  now(): number
  sleep(ms: number): Promise<void>
}

const realClock: LimiterClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

export class RateLimiter {
  private nextSlot = 0
  private readonly minInterval: number

  constructor(requestsPerMinute: number, private readonly clock: LimiterClock = realClock) {
    if (!(requestsPerMinute > 0)) {
      throw new Error(`RateLimiter: requestsPerMinute deve ser > 0, recebeu ${requestsPerMinute}`)
    }
    this.minInterval = 60_000 / requestsPerMinute
  }

  async acquire(): Promise<void> {
    // Reserva sincrona: nada entre ler `nextSlot` e grava-lo pode ceder o
    // event loop. E isso que separa esta versao da anterior.
    const now = this.clock.now()
    const slot = Math.max(now, this.nextSlot)
    this.nextSlot = slot + this.minInterval

    const wait = slot - now
    if (wait > 0) await this.clock.sleep(wait)
  }
}
