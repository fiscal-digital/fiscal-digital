export class RateLimiter {
  private lastCallAt = 0
  private readonly minInterval: number

  constructor(requestsPerMinute: number) {
    this.minInterval = 60_000 / requestsPerMinute
  }

  async acquire(): Promise<void> {
    const elapsed = Date.now() - this.lastCallAt
    if (elapsed < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - elapsed))
    }
    this.lastCallAt = Date.now()
  }
}
