import type { EventBridgeEvent } from 'aws-lambda'
import { activeCities } from '@fiscal-digital/engine'
import { runCollector } from './collector'

interface BackfillPayload {
  territory_id?: string
  since?: string
  backfill?: boolean
}

const CIDADES = activeCities().map(c => ({ territory_id: c.cityId, name: c.name }))

export const handler = async (
  event: EventBridgeEvent<'Scheduled Event', BackfillPayload>,
): Promise<void> => {
  const detail = event.detail ?? {}

  // Manual backfill: single city with explicit since date
  if (detail.backfill && detail.territory_id) {
    console.log(`[collector] backfill ${detail.territory_id} since=${detail.since}`)
    const result = await runCollector({ territory_id: detail.territory_id, since: detail.since })
    console.log(`[collector] done processed=${result.processed} sent=${result.sent}`)
    return
  }

  // Daily run: all cities in parallel
  const results = await Promise.allSettled(
    CIDADES.map(c => runCollector({ territory_id: c.territory_id }).then(r => ({ ...r, name: c.name }))),
  )

  for (const r of results) {
    if (r.status === 'fulfilled') {
      console.log(`[collector] ${r.value.name} processed=${r.value.processed} sent=${r.value.sent}`)
    } else {
      console.error('[collector] error', r.reason)
    }
  }
}
