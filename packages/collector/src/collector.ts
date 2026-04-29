import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { queryDiario, extractAll, lookupMemory, saveMemory } from '@fiscal-digital/engine'
import type { CollectorMessage } from '@fiscal-digital/engine'

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const QUEUE_URL = process.env.GAZETTES_QUEUE_URL!

// Keywords that signal fiscally relevant acts
const KEYWORDS = [
  'dispensa de licitação',
  'inexigibilidade',
  'contratação direta',
  'aditivo',
  'prorrogação',
  'nomeação',
  'exoneração',
  'licitação',
  'pregão',
  'tomada de preços',
]

export interface CollectorConfig {
  territory_id: string
  since?: string   // override; defaults to last processed date
}

export async function runCollector(config: CollectorConfig): Promise<{ processed: number; sent: number }> {
  const { territory_id } = config
  const since = config.since ?? await getLastDate(territory_id)
  const until = new Date().toISOString().split('T')[0]

  console.log(`[collector] ${territory_id} since=${since} until=${until}`)

  let offset = 0
  let processed = 0
  let sent = 0
  const pageSize = 50

  while (true) {
    const { data } = await queryDiario.execute({ territory_id, keywords: KEYWORDS, since, until, size: pageSize, offset })
    const { gazettes, total } = data

    if (gazettes.length === 0) break

    for (const gazette of gazettes) {
      processed++
      if (await isAlreadyQueued(gazette.id)) continue

      const text = gazette.excerpts.join('\n')
      const entities = extractAll(text)

      const msg: CollectorMessage = {
        gazetteId: gazette.id,
        territory_id: gazette.territory_id,
        date: gazette.date,
        url: gazette.url,
        excerpts: gazette.excerpts,
        entities,
      }

      await sqs.send(new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify(msg),
      }))

      await markQueued(gazette.id, gazette.url, gazette.date)
      sent++
    }

    offset += pageSize
    if (offset >= total) break
  }

  // Update last processed date
  await saveMemory.execute({
    pk: `BACKFILL#${territory_id}`,
    table: GAZETTES_TABLE,
    item: { lastDate: until, updatedAt: new Date().toISOString() },
  })

  return { processed, sent }
}

async function getLastDate(territory_id: string): Promise<string> {
  const { data } = await lookupMemory.execute({ pk: `BACKFILL#${territory_id}`, table: GAZETTES_TABLE })
  if (data?.['lastDate']) return data['lastDate'] as string

  // First run: go back 1 day
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

async function isAlreadyQueued(gazetteId: string): Promise<boolean> {
  const { data } = await lookupMemory.execute({ pk: `GAZETTE#${gazetteId}`, table: GAZETTES_TABLE })
  return data !== null
}

async function markQueued(gazetteId: string, url: string, date: string): Promise<void> {
  await saveMemory.execute({
    pk: `GAZETTE#${gazetteId}`,
    table: GAZETTES_TABLE,
    item: { url, date, status: 'queued', queuedAt: new Date().toISOString() },
  })
}
