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
 *   node packages/analyzer/scripts/reanalyze.mjs --all                      # todos os 4
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscals=A,B,C            # vários
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscal=X --poc           # Caxias + PA
 *   node packages/analyzer/scripts/reanalyze.mjs --all --city=4305108       # 1 cidade
 *   node packages/analyzer/scripts/reanalyze.mjs --all --since=2025-12-01
 *   node packages/analyzer/scripts/reanalyze.mjs --fiscal=X --force         # re-roda mesmo já processedBy
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs'

const REGION = 'us-east-1'
const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const GAZETTES_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/664905858073/fiscal-digital-gazettes-queue-prod'
const QD_API = 'https://api.queridodiario.ok.org.br'
const QD_RATE_DELAY_MS = 1100
const SQS_BATCH_SIZE = 10

const VALID_FISCALS = [
  'fiscal-licitacoes',
  'fiscal-contratos',
  'fiscal-fornecedores',
  'fiscal-pessoal',
  'fiscal-convenios',
  'fiscal-nepotismo',
  'fiscal-publicidade',
  'fiscal-locacao',
  'fiscal-diarias',
]

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

      // UH-22 Phase 2: calcular Fiscais MISSING (não em processedBy)
      const processedBy = item.processedBy ?? {}
      const missingFiscals = filters.force
        ? filters.fiscals
        : filters.fiscals.filter(f => !processedBy[f])

      if (missingFiscals.length === 0) continue

      yield {
        gazetteId: `${territoryId}#${date}#${edition}`,
        territoryId,
        date,
        edition,
        url: item.url,
        // EVO-001: excerpts já gravados em gazettes-prod (collector pós 2026-05-09).
        // Se presente, evita round-trip ao QD ($10 → $0.05 por rodada).
        excerpts: item.excerpts,
        missingFiscals, // ← envia apenas os faltantes para o analyzer
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

// ── EVO-001: Lazy fill — write-through de excerpts no DDB ────────────────────
//
// Pattern:
//   1. scanGazettes retorna `excerpts` se já presente no item DDB (collector
//      pós 2026-05-09 grava). Hit = $0.
//   2. Se ausente, busca QD via fetchExcerpts() (paga rate-limit + Bedrock 0).
//   3. Após buscar QD, grava de volta no item DDB para acelerar próxima rodada.
//
// Auto-amortizando: 1ª passada custa $10, 2ª custa $0.05.

async function backfillExcerptsInDdb(territoryId, date, edition, excerpts) {
  if (!excerpts || excerpts.length === 0) return
  const pk = `GAZETTE#${territoryId}#${date}#${edition}`
  try {
    await ddb.send(new UpdateCommand({
      TableName: GAZETTES_TABLE,
      Key: { pk },
      // SET apenas se ainda não existe — race-safe entre execuções paralelas
      UpdateExpression: 'SET #e = if_not_exists(#e, :ex)',
      ExpressionAttributeNames: { '#e': 'excerpts' },
      ExpressionAttributeValues: { ':ex': excerpts },
    }))
  } catch (err) {
    // Não-crítico: se falhar, próxima rodada paga QD novamente. Não bloqueia.
    console.warn(`  [warn] backfill excerpts falhou para ${pk}:`, err.message)
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const fiscal = args.find(a => a.startsWith('--fiscal='))?.replace('--fiscal=', '')
  const fiscalsArg = args.find(a => a.startsWith('--fiscals='))?.replace('--fiscals=', '')
  const all = args.includes('--all')
  const cityArg = args.find(a => a.startsWith('--city='))?.replace('--city=', '')
  const since = args.find(a => a.startsWith('--since='))?.replace('--since=', '')
  const until = args.find(a => a.startsWith('--until='))?.replace('--until=', '')
  const poc = args.includes('--poc')
  const force = args.includes('--force')
  const dryRun = args.includes('--dry-run')

  // Resolve fiscais alvo
  let fiscals
  if (all) fiscals = VALID_FISCALS
  else if (fiscalsArg) fiscals = fiscalsArg.split(',').map(s => s.trim()).filter(Boolean)
  else if (fiscal) fiscals = [fiscal]
  else {
    console.error('Uso: --fiscal=<id> | --fiscals=A,B,C | --all')
    console.error('Validos: ' + VALID_FISCALS.join(', '))
    process.exit(1)
  }

  // Warn sobre Fiscais não-padrão (Fiscais novos)
  for (const f of fiscals) {
    if (!VALID_FISCALS.includes(f)) {
      console.warn(`[warn] Fiscal "${f}" não está na lista padrão. Continuando (Fiscal novo?).`)
    }
  }

  const cities = cityArg ? [cityArg] : poc ? POC_CITIES : null

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  Fiscal Digital — UH-22 Phase 4: Re-Analyze`)
  console.log(`  Fiscais alvo: ${fiscals.join(', ')}`)
  console.log(`  Cidades: ${cities ? cities.join(', ') : 'todas'}`)
  console.log(`  Range: ${since ?? 'inicio'} → ${until ?? 'hoje'}`)
  console.log(`  Force: ${force} · DryRun: ${dryRun}`)
  console.log(`${'='.repeat(72)}\n`)

  // EVO-001: warning de execução ampla (nem cidade nem range filter + sem dry-run)
  // Re-disparar análise massiva (50k gazettes × N fiscais) custa ~$50 + acorda
  // alarmes em prod. Forçar consciência se for esse o caso.
  if (!dryRun && !cities && !since && !until) {
    console.warn(`\n⚠️  AVISO: rodando sem --city, --since ou --until E sem --dry-run.`)
    console.warn(`   Isso vai re-disparar análise sobre TODAS as gazettes históricas.`)
    console.warn(`   Custo estimado: ~$50 + ~14h de execução SQS.`)
    console.warn(`   Se é intencional, continue. Se não, Ctrl+C agora e adicione --dry-run.\n`)
    // Pequena pausa visual para Ctrl+C consciente
    await sleep(3000)
  }

  const filters = { fiscals, cities, since, until, force }
  let totalCandidates = 0
  let totalEnqueued = 0
  let cacheHits = 0      // EVO-001: gazettes com excerpts já no DDB
  let cacheMisses = 0    // EVO-001: gazettes que precisaram QD
  let writeThroughs = 0  // EVO-001: gazettes onde gravamos excerpts de volta no DDB
  let batch = []

  for await (const g of scanGazettes(filters)) {
    totalCandidates++

    if (dryRun) continue

    // EVO-001: lazy fill — usa excerpts do DDB se presente, senão busca QD
    let excerpts = g.excerpts
    if (excerpts && excerpts.length > 0) {
      cacheHits++
    } else {
      cacheMisses++
      const qdGazettes = await fetchExcerpts(g.territoryId, g.date)
      const qdMatch = qdGazettes.find(qd => qd.url === g.url) ?? qdGazettes[0]
      if (!qdMatch) continue
      excerpts = qdMatch.excerpts ?? []
      // Write-through: grava no DDB para acelerar próxima rodada (auto-amortiza)
      if (excerpts.length > 0) {
        await backfillExcerptsInDdb(g.territoryId, g.date, g.edition, excerpts)
        writeThroughs++
      }
    }

    if (excerpts.length === 0) continue

    const msg = {
      gazetteId: g.gazetteId,
      territory_id: g.territoryId,
      date: g.date,
      url: g.url,
      excerpts,
      entities: { cnpjs: [], values: [], dates: [], contractNumbers: [] },
      // UH-22 Phase 2: envia apenas Fiscais que NÃO rodaram nesta gazette
      // (state tracking elimina trabalho duplicado)
      enabledFiscals: g.missingFiscals,
    }

    batch.push(msg)
    if (batch.length >= SQS_BATCH_SIZE) {
      await sendBatch(batch)
      totalEnqueued += batch.length
      batch = []
      if (totalEnqueued % 100 === 0) {
        console.log(`  ... ${totalEnqueued} enfileiradas (cache hits: ${cacheHits}, misses: ${cacheMisses})`)
      }
    }
  }
  if (batch.length > 0) {
    await sendBatch(batch)
    totalEnqueued += batch.length
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  CONCLUÍDO`)
  console.log(`  Candidatos (gazettes sem ${fiscals.join('+')}): ${totalCandidates}`)
  console.log(`  Enfileirados: ${totalEnqueued}`)
  if (!dryRun) {
    console.log(`  EVO-001 cache hits (excerpts no DDB):  ${cacheHits}`)
    console.log(`  EVO-001 cache misses (buscou QD):       ${cacheMisses}`)
    console.log(`  EVO-001 write-throughs (gravou no DDB): ${writeThroughs}`)
    if (cacheMisses > 0) {
      const savedRatio = (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(1)
      console.log(`  Cache hit ratio: ${savedRatio}% — próxima rodada será mais barata`)
    }
  }
  console.log(`  Analyzer processará via SQS event source mapping`)
  console.log(`  Cache de extração (UH-22 Phase 1) elimina custo Bedrock`)
  console.log(`${'='.repeat(72)}\n`)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
