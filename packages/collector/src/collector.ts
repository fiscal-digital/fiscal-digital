import crypto from 'node:crypto'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { queryDiario, extractAll, lookupMemory, saveMemory, pdfCacheS3Key, pdfCacheUrl, requireEnv, createLogger } from '@fiscal-digital/engine'
import type { CollectorMessage } from '@fiscal-digital/engine'

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const raw = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const ddb = DynamoDBDocumentClient.from(raw)

const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const GAZETTES_CACHE_BUCKET = 'fiscal-digital-gazettes-cache-prod'
const QUEUE_URL = requireEnv('GAZETTES_QUEUE_URL')

const logger = createLogger('collector')

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

  logger.info('coletando', { territory_id, since, until })

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

      // Cache PDF no S3 antes de enfileirar
      const cachedPdfUrl = await cachePdf(gazette.territory_id, gazette.id, gazette.url)

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

      await markQueued(gazette.id, gazette.url, gazette.date, cachedPdfUrl)
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

/**
 * Faz download do PDF da gazette e faz upload para S3.
 * Idempotente: se o objeto já existir no S3, retorna a URL sem re-upload.
 * Retorna a URL pública no CDN ou null em caso de falha não-crítica.
 *
 * Convenção: chave S3 espelha o path da URL QD (sem o host) para que
 * o site/API possam derivar a CDN URL diretamente da source URL sem
 * lookup no DDB. Ver `pdfCacheS3Key` em engine/utils/pdf_cache.
 */
async function cachePdf(
  _territoryId: string,
  _gazetteId: string,
  originalUrl: string,
): Promise<string | null> {
  const key = pdfCacheS3Key(originalUrl)
  const cdnUrl = pdfCacheUrl(originalUrl)
  if (!key || !cdnUrl) {
    logger.warn('url QD inválida — skip cache', { originalUrl })
    return null
  }

  // Checar se já existe (idempotência)
  const alreadyCached = await s3ObjectExists(key)
  if (alreadyCached) {
    return cdnUrl
  }

  // Baixar o PDF
  let pdfBuffer: ArrayBuffer
  try {
    const fetchedAt = new Date().toISOString()
    const response = await fetch(originalUrl, {
      headers: { 'User-Agent': 'FiscalDigital/1.0 (+https://fiscaldigital.org)' },
    })

    if (!response.ok) {
      logger.warn('pdf fetch falhou', { originalUrl, status: response.status })
      return null
    }

    const contentType = response.headers.get('content-type') ?? 'application/pdf'
    pdfBuffer = await response.arrayBuffer()
    const bytes = pdfBuffer.byteLength
    const sha256 = crypto.createHash('sha256').update(Buffer.from(pdfBuffer)).digest('hex')

    // Upload para S3
    await s3.send(new PutObjectCommand({
      Bucket: GAZETTES_CACHE_BUCKET,
      Key: key,
      Body: Buffer.from(pdfBuffer),
      ContentType: 'application/pdf',
      // inline garante que browser exibe no iframe em vez de baixar
      ContentDisposition: 'inline',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        originalUrl,
        sha256,
        mimeType: contentType,
        bytes: String(bytes),
        fetchedAt,
      },
    }))

    logger.info('pdf cached', { key, bytes })
    return cdnUrl
  } catch (err) {
    // Falha no cache de PDF não deve interromper o fluxo principal
    logger.warn('pdf cache error', { key, err })
    return null
  }
}

async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: GAZETTES_CACHE_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
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

async function markQueued(gazetteId: string, url: string, date: string, cachedPdfUrl: string | null): Promise<void> {
  // Usar UpdateItem para poder setar cachedPdfUrl opcionalmente sem sobrescrever campos existentes
  const baseItem: Record<string, unknown> = { url, date, status: 'queued', queuedAt: new Date().toISOString() }

  if (cachedPdfUrl != null) {
    // UpdateItem com cachedPdfUrl
    await ddb.send(new UpdateCommand({
      TableName: GAZETTES_TABLE,
      Key: { pk: `GAZETTE#${gazetteId}` },
      UpdateExpression: 'SET #url = :url, #date = :date, #status = :status, queuedAt = :queuedAt, cachedPdfUrl = :cachedPdfUrl',
      ExpressionAttributeNames: {
        '#url': 'url',
        '#date': 'date',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':url': url,
        ':date': date,
        ':status': 'queued',
        ':queuedAt': new Date().toISOString(),
        ':cachedPdfUrl': cachedPdfUrl,
      },
    }))
  } else {
    await saveMemory.execute({
      pk: `GAZETTE#${gazetteId}`,
      table: GAZETTES_TABLE,
      item: baseItem,
    })
  }
}
