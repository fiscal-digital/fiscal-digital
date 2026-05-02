#!/usr/bin/env node
/**
 * audit-cities.mjs — Audita o processamento por cidade
 *
 * Para cada cidade do top 50, conta:
 *   - Gazettes processadas no DynamoDB
 *   - Findings reais gerados (type + riskScore >= 60)
 *   - Status do checkpoint BACKFILL#
 *
 * Uso: node packages/collector/scripts/audit-cities.mjs
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'

const ddb = new DynamoDBClient({ region: 'us-east-1' })
const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const ALERTS_TABLE = 'fiscal-digital-alerts-prod'

const CITIES = [
  { id: '3550308', name: 'São Paulo' },
  { id: '3304557', name: 'Rio de Janeiro' },
  { id: '5300108', name: 'Brasília' },
  { id: '2304400', name: 'Fortaleza' },
  { id: '2927408', name: 'Salvador' },
  { id: '3106200', name: 'Belo Horizonte' },
  { id: '1302603', name: 'Manaus' },
  { id: '4106902', name: 'Curitiba' },
  { id: '2611606', name: 'Recife' },
  { id: '5208707', name: 'Goiânia' },
  { id: '4314902', name: 'Porto Alegre' },
  { id: '1501402', name: 'Belém' },
  { id: '3518800', name: 'Guarulhos' },
  { id: '3509502', name: 'Campinas' },
  { id: '2111300', name: 'São Luís' },
  { id: '2704302', name: 'Maceió' },
  { id: '5002704', name: 'Campo Grande' },
  { id: '3304904', name: 'São Gonçalo' },
  { id: '2211001', name: 'Teresina' },
  { id: '2507507', name: 'João Pessoa' },
  { id: '3548708', name: 'São Bernardo do Campo' },
  { id: '3301702', name: 'Duque de Caxias' },
  { id: '3303500', name: 'Nova Iguaçu' },
  { id: '2408102', name: 'Natal' },
  { id: '3547809', name: 'Santo André' },
  { id: '3534401', name: 'Osasco' },
  { id: '3552205', name: 'Sorocaba' },
  { id: '3170206', name: 'Uberlândia' },
  { id: '3543402', name: 'Ribeirão Preto' },
  { id: '3549904', name: 'São José dos Campos' },
  { id: '5103403', name: 'Cuiabá' },
  { id: '2607901', name: 'Jaboatão dos Guararapes' },
  { id: '3118601', name: 'Contagem' },
  { id: '4209102', name: 'Joinville' },
  { id: '2910800', name: 'Feira de Santana' },
  { id: '2800308', name: 'Aracaju' },
  { id: '4113700', name: 'Londrina' },
  { id: '3136702', name: 'Juiz de Fora' },
  { id: '4205407', name: 'Florianópolis' },
  { id: '5201405', name: 'Aparecida de Goiânia' },
  { id: '3205002', name: 'Serra' },
  { id: '3301009', name: 'Campos dos Goytacazes' },
  { id: '3300456', name: 'Belford Roxo' },
  { id: '3303302', name: 'Niterói' },
  { id: '3549805', name: 'São José do Rio Preto' },
  { id: '1500800', name: 'Ananindeua' },
  { id: '3205200', name: 'Vila Velha' },
  { id: '1100205', name: 'Porto Velho' },
  { id: '3530607', name: 'Mogi das Cruzes' },
  { id: '4305108', name: 'Caxias do Sul' },
]

// ── Scan all gazettes (paginated) and count by territory_id ──────────────────

async function scanAll(tableName) {
  const items = []
  let ExclusiveStartKey
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey,
    }))
    items.push(...(r.Items ?? []))
    ExclusiveStartKey = r.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

async function main() {
  console.log('Lendo DynamoDB (pode levar alguns segundos)...\n')

  const [gazettes, alerts] = await Promise.all([
    scanAll(GAZETTES_TABLE),
    scanAll(ALERTS_TABLE),
  ])

  // Count gazettes by territory_id and track date range (pk: GAZETTE#TERR#date#N)
  const gazettesByCity = {}
  const datesByCity = {}
  let backfillCheckpoints = 0
  for (const g of gazettes) {
    const pk = g.pk?.S ?? ''
    if (pk.startsWith('GAZETTE#')) {
      const parts = pk.split('#')
      const tid = parts[1]
      const date = parts[2]
      gazettesByCity[tid] = (gazettesByCity[tid] || 0) + 1
      if (!datesByCity[tid]) datesByCity[tid] = { min: date, max: date }
      else {
        if (date < datesByCity[tid].min) datesByCity[tid].min = date
        if (date > datesByCity[tid].max) datesByCity[tid].max = date
      }
    } else if (pk.startsWith('BACKFILL#')) {
      backfillCheckpoints++
    }
  }

  // Count findings by cityId
  const findingsByCity = {}
  for (const a of alerts) {
    const pk = a.pk?.S ?? ''
    if (!pk.startsWith('FINDING#')) continue
    const cityId = a.cityId?.S
    const type = a.type?.S
    const rs = a.riskScore?.N
    if (!cityId || !type || !rs) continue
    if (Number(rs) < 60) continue
    findingsByCity[cityId] = (findingsByCity[cityId] || 0) + 1
  }

  // Print table
  console.log(`${'#'.padEnd(3)} ${'Cidade'.padEnd(26)} ${'Gz'.padStart(5)} ${'Fd'.padStart(3)} ${'De'.padEnd(11)} ${'Até'.padEnd(11)}  Cobertura`)
  console.log('─'.repeat(95))

  let totalGazettes = 0
  let totalFindings = 0
  let processado = 0

  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i]
    const gz = gazettesByCity[c.id] || 0
    const fd = findingsByCity[c.id] || 0
    const range = datesByCity[c.id]
    totalGazettes += gz
    totalFindings += fd
    let cobertura, dateMin, dateMax
    if (gz === 0) {
      cobertura = '— não rodado'
      dateMin = '—'
      dateMax = '—'
    } else {
      processado++
      dateMin = range.min
      dateMax = range.max
      const since2021 = range.min <= '2021-01-31'
      cobertura = since2021 ? '✅ desde 2021' : `⚠️  desde ${range.min.slice(0,4)}`
    }
    const flag = fd > 0 ? `🔴${fd}` : (gz === 0 ? '  ' : '  ')
    console.log(`${String(i + 1).padEnd(3)} ${c.name.padEnd(26)} ${String(gz).padStart(5)} ${flag.padStart(3)} ${dateMin.padEnd(11)} ${dateMax.padEnd(11)}  ${cobertura}`)
  }

  console.log('─'.repeat(95))
  console.log(`Total: ${totalGazettes} gazettes · ${totalFindings} findings`)
  console.log(`Processadas: ${processado}/${CITIES.length} cidades · ${CITIES.length - processado} sem backfill executado`)
  console.log(`Checkpoints BACKFILL#: ${backfillCheckpoints}`)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
