#!/usr/bin/env node
/**
 * backfill-excerpts-from-s3.mjs — EVO-001 / UH-22 (slice residual)
 *
 * Popula o campo `excerpts` em `gazettes-prod` para gazettes ANTIGAS que ainda
 * não o têm, lendo do arquivo S3 L3' (`excerpts/<key>.json`) — GRÁTIS, sem
 * chamar o Querido Diário.
 *
 * Por que existe:
 *   O núcleo do EVO-001 (persistir excerpts em DDB para evitar re-coleta cara do
 *   QD no reanalyze) já está em prod:
 *     - collector grava `excerpts` no item ao coletar (pós ~2026-05-09);
 *     - `packages/analyzer/scripts/reanalyze.mjs` faz write-through lazy (QD→DDB).
 *   Resta apenas o resíduo: gazettes coletadas ANTES do collector gravar excerpts
 *   e que nunca passaram por reanalyze. Essas ficam invisíveis ao runner local
 *   `scripts/replay-fiscal.mjs` (que filtra por `attribute_exists(excerpts)` e
 *   NÃO tem fallback QD). Para muitas delas o arquivo S3 L3' já existe (o cache
 *   de excerpts foi populado independentemente) — este script copia S3 → DDB de
 *   graça, sem tocar no QD.
 *
 * Fronteira (o que este script NÃO resolve):
 *   Gazettes anteriores ao S3 caching (sem DDB `excerpts` E sem `excerpts/*.json`
 *   no S3) são irrecuperáveis sem QD. Este script as reporta como "sem arquivo
 *   S3" e as deixa como estão — o lazy-fill do `reanalyze.mjs` cobre quando/se
 *   necessário. Custo zero é a razão de existir; ZERO chamadas ao QD por design.
 *
 * Uso:
 *   node scripts/backfill-excerpts-from-s3.mjs --city=4305108 --dry-run   (default)
 *   node scripts/backfill-excerpts-from-s3.mjs --city=4305108 --apply
 *   node scripts/backfill-excerpts-from-s3.mjs --apply                    (full-table)
 *
 * Flags:
 *   --dry-run   (default) escaneia e reporta, sem escrever em DDB
 *   --apply     grava `excerpts` no DDB (idempotente via if_not_exists)
 *   --city=<id> filtra por territory_id IBGE (recomendado p/ PoC — evita
 *               full-table scan de 46k+ itens; CLAUDE.md: Caxias 4305108 +
 *               Porto Alegre 4314902)
 *
 * Idempotência: `SET #e = if_not_exists(#e, :ex)` nunca sobrescreve excerpts já
 * bons; e o scan filtra `attribute_not_exists(excerpts)`, então a 2ª passada
 * nem vê os itens já preenchidos → 0 escritas.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { pdfCacheS3Key } from '@fiscal-digital/engine'

// ─── Config ───────────────────────────────────────────────────────────────────

const REGION = 'us-east-1'
const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const BUCKET = 'fiscal-digital-gazettes-cache-prod'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const s3 = new S3Client({ region: REGION })

// ─── Derivação da chave S3 L3' — espelho EXATO de cacheExcerptsJson do collector ─
//
// Consistência byte-idêntica é obrigatória: qualquer divergência = 100% de miss
// silencioso (LRN — consistência de chave S3). Reusa pdfCacheS3Key do engine
// (mesma função do collector), nunca reimplementa.
//
//   url QD:  https://data.queridodiario.ok.org.br/4305108/2022-08-18/abc.pdf
//   pdfKey:  4305108/2022-08-18/abc.pdf
//   s3 key:  excerpts/4305108/2022-08-18/abc.json
function excerptsS3Key(url) {
  const pdfKey = pdfCacheS3Key(url)
  if (!pdfKey) return null
  return `excerpts/${pdfKey.replace(/\.pdf$/i, '')}.json`
}

// ─── Leitura do arquivo de excerpts no S3 (GetObject; 404 = não existe) ────────

async function readExcerptsFromS3(s3Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }))
    const body = await r.Body.transformToString()
    const parsed = JSON.parse(body)
    const excerpts = parsed.excerpts
    if (!Array.isArray(excerpts)) return null
    return excerpts
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
    throw err
  }
}

// ─── Gravação race-safe no DDB (nunca sobrescreve) ────────────────────────────

async function writeExcerptsToDdb(pk, excerpts) {
  await ddb.send(new UpdateCommand({
    TableName: GAZETTES_TABLE,
    Key: { pk },
    UpdateExpression: 'SET #e = if_not_exists(#e, :ex)',
    ExpressionAttributeNames: { '#e': 'excerpts' },
    ExpressionAttributeValues: { ':ex': excerpts },
  }))
}

// ─── Scan de gazettes SEM excerpts (opcionalmente por cidade) ─────────────────

async function* scanGazettesWithoutExcerpts(cityId) {
  let ExclusiveStartKey
  const filters = ['attribute_not_exists(excerpts)']
  const values = {}
  if (cityId) {
    filters.unshift('begins_with(pk, :p)')
    values[':p'] = `GAZETTE#${cityId}#`
  } else {
    filters.unshift('begins_with(pk, :p)')
    values[':p'] = 'GAZETTE#'
  }
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: GAZETTES_TABLE,
      FilterExpression: filters.join(' AND '),
      ExpressionAttributeValues: values,
      ExclusiveStartKey,
    }))
    for (const item of r.Items ?? []) {
      yield { pk: item.pk, url: item.url }
    }
    ExclusiveStartKey = r.LastEvaluatedKey
  } while (ExclusiveStartKey)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const cityArg = args.find(a => a.startsWith('--city='))?.replace('--city=', '')
  const apply = args.includes('--apply')
  const dryRun = !apply

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  backfill-excerpts-from-s3 (EVO-001/UH-22)`)
  console.log(`  Modo: ${dryRun ? 'DRY-RUN (sem write em DDB)' : 'APPLY (grava em gazettes-prod)'}`)
  console.log(`  Cidade: ${cityArg ?? 'TODAS (full-table scan — pesado)'}`)
  console.log(`  Fonte: s3://${BUCKET}/excerpts/  (ZERO chamadas ao Querido Diário)`)
  console.log(`${'='.repeat(72)}\n`)

  if (apply) {
    console.warn(`⚠️  APPLY ativo — vai gravar em gazettes-prod.`)
    console.warn(`   if_not_exists garante que nunca sobrescreve excerpts existentes.`)
    console.warn(`   Ctrl+C nos proximos 3s para abortar.\n`)
    await new Promise(r => setTimeout(r, 3000))
  }

  let scanned = 0        // itens sem excerpts examinados
  let noUrl = 0          // item sem url QD válida (não há como derivar chave S3)
  let withS3File = 0     // arquivo S3 encontrado e com excerpts não-vazios
  let emptyS3 = 0        // arquivo S3 existe mas excerpts vazio → pulado (LRN-019)
  let noS3File = 0       // sem arquivo S3 → só QD resolveria (fora de escopo)
  let written = 0        // escritas efetivas em DDB (apenas --apply)
  let errors = 0

  for await (const { pk, url } of scanGazettesWithoutExcerpts(cityArg)) {
    scanned++

    const s3Key = excerptsS3Key(url)
    if (!s3Key) {
      noUrl++
      continue
    }

    let excerpts
    try {
      excerpts = await readExcerptsFromS3(s3Key)
    } catch (err) {
      errors++
      console.error(`[s3-err] ${pk} (${s3Key}): ${err.message?.slice(0, 200) ?? err}`)
      continue
    }

    if (excerpts === null) {
      noS3File++
      continue
    }
    // LRN-20260502-019: nunca gravar array vazio (mesma regra do collector).
    if (excerpts.length === 0) {
      emptyS3++
      continue
    }

    withS3File++

    if (apply) {
      try {
        await writeExcerptsToDdb(pk, excerpts)
        written++
      } catch (err) {
        errors++
        console.error(`[ddb-err] ${pk}: ${err.message?.slice(0, 200) ?? err}`)
      }
    }

    if (scanned % 200 === 0) {
      console.log(`  ...${scanned} escaneadas | ${withS3File} com S3 | ${noS3File} sem S3 | ${written} escritas`)
    }
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  RESUMO`)
  console.log(`${'='.repeat(72)}`)
  console.log(`  Gazettes sem excerpts examinadas : ${scanned}`)
  console.log(`  ├─ com arquivo S3 (backfillável) : ${withS3File}`)
  console.log(`  ├─ SEM arquivo S3 (só QD resolve): ${noS3File}`)
  console.log(`  ├─ arquivo S3 com excerpts vazio : ${emptyS3}`)
  console.log(`  ├─ sem url QD válida             : ${noUrl}`)
  console.log(`  └─ erros                         : ${errors}`)
  console.log(`  Escritas em gazettes-prod        : ${written}${dryRun ? ' (DRY-RUN — nada gravado)' : ''}`)
  console.log(`\nModo: ${dryRun ? 'DRY-RUN — rode com --apply para gravar.' : 'APPLY — excerpts gravados via if_not_exists.'}`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
