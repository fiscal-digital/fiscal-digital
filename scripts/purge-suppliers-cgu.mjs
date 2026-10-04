#!/usr/bin/env node
// purge-suppliers-cgu.mjs — remove das PROFILEs de suppliers-prod o bloco CGU
// gravado com o parâmetro errado (fiscal-digital#243): `sancoes` com 30
// registros de terceiros em todos os 108 fornecedores.
//
// Remove `sancoes`, `cguSourceUrl`, `cguCapturedAt` e `lastLookupAt`. Sem o
// `lastLookupAt`, o modo `scheduled` do supplier-collector (08:00 UTC) trata
// o PROFILE como stale e repopula com `codigoSancionado` no próximo run —
// desde que o collector corrigido já esteja implantado.
//
// Antes de apagar, grava um snapshot completo dos itens em --snapshot.
//
// Uso:
//   node scripts/purge-suppliers-cgu.mjs --snapshot=antes.json           # dry-run
//   node scripts/purge-suppliers-cgu.mjs --snapshot=antes.json --apply

import { writeFileSync } from 'node:fs'
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'

const args = process.argv.slice(2)
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const apply = args.includes('--apply')
const TABLE = arg('table') ?? 'fiscal-digital-suppliers-prod'
const snapshotPath = arg('snapshot')
if (!snapshotPath) { console.error('--snapshot=<arquivo> é obrigatório'); process.exit(1) }
const ddb = new DynamoDBClient({ region: 'us-east-1' })

const items = []
let ExclusiveStartKey
do {
  const r = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'sk = :p',
    ExpressionAttributeValues: { ':p': { S: 'PROFILE' } },
    ExclusiveStartKey,
  }))
  items.push(...(r.Items ?? []))
  ExclusiveStartKey = r.LastEvaluatedKey
} while (ExclusiveStartKey)

writeFileSync(snapshotPath, JSON.stringify(Object.fromEntries(items.map((i) => [i.pk.S, i])), null, 1))

const alvo = items.filter((i) => i.sancoes || i.cguCapturedAt || i.cguSourceUrl)
const foreign = alvo.reduce((n, i) => n + (i.sancoes?.L?.length ?? 0), 0)
console.log(`${apply ? 'APPLY' : 'DRY-RUN'} — ${TABLE}: ${items.length} PROFILEs, ${alvo.length} com bloco CGU, ${foreign} registros de sanção a remover. Snapshot: ${snapshotPath}`)

for (const i of alvo) {
  console.log(`  ${i.pk.S}  sancoes=${i.sancoes?.L?.length ?? 0}  cguCapturedAt=${i.cguCapturedAt?.S ?? '-'}`)
  if (!apply) continue
  await ddb.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: { pk: i.pk, sk: i.sk },
    UpdateExpression: 'REMOVE sancoes, cguSourceUrl, cguCapturedAt, lastLookupAt',
  }))
}
console.log(apply ? 'Concluído.' : 'Nada gravado (use --apply).')
