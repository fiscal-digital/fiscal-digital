#!/usr/bin/env node
/**
 * backfill-cities.mjs — invoca o collector Lambda para cada cidade ativa
 * cobrindo um período específico.
 *
 * Uso:
 *   node scripts/backfill-cities.mjs --since=2026-05-05            # todas as cidades ativas
 *   node scripts/backfill-cities.mjs --since=2026-05-05 --poc      # só Caxias + POA
 *   node scripts/backfill-cities.mjs --since=2021-01-01 --city=4305108
 *
 * Comportamento:
 *   - Invoca a Lambda fiscal-digital-collector-prod por cidade
 *   - Aguarda resposta (RequestResponse) por cidade — sequencial para respeitar
 *     o rate-limit de 60 req/min do Querido Diário (cada cidade pode levar
 *     vários minutos)
 *   - Loga resultado por cidade (processed/sent)
 *   - Idempotente: collector pula gazettes já em gazettes-prod
 *
 * Conflito com Ciclo 4 em observação:
 *   - Backfill curto (7 dias) é seguro: gera findings recentes que entram
 *     no baseline em curso normalmente
 *   - Backfill longo (2021-presente) gera milhares de findings novos —
 *     EXECUTAR APENAS APÓS 2026-06-10 (encerramento Ciclo 4)
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { CITIES } from '../packages/engine/dist/cities/index.js'

const REGION = 'us-east-1'
const FUNCTION_NAME = 'fiscal-digital-collector-prod'
const POC_CITIES = ['4305108', '4314902'] // Caxias do Sul + Porto Alegre

const lambda = new LambdaClient({ region: REGION })

async function invokeCity(territoryId, since) {
  const payload = { backfill: true, territory_id: territoryId, since }
  const start = Date.now()
  try {
    const out = await lambda.send(new InvokeCommand({
      FunctionName: FUNCTION_NAME,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    }))
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1)
    const responseRaw = out.Payload ? Buffer.from(out.Payload).toString('utf-8') : ''
    let response
    try {
      response = JSON.parse(responseRaw)
    } catch {
      response = { raw: responseRaw }
    }
    if (out.FunctionError) {
      console.error(`  [erro] ${territoryId} (${elapsedSec}s):`, response)
      return { ok: false, response }
    }
    console.log(`  [ok]   ${territoryId} (${elapsedSec}s):`, response.processed ?? response)
    return { ok: true, response }
  } catch (err) {
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1)
    console.error(`  [throw] ${territoryId} (${elapsedSec}s):`, err.message)
    return { ok: false, error: err.message }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const since = args.find(a => a.startsWith('--since='))?.replace('--since=', '')
  const cityArg = args.find(a => a.startsWith('--city='))?.replace('--city=', '')
  const poc = args.includes('--poc')

  if (!since) {
    console.error('uso: --since=YYYY-MM-DD [--city=ID | --poc]')
    process.exit(1)
  }

  let cityIds
  if (cityArg) {
    cityIds = [cityArg]
  } else if (poc) {
    cityIds = POC_CITIES
  } else {
    cityIds = Object.values(CITIES).filter(c => c.active).map(c => c.cityId)
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  Backfill ${since} → hoje — ${cityIds.length} cidade(s)`)
  console.log(`${'='.repeat(72)}\n`)

  const start = Date.now()
  let okCount = 0
  let failCount = 0
  for (const cityId of cityIds) {
    const result = await invokeCity(cityId, since)
    if (result.ok) okCount++
    else failCount++
  }

  const elapsedMin = ((Date.now() - start) / 60000).toFixed(1)
  console.log(`\n${'='.repeat(72)}`)
  console.log(`  CONCLUÍDO em ${elapsedMin} min`)
  console.log(`  Sucesso: ${okCount} · Falha: ${failCount} · Total: ${cityIds.length}`)
  console.log(`${'='.repeat(72)}\n`)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
