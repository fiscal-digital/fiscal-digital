#!/usr/bin/env node
/**
 * backfill.mjs — Processa histórico completo de Caxias do Sul (gestão Adiló 2021→hoje)
 *
 * Estratégia:
 *   - Divide por semestre (respeita timeout de 5 min do Lambda collector)
 *   - Sequencial com 5s entre períodos (respeita 60 req/min do Querido Diário)
 *   - Dedup automático: gazettes já processadas são puladas pelo collector
 *
 * Uso:
 *   node packages/collector/scripts/backfill.mjs
 *   node packages/collector/scripts/backfill.mjs --dry-run
 *   node packages/collector/scripts/backfill.mjs --from=2023-01-01
 *   node packages/collector/scripts/backfill.mjs --city=4314902   (Porto Alegre)
 *
 * Cidades disponíveis:
 *   4305108 — Caxias do Sul (padrão)
 *   4314902 — Porto Alegre
 *
 * Custo estimado: < $0.50 Bedrock por cidade
 */

import { execSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'

const FUNCTION_NAME = 'fiscal-digital-collector-prod'
const REGION = 'us-east-1'

const CITY_NAMES = {
  '4305108': 'Caxias do Sul',
  '4314902': 'Porto Alegre',
}

// ── Gerar semestres ──────────────────────────────────────────────────────────

function generateSemesters(fromStr) {
  const semesters = []
  const from = new Date((fromStr ?? '2021-01-01') + 'T00:00:00Z')
  const today = new Date()

  let current = new Date(from)
  while (current < today) {
    const since = current.toISOString().split('T')[0]
    const next = new Date(current)
    next.setMonth(next.getMonth() + 6)
    const until = next > today ? today.toISOString().split('T')[0] : next.toISOString().split('T')[0]
    semesters.push({ since, until })
    current = next
  }
  return semesters
}

// ── Invocar Lambda via AWS CLI ───────────────────────────────────────────────

function invokeBackfill(since, territoryId) {
  const payload = JSON.stringify({
    version: '0',
    id: `backfill-${territoryId}-${since}`,
    source: 'manual-backfill',
    account: '',
    time: new Date().toISOString(),
    region: REGION,
    resources: [],
    'detail-type': 'Scheduled Event',
    detail: { backfill: true, territory_id: territoryId, since },
  })

  // Escrever payload em arquivo temporário (evita problemas com aspas no shell)
  const payloadFile = join(process.cwd(), `backfill-payload-${territoryId}-${since}.json`)
  const resultFile = join(process.cwd(), `backfill-result-${territoryId}-${since}.json`)

  try {
    writeFileSync(payloadFile, payload, 'utf-8')

    const start = Date.now()
    const output = execSync(
      `aws lambda invoke` +
      ` --function-name ${FUNCTION_NAME}` +
      ` --region ${REGION}` +
      ` --cli-binary-format raw-in-base64-out` +
      ` --log-type Tail` +
      ` --payload fileb://${payloadFile}` +
      ` ${resultFile}`,
      { encoding: 'utf-8', timeout: 320000 }
    )
    const durationMs = Date.now() - start

    // Decodificar log tail da resposta
    let logLines = []
    try {
      const parsed = JSON.parse(output)
      if (parsed.LogResult) {
        logLines = Buffer.from(parsed.LogResult, 'base64').toString('utf-8').split('\n').filter(Boolean)
      }
    } catch { /* log tail opcional */ }

    const processedLine = logLines.find(l => l.includes('processed=') || l.includes('done processed'))
    const processed = processedLine?.match(/processed=(\d+)/)?.[1] ?? '?'
    const sent = processedLine?.match(/sent=(\d+)/)?.[1] ?? '?'

    return { processed, sent, durationMs, ok: true }
  } catch (err) {
    return { processed: 0, sent: 0, durationMs: 0, ok: false, error: err.message?.slice(0, 100) }
  } finally {
    if (existsSync(payloadFile)) unlinkSync(payloadFile)
    if (existsSync(resultFile)) unlinkSync(resultFile)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const fromArg = args.find(a => a.startsWith('--from='))?.replace('--from=', '')
  const TERRITORY_ID = args.find(a => a.startsWith('--city='))?.replace('--city=', '') ?? '4305108'
  const cityName = CITY_NAMES[TERRITORY_ID] ?? TERRITORY_ID

  const semesters = generateSemesters(fromArg)
  const startYear = fromArg?.slice(0, 4) ?? '2021'

  console.log(`\n${'='.repeat(62)}`)
  console.log(`  Fiscal Digital — Backfill ${cityName}`)
  console.log(`  Desde ${startYear} · ${semesters.length} semestres · território ${TERRITORY_ID}`)
  if (dryRun) console.log('  Modo: DRY-RUN — apenas lista períodos')
  console.log(`${'='.repeat(62)}\n`)

  if (dryRun) {
    semesters.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.since} → ${s.until}`))
    const estimatedMinutes = semesters.length * 0.5
    console.log(`\n  Tempo estimado: ~${estimatedMinutes.toFixed(0)} min (5s entre semestres)`)
    console.log('  Custo estimado: < $0.50 Bedrock total\n')
    return
  }

  let totalProcessed = 0
  let totalSent = 0
  const errors = []

  for (let i = 0; i < semesters.length; i++) {
    const { since, until } = semesters[i]
    const prefix = `[${String(i + 1).padStart(2)}/${semesters.length}] ${since} → ${until}`
    process.stdout.write(`${prefix} ... `)

    const { processed, sent, durationMs, ok, error } = invokeBackfill(since, TERRITORY_ID)

    if (ok) {
      totalProcessed += Number(processed) || 0
      totalSent += Number(sent) || 0
      console.log(`processed=${processed} sent=${sent} (${durationMs}ms)`)
    } else {
      console.log(`ERRO: ${error}`)
      errors.push({ since, error })
    }

    // 5s entre semestres para não pressionar o Querido Diário API
    if (i < semesters.length - 1) {
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  console.log(`\n${'='.repeat(62)}`)
  console.log(`  CONCLUÍDO`)
  console.log(`  Gazettes verificadas: ${totalProcessed}`)
  console.log(`  Novas → SQS: ${totalSent}`)
  if (errors.length > 0) {
    console.log(`  Erros (${errors.length}): ${errors.map(e => e.since).join(', ')}`)
  }
  console.log(`\n  Analyzer procesará as ${totalSent} novas via SQS (event source mapping).`)
  console.log('  Acompanhe: CloudWatch /aws/lambda/fiscal-digital-analyzer-prod')
  console.log(`${'='.repeat(62)}\n`)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
