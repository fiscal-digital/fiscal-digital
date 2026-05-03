#!/usr/bin/env node
/**
 * Audit de cobertura cidades × Fiscais.
 *
 * Uso:
 *   node packages/analyzer/scripts/coverage-audit.mjs
 *
 * Sai com exit 0 sempre — só relatório.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }))

const FISCAIS = [
  'fiscal-licitacoes', 'fiscal-contratos', 'fiscal-fornecedores',
  'fiscal-pessoal', 'fiscal-geral', 'fiscal-convenios',
  'fiscal-nepotismo', 'fiscal-publicidade', 'fiscal-locacao', 'fiscal-diarias',
]

async function scanGazettes() {
  const byCity = new Map()
  let count = 0
  let ek
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: 'fiscal-digital-gazettes-prod',
      FilterExpression: 'begins_with(pk, :p)',
      ExpressionAttributeValues: { ':p': 'GAZETTE#' },
      ExclusiveStartKey: ek,
      ProjectionExpression: 'pk',
    }))
    for (const item of out.Items ?? []) {
      count++
      const m = item.pk.match(/^GAZETTE#(\d+)#/)
      if (m) byCity.set(m[1], (byCity.get(m[1]) ?? 0) + 1)
    }
    ek = out.LastEvaluatedKey
  } while (ek)
  return { count, byCity }
}

async function scanFindings() {
  const matrix = new Map()
  let total = 0
  let ek
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: 'fiscal-digital-alerts-prod',
      FilterExpression: 'begins_with(pk, :p)',
      ExpressionAttributeValues: { ':p': 'FINDING#' },
      ExclusiveStartKey: ek,
      ProjectionExpression: 'cityId, fiscalId',
    }))
    for (const item of out.Items ?? []) {
      total++
      const c = item.cityId ?? '?'
      const f = item.fiscalId ?? '?'
      if (!matrix.has(c)) matrix.set(c, new Map())
      const cm = matrix.get(c)
      cm.set(f, (cm.get(f) ?? 0) + 1)
    }
    ek = out.LastEvaluatedKey
  } while (ek)
  return { total, matrix }
}

console.log('Cobertura cidades × Fiscais — Fiscal Digital')
console.log('═'.repeat(80))

console.log('\nScanning gazettes-prod...')
const gz = await scanGazettes()
console.log(`  ${gz.count} gazettes em ${gz.byCity.size} cidades únicas`)

console.log('Scanning alerts-prod...')
const fd = await scanFindings()
console.log(`  ${fd.total} findings em ${fd.matrix.size} cidades únicas`)

const cities = [...gz.byCity.entries()].sort((a, b) => b[1] - a[1])

let citiesAllFiscais = 0
let citiesNoFindings = 0
let citiesPartial = 0
let totalGaps = 0

for (const [city] of cities) {
  const cMatrix = fd.matrix.get(city) ?? new Map()
  const ranCount = FISCAIS.filter(f => cMatrix.has(f)).length
  if (ranCount === FISCAIS.length) citiesAllFiscais++
  else if (ranCount === 0) citiesNoFindings++
  else citiesPartial++
  totalGaps += FISCAIS.length - ranCount
}

console.log('\n' + '═'.repeat(80))
console.log('RESUMO')
console.log('═'.repeat(80))
console.log(`Cidades com TODOS os 10 Fiscais com pelo menos 1 finding:  ${citiesAllFiscais}/${cities.length}`)
console.log(`Cidades com cobertura parcial (alguns Fiscais com finding): ${citiesPartial}/${cities.length}`)
console.log(`Cidades com 0 findings:                                     ${citiesNoFindings}/${cities.length}`)
console.log(`Total de combos faltantes (cidade × fiscal):                ${totalGaps}/${cities.length * FISCAIS.length}`)
console.log()
console.log('NOTA: "Fiscal sem finding" pode ser legítimo — gazette sem')
console.log('palavra-chave relevante. O importante é o ANALYZER ter rodado')
console.log('todos os Fiscais sobre a gazette (verificável em gazettes-prod')
console.log('campo processedBy[fiscal] = true).')
console.log()
console.log('Detalhe por cidade abaixo (ordenado por gazettes):')
console.log('-'.repeat(80))

for (const [city, gzCount] of cities) {
  const cMatrix = fd.matrix.get(city) ?? new Map()
  const findCount = [...cMatrix.values()].reduce((s, n) => s + n, 0)
  const ranFiscais = FISCAIS.filter(f => cMatrix.has(f))
  const missingFiscais = FISCAIS.filter(f => !cMatrix.has(f))
  const status = ranFiscais.length === FISCAIS.length
    ? '✅ todos'
    : ranFiscais.length === 0
      ? '⚠️  ZERO'
      : `🟡 ${ranFiscais.length}/${FISCAIS.length}`
  console.log(`${city}  gazettes=${String(gzCount).padStart(5)}  findings=${String(findCount).padStart(4)}  ${status}`)
  if (missingFiscais.length > 0 && missingFiscais.length < FISCAIS.length) {
    console.log(`             sem: ${missingFiscais.map(m => m.replace('fiscal-', '')).join(', ')}`)
  }
}
