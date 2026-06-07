#!/usr/bin/env node
/**
 * replay-fiscal.mjs — Runner local genérico de qualquer Fiscal sobre histórico.
 *
 * Lê gazettes diretamente de DDB `gazettes-prod` (campo `excerpts` já cacheado),
 * roda o Fiscal escolhido localmente (mesmo código TS do engine que o Lambda
 * analyzer usa), e opcionalmente grava findings em `alerts-prod` usando o MESMO
 * pk e schema que `packages/analyzer/src/index.ts:persistFinding`.
 *
 * Por que existe (vs `packages/analyzer/scripts/reanalyze.mjs`):
 *   - reanalyze.mjs força chamada QD para popular excerpts quando ausentes,
 *     paga rate-limit 60/min IP-based.
 *   - replay-fiscal.mjs assume excerpts já cacheados em DDB (90.4% de cobertura
 *     em 2026-05-24). Roda local em minutos, ZERO QD, ZERO SQS, ZERO Bedrock
 *     para extração (cache L4 entities-prod hit). Bedrock Haiku chamado apenas
 *     para narrative de findings com riskScore >= threshold de publicação.
 *
 * Equivalência com analyzer Lambda:
 *   - mesma versao do engine (import @fiscal-digital/engine)
 *   - mesmo createCachedExtractEntities (cache L4 entities-prod)
 *   - mesmo queryAlertsByCnpj (GSI2-cnpj-date em alerts-prod)
 *   - mesmo persistFinding (pk derivado de gazetteKey, schema idêntico)
 *
 * Uso:
 *   node scripts/replay-fiscal.mjs --fiscal=fiscal-licitacoes --city=4305108
 *   node scripts/replay-fiscal.mjs --fiscal=fiscal-contratos --city=4305108 --apply
 *   node scripts/replay-fiscal.mjs --fiscal=fiscal-pessoal --all-cities
 *   node scripts/replay-fiscal.mjs --fiscal=fiscal-licitacoes --city=4305108 --max-gazettes=10
 *   node scripts/replay-fiscal.mjs --fiscal=fiscal-contratos --since=2024-01-01 --city=4305108
 *
 * Modo DRY-RUN (default):
 *   - Roda Fiscal sobre cada gazette
 *   - NÃO chama generateNarrative (Bedrock Haiku) — substitui por placeholder
 *   - NÃO grava em DDB
 *   - Imprime resumo: gazettes processadas, findings por type
 *
 * Modo APPLY (--apply):
 *   - generateNarrative chamado (Bedrock cost ~$0.77/1k findings publicáveis)
 *   - PutItem em alerts-prod via mesmo pk determinístico
 *   - NÃO toca campo processedBy de gazettes-prod
 */

// Handlers globais: evitam crash silencioso do node por unhandled rejection
// ou exception. Log + continua. Critico para runs longos (3k+ gazettes) onde
// uma falha pontual de Bedrock/DDB nao deve matar o processo inteiro.
process.on('unhandledRejection', (err) => {
  console.error(`[unhandledRejection] ${err?.message?.slice(0, 300) ?? err}`)
})
process.on('uncaughtException', (err) => {
  console.error(`[uncaughtException] ${err?.message?.slice(0, 300) ?? err}`)
})

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import {
  fiscalLicitacoes,
  fiscalContratos,
  fiscalFornecedores,
  fiscalPessoal,
  fiscalConvenios,
  fiscalNepotismo,
  fiscalPublicidade,
  fiscalLocacao,
  fiscalDiarias,
  createCachedExtractEntities,
  saveMemory,
  generateNarrative,
  querySuppliersContract,
  gazetteKey,
} from '@fiscal-digital/engine'

// ─── Config ───────────────────────────────────────────────────────────────────

const REGION = 'us-east-1'
const ALERTS_TABLE = 'fiscal-digital-alerts-prod'
const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

// Map de fiscalId -> instancia. fiscal-geral é orquestrador (consolidar), não
// segue padrão analisar()/runner local não suporta.
const FISCAIS = {
  'fiscal-licitacoes': fiscalLicitacoes,
  'fiscal-contratos': fiscalContratos,
  'fiscal-fornecedores': fiscalFornecedores,
  'fiscal-pessoal': fiscalPessoal,
  'fiscal-convenios': fiscalConvenios,
  'fiscal-nepotismo': fiscalNepotismo,
  'fiscal-publicidade': fiscalPublicidade,
  'fiscal-locacao': fiscalLocacao,
  'fiscal-diarias': fiscalDiarias,
}

// ─── queryAlertsByCnpj — réplica do analyzer Lambda ───────────────────────────

async function queryAlertsByCnpj(cnpj, sinceISO) {
  const res = await ddb.send(new QueryCommand({
    TableName: ALERTS_TABLE,
    IndexName: 'GSI2-cnpj-date',
    KeyConditionExpression: '#cnpj = :cnpj AND #createdAt >= :since',
    ExpressionAttributeNames: { '#cnpj': 'cnpj', '#createdAt': 'createdAt' },
    ExpressionAttributeValues: { ':cnpj': cnpj, ':since': sinceISO },
  }))
  return res.Items ?? []
}

// ─── persistFinding — réplica do analyzer Lambda ──────────────────────────────

async function persistFinding(finding) {
  const createdAt = finding.createdAt ?? new Date().toISOString()
  const sourceUrl = finding.evidence?.[0]?.source
  const stableKey = sourceUrl ? gazetteKey(sourceUrl) : null
  const pk = `FINDING#${finding.fiscalId}#${finding.cityId}#${finding.type}#${stableKey ?? createdAt}`
  finding.id = pk
  finding.createdAt = createdAt
  await saveMemory.execute({
    pk,
    table: ALERTS_TABLE,
    item: { ...finding, pk },
  })
  return pk
}

// ─── buildContext — réplica do analyzer Lambda ────────────────────────────────

function buildContext(gazetteId, opts = {}) {
  const cachedExtractor = createCachedExtractEntities({ gazetteId })

  return {
    alertsTable: ALERTS_TABLE,
    extractEntities: cachedExtractor,
    generateNarrative: opts.skipNarrative
      ? async () => '[narrativa Haiku omitida em dry-run]'
      : async (finding) => {
          const result = await generateNarrative.execute({ finding })
          return result.data
        },
    saveMemory,
    queryAlertsByCnpj,
    querySuppliersContract: (input) => querySuppliersContract.execute(input),
  }
}

// ─── Scan gazettes por cidade (com excerpts populated) ────────────────────────

async function* scanGazettesByCity(cityId, filters = {}) {
  // pk = GAZETTE#{cityId}#{date}#{hash}
  let ExclusiveStartKey
  const pkPrefix = `GAZETTE#${cityId}#`
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: GAZETTES_TABLE,
      FilterExpression: 'begins_with(pk, :p) AND attribute_exists(excerpts)',
      ExpressionAttributeValues: { ':p': pkPrefix },
      ExclusiveStartKey,
    }))
    for (const item of r.Items ?? []) {
      const pkParts = (item.pk ?? '').split('#')
      const territoryId = pkParts[1]
      const date = item.date ?? pkParts[2]
      const hash = pkParts[3] ?? '1'

      if (filters.since && date < filters.since) continue
      if (filters.until && date > filters.until) continue
      if (!item.excerpts || item.excerpts.length === 0) continue

      yield {
        gazetteId: `${territoryId}#${date}#${hash}`,
        territory_id: territoryId,
        date,
        url: item.url,
        excerpts: item.excerpts,
      }
    }
    ExclusiveStartKey = r.LastEvaluatedKey
  } while (ExclusiveStartKey)
}

// ─── List cities with findings for given fiscalId ─────────────────────────────

async function listCitiesWithFindings(fiscalId) {
  const cities = new Set()
  let ExclusiveStartKey
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: ALERTS_TABLE,
      FilterExpression: 'fiscalId = :f AND begins_with(pk, :p)',
      ExpressionAttributeValues: { ':f': fiscalId, ':p': 'FINDING#' },
      ProjectionExpression: 'cityId',
      ExclusiveStartKey,
    }))
    for (const item of r.Items ?? []) {
      if (item.cityId) cities.add(item.cityId)
    }
    ExclusiveStartKey = r.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return [...cities]
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const BEDROCK_THROTTLE_MS = 1300 // respeita ~46 RPM (Bedrock Nova Lite ~50 RPM)

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function processCity(fiscal, cityId, filters, opts) {
  let gazettesProcessed = 0
  let findingsGenerated = 0
  let errorsCount = 0
  const byType = {}
  const sample = []

  for await (const gazette of scanGazettesByCity(cityId, filters)) {
    if (opts.maxGazettes && gazettesProcessed >= opts.maxGazettes) break
    gazettesProcessed++

    const gazetteCtx = buildContext(gazette.gazetteId, { skipNarrative: opts.dryRun })

    let findings = []
    try {
      findings = await fiscal.analisar({
        gazette,
        cityId,
        context: gazetteCtx,
      })
    } catch (err) {
      errorsCount++
      console.error(`[err] ${cityId} ${gazette.date} ${gazette.gazetteId}: ${err.message?.slice(0, 200) ?? err}`)
      // Continua para a proxima gazette mesmo com erro
      await sleep(BEDROCK_THROTTLE_MS)
      continue
    }

    for (const f of findings) {
      findingsGenerated++
      byType[f.type] = (byType[f.type] ?? 0) + 1
      if (sample.length < 3) {
        sample.push({
          type: f.type,
          cnpj: f.cnpj,
          value: f.value,
          riskScore: f.riskScore,
          evidenceCount: f.evidence?.length ?? 0,
          gazetteDate: f.evidence?.[0]?.date,
        })
      }

      if (opts.apply) {
        try {
          await persistFinding(f)
        } catch (err) {
          errorsCount++
          console.error(`[persist-err] ${cityId} ${gazette.date} ${f.type}: ${err.message?.slice(0, 200) ?? err}`)
        }
      }
    }

    // Throttle Bedrock: cada `analisar` pode disparar varios `extractEntities`.
    // Sem throttle, batemos 50 RPM e Bedrock retorna ThrottlingException.
    // O retry interno do engine cobre alguns, mas em volume alto o backoff
    // exponencial se acumula e mata throughput. Pace conservador.
    await sleep(BEDROCK_THROTTLE_MS)

    if (gazettesProcessed % 50 === 0) {
      console.log(`  ${cityId}: ${gazettesProcessed} gazettes, ${findingsGenerated} findings, ${errorsCount} errors`)
    }
  }

  return { cityId, gazettesProcessed, findingsGenerated, errorsCount, byType, sample }
}

async function main() {
  const args = process.argv.slice(2)
  const fiscalArg = args.find(a => a.startsWith('--fiscal='))?.replace('--fiscal=', '')
  const cityArg = args.find(a => a.startsWith('--city='))?.replace('--city=', '')
  const allCities = args.includes('--all-cities')
  const since = args.find(a => a.startsWith('--since='))?.replace('--since=', '')
  const until = args.find(a => a.startsWith('--until='))?.replace('--until=', '')
  const apply = args.includes('--apply')
  const dryRun = !apply
  const maxGazettesArg = args.find(a => a.startsWith('--max-gazettes='))?.replace('--max-gazettes=', '')
  const maxGazettes = maxGazettesArg ? parseInt(maxGazettesArg, 10) : null

  if (!fiscalArg) {
    console.error(`Uso: --fiscal=<id> --city=<id> | --all-cities`)
    console.error(`Fiscais validos: ${Object.keys(FISCAIS).join(', ')}`)
    process.exit(1)
  }

  const fiscal = FISCAIS[fiscalArg]
  if (!fiscal) {
    console.error(`Fiscal invalido: ${fiscalArg}`)
    console.error(`Validos: ${Object.keys(FISCAIS).join(', ')}`)
    process.exit(1)
  }

  if (!cityArg && !allCities) {
    console.error('Uso: --city=<id> | --all-cities')
    process.exit(1)
  }

  let cities
  if (cityArg) {
    cities = [cityArg]
  } else {
    console.log(`Mapeando cidades com ${fiscalArg} em alerts-prod...`)
    cities = await listCitiesWithFindings(fiscalArg)
    console.log(`Cidades a processar: ${cities.length}`)
    console.log(cities.sort().join(', '))
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  replay-fiscal`)
  console.log(`  Fiscal: ${fiscalArg}`)
  console.log(`  Modo: ${dryRun ? 'DRY-RUN (sem write em DDB)' : 'APPLY (grava em DDB)'}`)
  console.log(`  Cidades: ${cities.join(', ')}`)
  console.log(`  Range: ${since ?? 'inicio'} → ${until ?? 'hoje'}`)
  console.log(`  Max gazettes/cidade: ${maxGazettes ?? 'sem limite'}`)
  console.log(`${'='.repeat(72)}\n`)

  if (apply) {
    console.warn(`\n⚠️  APPLY ativo — vai gravar em alerts-prod.`)
    console.warn(`   Bedrock Haiku para narrative de findings publicaveis (~$0.77/1k).`)
    console.warn(`   Ctrl+C nos proximos 3s para abortar.\n`)
    await new Promise(r => setTimeout(r, 3000))
  }

  const results = []
  for (const cityId of cities) {
    console.log(`\n→ ${cityId}`)
    const r = await processCity(fiscal, cityId, { since, until }, { dryRun, apply, maxGazettes })
    results.push(r)
    console.log(`  Concluido: ${r.gazettesProcessed} gazettes, ${r.findingsGenerated} findings`)
    const typeList = Object.entries(r.byType).map(([k, v]) => `${k}=${v}`).join(', ')
    console.log(`  Por type: ${typeList || '(nenhum)'}`)
    if (r.sample.length > 0) {
      console.log(`  Amostra:`)
      for (const s of r.sample) console.log(`    - ${s.type} | ${s.cnpj ?? '?'} | R$ ${s.value} | risk ${s.riskScore} | evidence ${s.evidenceCount}`)
    }
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  RESUMO — ${fiscalArg}`)
  console.log(`${'='.repeat(72)}`)
  const allTypes = new Set()
  results.forEach(r => Object.keys(r.byType).forEach(t => allTypes.add(t)))
  const typeCols = [...allTypes].sort()

  const header = `  Cidade            Gazettes    Findings   ` + typeCols.map(t => t.padStart(12)).join('  ')
  console.log(header)
  let totalGazettes = 0
  let totalFindings = 0
  const totalByType = {}
  for (const r of results) {
    totalGazettes += r.gazettesProcessed
    totalFindings += r.findingsGenerated
    for (const t of typeCols) totalByType[t] = (totalByType[t] ?? 0) + (r.byType[t] ?? 0)
    const tCells = typeCols.map(t => String(r.byType[t] ?? 0).padStart(12)).join('  ')
    console.log(`  ${r.cityId.padEnd(16)}  ${String(r.gazettesProcessed).padStart(8)}    ${String(r.findingsGenerated).padStart(8)}   ${tCells}`)
  }
  const tCellsTotal = typeCols.map(t => String(totalByType[t] ?? 0).padStart(12)).join('  ')
  console.log(`  ${'TOTAL'.padEnd(16)}  ${String(totalGazettes).padStart(8)}    ${String(totalFindings).padStart(8)}   ${tCellsTotal}`)
  console.log(`\nModo: ${dryRun ? 'DRY-RUN (nada foi gravado)' : 'APPLY (gravado em alerts-prod)'}`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
