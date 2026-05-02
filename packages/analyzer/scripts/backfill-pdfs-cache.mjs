#!/usr/bin/env node
/**
 * Backfill — popular cache S3 com PDFs já indexados em `gazettes-prod`.
 *
 * Itera todos os itens com pk começando em `GAZETTE#`, derivando a chave
 * S3 do path da URL QD via pdfCacheS3Key. Idempotente (HeadObject pula
 * objetos já cacheados). Respeita rate limit 60 req/min do QD.
 *
 * Uso:
 *   node packages/analyzer/scripts/backfill-pdfs-cache.mjs           # dry-run
 *   node packages/analyzer/scripts/backfill-pdfs-cache.mjs --apply   # executa
 *   node packages/analyzer/scripts/backfill-pdfs-cache.mjs --apply --limit 50  # smoke
 *
 * Logs:
 *  - Progresso a cada 100 itens
 *  - Erros vão para ./backfill-errors.jsonl (não stderr) — script segue.
 *  - Resumo final: total / cacheados / pulados / falhas.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'node:crypto'
import fs from 'node:fs'

const REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.GAZETTES_CACHE_BUCKET ?? 'fiscal-digital-gazettes-cache-prod'
const TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const RATE_PER_MIN = 60
const MIN_INTERVAL_MS = Math.ceil(60_000 / RATE_PER_MIN) // ~1000ms

const QD_HOSTS = ['data.queridodiario.ok.org.br', 'queridodiario.ok.org.br']

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const limitArg = args.find(a => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity
const cityArg = args.find(a => a.startsWith('--city='))
const CITY_FILTER = cityArg ? cityArg.split('=')[1] : null

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const s3 = new S3Client({ region: REGION })

function pdfCacheS3Key(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    if (!QD_HOSTS.includes(u.hostname)) return null
    const key = u.pathname.replace(/^\//, '')
    if (!key.toLowerCase().endsWith('.pdf')) return null
    return key
  } catch {
    return null
  }
}

async function s3Exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false
    throw err
  }
}

let lastFetchAt = 0
async function rateLimitedFetch(url) {
  const now = Date.now()
  const wait = lastFetchAt + MIN_INTERVAL_MS - now
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastFetchAt = Date.now()
  return fetch(url, {
    headers: { 'User-Agent': 'FiscalDigital-Backfill/1.0 (+https://fiscaldigital.org)' },
  })
}

async function uploadToS3(key, body, originalUrl, contentType) {
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/pdf',
    // inline garante que o browser exiba no iframe em vez de baixar
    ContentDisposition: 'inline',
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      originalUrl,
      sha256,
      mimeType: contentType,
      bytes: String(body.byteLength),
      fetchedAt: new Date().toISOString(),
    },
  }))
  return sha256
}

async function* scanGazettes() {
  let ek
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(pk, :p)',
      ExpressionAttributeValues: { ':p': 'GAZETTE#' },
      ExclusiveStartKey: ek,
      ProjectionExpression: 'pk, #u, #d',
      ExpressionAttributeNames: { '#u': 'url', '#d': 'date' },
    }))
    for (const item of out.Items ?? []) yield item
    ek = out.LastEvaluatedKey
  } while (ek)
}

async function main() {
  const stats = { total: 0, skipped: 0, cached: 0, failed: 0, invalid: 0 }
  const errLog = fs.createWriteStream('./backfill-errors.jsonl', { flags: 'a' })
  const t0 = Date.now()

  console.log('Backfill PDFs S3 cache')
  console.log(`  Bucket: ${BUCKET}`)
  console.log(`  Table:  ${TABLE}`)
  console.log(`  Mode:   ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`  Limit:  ${LIMIT === Infinity ? 'ilimitado' : LIMIT}`)
  console.log(`  Filter: ${CITY_FILTER ? 'city=' + CITY_FILTER : 'none'}`)
  console.log()

  for await (const item of scanGazettes()) {
    if (stats.total >= LIMIT) break
    stats.total++

    if (CITY_FILTER && !item.pk?.includes(`#${CITY_FILTER}#`)) continue

    const url = item.url
    const key = pdfCacheS3Key(url)
    if (!key) {
      stats.invalid++
      continue
    }

    try {
      if (await s3Exists(key)) {
        stats.skipped++
      } else if (!APPLY) {
        // dry-run: só conta o que faria
        stats.cached++
      } else {
        const res = await rateLimitedFetch(url)
        if (!res.ok) {
          stats.failed++
          errLog.write(JSON.stringify({ pk: item.pk, url, error: `HTTP ${res.status}`, at: new Date().toISOString() }) + '\n')
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        const ct = res.headers.get('content-type') ?? 'application/pdf'
        await uploadToS3(key, buf, url, ct)
        stats.cached++
      }
    } catch (err) {
      stats.failed++
      errLog.write(JSON.stringify({ pk: item.pk, url, error: String(err.message || err), at: new Date().toISOString() }) + '\n')
    }

    if (stats.total % 100 === 0) {
      const elapsed = (Date.now() - t0) / 1000
      const rate = stats.total / elapsed
      console.log(`  ... ${stats.total} | skipped=${stats.skipped} cached=${stats.cached} failed=${stats.failed} invalid=${stats.invalid} | ${rate.toFixed(1)} items/s`)
    }
  }

  errLog.end()
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log()
  console.log(`done in ${dt}s`)
  console.log(`  total:    ${stats.total}`)
  console.log(`  skipped:  ${stats.skipped} (já no S3)`)
  console.log(`  cached:   ${stats.cached} (${APPLY ? 'subidos' : 'seriam subidos'})`)
  console.log(`  failed:   ${stats.failed}`)
  console.log(`  invalid:  ${stats.invalid} (URL não-QD ou ausente)`)
  if (stats.failed > 0) console.log(`  erros em ./backfill-errors.jsonl`)
  if (!APPLY) console.log(`\nDRY-RUN. Re-execute com --apply para subir.`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
