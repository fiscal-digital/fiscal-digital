import { createLogger } from '@fiscal-digital/engine'

const logger = createLogger('publisher')
import type { PublishChannel } from './types'
import { XChannel } from './x'
import { RedditChannel } from './reddit'

/**
 * Carrega canais de publicação habilitados via env vars.
 *
 * Convenção: `<CHANNEL>_ENABLED=true` ativa o canal. Default: desabilitado.
 * Cada canal lê seu próprio dry-run flag (`X_DRY_RUN`, `REDDIT_DRY_RUN`).
 *
 * Para adicionar um novo canal:
 *   1. Implementar `PublishChannel` em `channels/<nome>/index.ts`
 *   2. Adicionar entry abaixo lendo `<NOME>_ENABLED`
 *   3. Atualizar IAM do publisher se precisar de novo secret
 */
export function loadEnabledChannels(): PublishChannel[] {
  const channels: PublishChannel[] = []

  if (process.env.X_ENABLED === 'true') channels.push(new XChannel())
  if (process.env.REDDIT_ENABLED === 'true') channels.push(new RedditChannel())

  if (channels.length === 0) {
    logger.warn(
      '[registry] nenhum canal habilitado — publisher vai consumir SQS sem publicar (defina X_ENABLED/REDDIT_ENABLED=true)',
    )
  }

  return channels
}
