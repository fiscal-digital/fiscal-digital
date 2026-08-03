#!/usr/bin/env node
/**
 * reconcile-gazette-counters.mjs — recalcula os counters agregados de gazettes.
 *
 * Uso:
 *   node scripts/reconcile-gazette-counters.mjs --dry-run   # só reporta a deriva
 *   node scripts/reconcile-gazette-counters.mjs             # aplica
 *
 * Por que existe:
 *   `/cities/{cityId}/stats` fazia Scan da tabela inteira (47.720 itens / 94 MB
 *   medidos em 2026-08-03) para contar as gazettes de UMA cidade. Como `pk` é a
 *   chave HASH, `begins_with(pk, 'GAZETTE#{cityId}#')` não vira Query — o
 *   DynamoDB lia tudo e descartava o resto, paginando de 1 MB em 1 MB. O
 *   endpoint levava 2,8-3,3 s para devolver 288 bytes.
 *
 *   A API agora lê `AGG#GAZETTE_COUNT#{cityId}` com 1 GetItem, mantido pelo
 *   collector a cada `markQueued`. Este script faz o backfill inicial e serve
 *   de reconciliador: o incremento do collector é best-effort (falha nele não
 *   desfaz o Put da gazette), então o counter pode derivar com o tempo.
 *
 * Idempotente: recalcula do zero a partir dos itens `GAZETTE#` e sobrescreve.
 * Seguro para rodar em produção a qualquer momento — só escreve os ~N itens
 * agregados, nunca toca nos itens de gazette.
 *
 * Custo: 1 Scan completo (~94 MB / ~11.5k RRU) + ~N writes pequenos.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { basename } from 'node:path'

const REGION = process.env.AWS_REGION ?? 'us-east-1'
const GAZETTES_TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const DRY_RUN = process.argv.includes('--dry-run')

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

/**
 * Mesma derivação que o Scan da API usava (`begins_with(pk, 'GAZETTE#{id}#')`)
 * e que o collector usa em `cityIdFromGazetteKey`. Manter os três alinhados —
 * se divergirem, o counter passa a contar um universo diferente do que o
 * fallback de Scan contaria, e a deriva vira silenciosa.
 *
 * `GAZETTE#URLHASH#{sha}` (fontes não-QD) não pertence a cidade nenhuma.
 */
export function cityIdFromPk(pk) {
  if (typeof pk !== 'string' || !pk.startsWith('GAZETTE#')) return null
  const first = pk.slice('GAZETTE#'.length).split('#')[0]
  return /^\d+$/.test(first) ? first : null
}

/** Data da gazette: atributo `date`, com fallback para o segmento do pk. */
export function gazetteDate(item) {
  if (typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) return item.date
  const m = typeof item.pk === 'string' ? item.pk.match(/^GAZETTE#\d+#(\d{4}-\d{2}-\d{2})/) : null
  return m ? m[1] : null
}

export function aggregate(items) {
  const byCity = new Map()
  let globalTotal = 0
  let skipped = 0

  for (const item of items) {
    const cityId = cityIdFromPk(item.pk)
    if (!cityId) {
      if (typeof item.pk === 'string' && item.pk.startsWith('GAZETTE#')) skipped++
      continue
    }
    globalTotal++
    const cur = byCity.get(cityId) ?? { total: 0, firstDate: null, lastDate: null }
    cur.total++
    const date = gazetteDate(item)
    if (date) {
      if (!cur.firstDate || date < cur.firstDate) cur.firstDate = date
      if (!cur.lastDate || date > cur.lastDate) cur.lastDate = date
    }
    byCity.set(cityId, cur)
  }

  return { byCity, globalTotal, skipped }
}

async function scanAll() {
  const items = []
  let exclusiveStartKey
  let pages = 0
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: GAZETTES_TABLE,
      ProjectionExpression: 'pk, #d',
      ExpressionAttributeNames: { '#d': 'date' },
      ExclusiveStartKey: exclusiveStartKey,
    }))
    items.push(...(out.Items ?? []))
    exclusiveStartKey = out.LastEvaluatedKey
    pages++
    if (pages % 10 === 0) console.log(`  ... ${pages} páginas, ${items.length} itens`)
  } while (exclusiveStartKey)
  console.log(`  scan concluído: ${pages} páginas, ${items.length} itens`)
  return items
}

async function currentCounter(pk) {
  const out = await ddb.send(new GetCommand({
    TableName: GAZETTES_TABLE,
    Key: { pk },
    ProjectionExpression: '#t',
    ExpressionAttributeNames: { '#t': 'total' },
  }))
  return typeof out.Item?.total === 'number' ? out.Item.total : null
}

async function main() {
  console.log(`tabela: ${GAZETTES_TABLE}${DRY_RUN ? '  [DRY RUN]' : ''}`)
  const items = await scanAll()
  const { byCity, globalTotal, skipped } = aggregate(items)

  if (skipped > 0) {
    console.log(`\n${skipped} itens GAZETTE# sem cidade derivável (URLHASH) — fora do agregado, como no Scan antigo`)
  }

  const cities = [...byCity.entries()].sort((a, b) => b[1].total - a[1].total)
  console.log(`\n${cities.length} cidades, ${globalTotal} gazettes\n`)
  console.log('cidade      atual ->  novo   período')

  const now = new Date().toISOString()
  let drift = 0

  for (const [cityId, agg] of cities) {
    const pk = `AGG#GAZETTE_COUNT#${cityId}`
    const before = await currentCounter(pk)
    if (before !== agg.total) drift++
    const period = agg.firstDate && agg.lastDate ? `${agg.firstDate} .. ${agg.lastDate}` : '-'
    console.log(
      `${cityId}  ${String(before ?? '-').padStart(7)} -> ${String(agg.total).padStart(6)}   ${period}`,
    )
    if (!DRY_RUN) {
      await ddb.send(new PutCommand({
        TableName: GAZETTES_TABLE,
        Item: {
          pk,
          total: agg.total,
          ...(agg.firstDate && { firstDate: agg.firstDate }),
          ...(agg.lastDate && { lastDate: agg.lastDate }),
          updatedAt: now,
          reconciledAt: now,
        },
      }))
    }
  }

  const globalPk = 'AGG#GAZETTE_COUNT'
  const globalBefore = await currentCounter(globalPk)
  console.log(`\nglobal    ${String(globalBefore ?? '-').padStart(7)} -> ${String(globalTotal).padStart(6)}`)
  if (!DRY_RUN) {
    await ddb.send(new PutCommand({
      TableName: GAZETTES_TABLE,
      Item: { pk: globalPk, total: globalTotal, updatedAt: now, reconciledAt: now },
    }))
  }

  console.log(
    `\n${drift} de ${cities.length} cidades estavam com counter divergente` +
    `${DRY_RUN ? ' — nada foi escrito (--dry-run)' : ' — corrigidas'}`,
  )
}

// Só executa quando chamado direto; importar as funções puras no teste não
// pode disparar Scan em produção.
if (process.argv[1] && basename(process.argv[1]) === 'reconcile-gazette-counters.mjs') {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
