#!/usr/bin/env node
/**
 * reanalyze.mjs — UH-22 Phase 4
 *
 * Re-roda Fiscais sobre gazettes históricas SEM re-extração Bedrock e SEM
 * re-executar Fiscais já processados.
 *
 * Cenários de uso:
 *   1. Bug fix em Fiscal existente → re-rodar só ele sobre histórico
 *   2. Adicionar Fiscal novo (FiscalConvenios, FiscalNepotismo, etc.) →
 *      rodar SÓ o novo sobre 46k gazettes
 *   3. Calibração de threshold → re-rodar Fiscal específico
 *
 * Estratégia:
 *   1. Scan gazettes-prod (paginado)
 *   2. Filtrar por: cidade (opcional), data range (opcional)
 *   3. Para cada gazette onde processedBy[fiscalId] não existe:
 *      → buscar excerpts no QD
 *      → enviar SQS message com enabledFiscals=[fiscalId]
 *      → analyzer respeita o filter, roda só esse Fiscal (cache hit em entities)
 *   4. Idempotente: re-runs pulam gazettes já marcadas em processedBy
 *
 * Custo:
 *   - Bedrock: $0 (cache de UH-22 Phase 1 cobre 100% das extrações)
 *   - Lambda execution: ~$0.05 / 1k gazettes (sem extração, só Fiscais)
 *   - QD queries: rate limited 60 req/min
 *
 * Uso:
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscal=fiscal-licitacoes
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscal=fiscal-contratos --poc
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscal=fiscal-convenios --city=4305108
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscal=fiscal-licitacoes --since=2026-01-01
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscal=fiscal-licitacoes --force  # re-roda mesmo se já processedBy
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs'

const REGION = 'us-east-1'
const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const GAZETTES_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/664905858073/fiscal-digital-gazettes-queue-prod'
const QD_API = 'https://api.queridodiario.ok.org.br'
const QD_RATE_DELAY_MS = 1100
const SQS_BATCH_SIZE = 10

const VALID_FISCALS = ['fiscal-licitacoes', 'fiscal-contratos', 'fiscal-fornecedores', 'fiscal-pessoal']

const POC_CITIES = ['4305108', '4314902'] // Caxias do Sul + Porto Alegre

const KEYWORDS = [
  'dispensa de licitação', 'inexigibilidade', 'contratação direta',
  'aditivo', 'prorrogação', 'nomeação', 'exoneração',
  'licitação', 'pregão', 'tomada de preços',
]

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const sqs = new SQSClient({ region: REGION })

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Scan gazettes-prod paginado ─────────────────────────────────────────────

async function* scanGazettes(filters) {
  let ExclusiveStartKey
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: GAZETTES_TABLE,
      FilterExpression: 'begins_with(pk, :p)',
      ExpressionAttributeValues: { ':p': 'GAZETTE#' },
      ExclusiveStartKey,
    }))
    for (const item of r.Items ?? []) {
      const pk = item.pk ?? ''
      const parts = pk.split('#')
      // GAZETTE#{territory_id}#{date}#{edition}
      const territoryId = parts[1]
      const date = parts[2]
      const edition = parts[3] ?? '1'

      // Aplicar filtros
      if (filters.cities && !filters.cities.includes(territoryId)) continue
      if (filters.since && date < filters.since) continue
      if (filters.until && date > filters.until) continue

      // Skip se Fiscal já processou (a menos que --force)
      const processedBy = item.processedBy ?? {}
      if (!filters.force && processedBy[filters.fiscal]) continue

      yield {
        gazetteId: `${territoryId}#${date}#${edition}`,
        territoryId,
        date,
        edition,
        url: item.url,
      }
    }
    ExclusiveStartKey = r.LastEvaluatedKey
  } while (ExclusiveStartKey)
}

// ── Buscar excerpts no QD (para gazette específica) ──────────────────────────

const qdCache = new Map()

async function fetchExcerpts(territoryId, date) {
  const cacheKey = `${territoryId}#${date}`
  if (qdCache.has(cacheKey)) return qdCache.get(cacheKey)

  const params = new URLSearchParams({
    territory_ids: territoryId,
    size: '50',
    excerpt_size: '300',
    number_of_excerpts: '5',
    querystring: KEYWORDS.join(' OR '),
    published_since: date,
    published_until: date,
  })
  const r = await fetch(`${QD_API}/gazettes?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'fiscal-digital-reanalyze/0.1' },
  })
  await sleep(QD_RATE_DELAY_MS)
  if (!r.ok) {
    qdCache.set(cacheKey, [])
    return []
  }
  const body = await r.json()
  qdCache.set(cacheKey, body.gazettes ?? [])
  return body.gazettes ?? []
}

// ── Enviar batch ao SQS ─────────────────────────────────────────────────────

async function sendBatch(messages) {
  if (messages.length === 0) return
  await sqs.send(new SendMessageBatchCommand({
    QueueUrl: GAZETTES_QUEUE_URL,
    Entries: messages.map((m, i) => ({
      Id: `msg-${i}`,
      MessageBody: JSON.stringify(m),
    })),
  }))
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const fiscal = args.find(a => a.startsWith('--fiscal='))?.replace('--fiscal=', '')
  const cityArg = args.find(a => a.startsWith('--city='))?.replace('--city=', '')
  const since = args.find(a => a.startsWith('--since='))?.replace('--since=', '')
  const until = args.find(a => a.startsWith('--until='))?.replace('--until=', '')
  const poc = args.includes('--poc')
  const force = args.includes('--force')
  const dryRun = args.includes('--dry-run')

  if (!fiscal) {
    console.error('Uso: --fiscal=<id>  (validos: ' + VALID_FISCALS.join(', ') + ')')
    process.exit(1)
  }

  // Permitir Fiscais novos (não na lista) — apenas warning
  if (!VALID_FISCALS.includes(fiscal)) {
    console.warn(`[warn] Fiscal "${fiscal}" não está na lista padrão. Continuando assim mesmo (Fiscal novo?).`)
  }

  const cities = cityArg ? [cityArg] : poc ? POC_CITIES : null

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  Fiscal Digital — UH-22 Phase 4: Re-Analyze`)
  console.log(`  Fiscal alvo: ${fiscal}`)
  console.log(`  Cidades: ${cities ? cities.join(', ') : 'todas'}`)
  console.log(`  Range: ${since ?? 'inicio'} → ${until ?? 'hoje'}`)
  console.log(`  Force: ${force} · DryRun: ${dryRun}`)
  console.log(`${'='.repeat(72)}\n`)

  const filters = { fiscal, cities, since, until, force }
  let totalCandidates = 0
  let totalEnqueued = 0
  let batch = []

  for await (const g of scanGazettes(filters)) {
    totalCandidates++

    if (dryRun) continue

    // Buscar excerpts do QD para essa gazette
    const qdGazettes = await fetchExcerpts(g.territoryId, g.date)
    const qdMatch = qdGazettes.find(qd => qd.url === g.url) ?? qdGazettes[0]
    if (!qdMatch) continue

    const msg = {
      gazetteId: g.gazetteId,
      territory_id: g.territoryId,
      date: g.date,
      url: g.url,
      excerpts: qdMatch.excerpts ?? [],
      entities: { cnpjs: [], values: [], dates: [], contractNumbers: [] },
      enabledFiscals: [fiscal], // ← chave do UH-22 Phase 2
    }

    batch.push(msg)
    if (batch.length >= SQS_BATCH_SIZE) {
      await sendBatch(batch)
      totalEnqueued += batch.length
      batch = []
      if (totalEnqueued % 100 === 0) {
        console.log(`  ... ${totalEnqueued} enfileiradas`)
      }
    }
  }
  if (batch.length > 0) {
    await sendBatch(batch)
    totalEnqueued += batch.length
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  CONCLUÍDO`)
  console.log(`  Candidatos (gazettes sem ${fiscal}): ${totalCandidates}`)
  console.log(`  Enfileirados: ${totalEnqueued}`)
  console.log(`  Analyzer processará via SQS event source mapping`)
  console.log(`  Cache de extração (UH-22 Phase 1) elimina custo Bedrock`)
  console.log(`${'='.repeat(72)}\n`)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
