#!/usr/bin/env node
/**
 * backfill-published.mjs — popula `published` nos findings existentes (#146).
 *
 * POR QUE ISTO PRECISA RODAR ANTES DO DEPLOY DA API
 *
 * `GSI4-risk-published` e esparso: so entra no indice o item que tem o
 * atributo `published`. Os findings gravados antes de #146 nao tem. Se a API
 * passar a consultar o indice sem este backfill, a Query volta vazia e o feed
 * publico fica vazio — sem erro, sem alarme.
 *
 * Rodar este script ANTES e seguro e nao muda comportamento nenhum: escrever
 * o atributo e aditivo, e nada le o indice ate a API nova subir.
 *
 * VALOR GRAVADO
 *
 *   published = 'false'  quando o item tem `unpublishable` (brand gate reprovou)
 *   published = 'true'   para todo o resto
 *
 * String, nao boolean: chave de indice do DynamoDB nao aceita BOOL.
 *
 * So toca FINDING#. Itens de memoria (DISPENSA#, ADITIVO#, LOCACAO#,
 * CONVENIO#, DIARIA#) ficam de fora de proposito — e o que mantem o indice
 * esparso e o feed barato.
 *
 * Idempotente: `attribute_not_exists(published)` na condicao, entao re-run nao
 * sobrescreve o que o publisher tenha virado para 'false' depois.
 *
 * Uso:
 *   node packages/analyzer/scripts/backfill-published.mjs            # dry-run
 *   node packages/analyzer/scripts/backfill-published.mjs --apply
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const REGION = process.env.AWS_REGION ?? 'us-east-1'
const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'
const APPLY = process.argv.includes('--apply')

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

/** Valor a gravar. Exportado para teste. */
export function valorPublished(item) {
  return item?.unpublishable ? 'false' : 'true'
}

/** So FINDING# entra no indice. Exportado para teste. */
export function ehFinding(pk) {
  return typeof pk === 'string' && pk.startsWith('FINDING#')
}

async function scanFindings() {
  const itens = []
  let ExclusiveStartKey
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: ALERTS_TABLE,
      FilterExpression: 'begins_with(pk, :p)',
      ExpressionAttributeValues: { ':p': 'FINDING#' },
      ProjectionExpression: 'pk, published, unpublishable, riskScore',
      ExclusiveStartKey,
    }))
    itens.push(...(out.Items ?? []))
    ExclusiveStartKey = out.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return itens
}

async function main() {
  console.log(`tabela: ${ALERTS_TABLE}`)
  console.log(`modo:   ${APPLY ? 'APPLY (escreve)' : 'DRY-RUN (nao escreve)'}\n`)

  const findings = await scanFindings()
  const semAtributo = findings.filter(f => f.published === undefined)
  const jaTem = findings.length - semAtributo.length
  const viraTrue = semAtributo.filter(f => valorPublished(f) === 'true').length
  const viraFalse = semAtributo.length - viraTrue

  // riskScore precisa existir e ser numero: e a range key do GSI4. Item sem
  // ele nao entra no indice mesmo com `published` gravado.
  const semRisk = semAtributo.filter(f => typeof f.riskScore !== 'number')

  console.log(`FINDING# encontrados:        ${findings.length}`)
  console.log(`  ja tem \`published\`:        ${jaTem}`)
  console.log(`  a gravar:                  ${semAtributo.length}  (${viraTrue} 'true', ${viraFalse} 'false')`)
  if (semRisk.length) {
    console.log(`  SEM riskScore numerico:    ${semRisk.length}  <- nao entram no GSI4`)
    for (const f of semRisk.slice(0, 5)) console.log(`      ${f.pk}`)
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. Rode com --apply para escrever.')
    return
  }

  let ok = 0
  let pulados = 0
  let erros = 0
  for (const f of semAtributo) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: ALERTS_TABLE,
        Key: { pk: f.pk },
        UpdateExpression: 'SET #p = :v',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(#p)',
        ExpressionAttributeNames: { '#p': 'published' },
        ExpressionAttributeValues: { ':v': valorPublished(f) },
      }))
      ok++
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') pulados++
      else {
        erros++
        console.error(`  erro em ${f.pk}: ${err?.message?.slice(0, 120)}`)
      }
    }
  }
  console.log(`\ngravados: ${ok} | pulados (ja tinham): ${pulados} | erros: ${erros}`)
  if (erros) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main()
