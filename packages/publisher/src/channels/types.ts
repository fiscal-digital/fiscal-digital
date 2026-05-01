import type { Finding } from '@fiscal-digital/engine'

export type ChannelName = 'x' | 'reddit' | 'site'

export interface PublishResult {
  channel: ChannelName
  externalId: string
  url: string
  publishedAt: string
}

export interface PublishChannel {
  readonly name: ChannelName
  enabled(finding: Finding): boolean
  publish(finding: Finding): Promise<PublishResult>
}

export class RateLimitError extends Error {
  constructor(
    public readonly channel: ChannelName,
    public readonly retryAfterSeconds: number,
    message?: string,
  ) {
    super(message ?? `${channel} rate limit hit — retry after ${retryAfterSeconds}s`)
    this.name = 'RateLimitError'
  }
}

export class AlreadyPublishedError extends Error {
  constructor(public readonly channel: ChannelName, public readonly findingId: string) {
    super(`finding ${findingId} already published on ${channel} — skipping`)
    this.name = 'AlreadyPublishedError'
  }
}

export class ChannelDryRunError extends Error {
  constructor(public readonly channel: ChannelName, public readonly preview: string) {
    super(`${channel} dry-run — would publish: ${preview.slice(0, 80)}…`)
    this.name = 'ChannelDryRunError'
  }
}
