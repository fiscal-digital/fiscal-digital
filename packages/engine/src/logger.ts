import { Logger } from '@aws-lambda-powertools/logger'

export function createLogger(serviceName: string): Logger {
  return new Logger({ serviceName })
}
