#!/usr/bin/env node
// canary-fase1.mjs — A/B do pré-filtro da Fase 1 sobre a camada raw.
//
// Pergunta que responde: os 97,7% de findings descartados são artefato da
// janela de 300 chars do QD? Compara, para a MESMA cidade e período:
//   A: Fiscais sobre os excerpts armazenados no DDB (o que a produção vê)
//   B: Fiscais sobre keywordWindows(texto integral da camada raw)
// Mesmo código, mesmos thresholds, mesma extração — só a janela muda.
//
// Dry-run estrito: nenhuma escrita em alerts-prod, narrativa (Haiku) nunca é
// chamada. Única escrita: cache de extração em entities-prod (aditivo, e é o
// comportamento normal de análise). Custo: ~1 chamada Nova Lite por texto
// novo (frações de centavo).
//
// Uso:
//   node scripts/canary-fase1.mjs --city=4305108 --since=2025-01-01 --until=2025-07-21
//   node scripts/canary-fase1.mjs --city=4305108 --since=2025-01-01 --until=2025-02-01 --max=20

process.on('unhandledRejection', (err) => {
  console.error(`[unhandledRejection] ${err?.message?.slice(0, 300) ?? err}`)
})

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import {
  fiscalLicitacoes, fiscalContratos, fiscalFornecedores, fiscalPessoal,
  fiscalConvenios, fiscalNepotismo, fiscalPublicidade, fiscalLocacao,
  fiscalDiarias, createCachedExtractEntities, saveMemory,
  querySuppliersContract, getPublishThresholds,
  keywordWindows, FILTER_VERSION,
} from '../packages/engine/dist/index.js'

const REGION = 'us-east-1'
const ALERTS_TABLE = 'fiscal-digital-alerts-prod'
const GAZETTES_TABLE = 'fiscal-digital-gazettes-prod'
const BUCKET = 'fiscal-digital-gazettes-cache-prod'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const s3 = new S3Client({ region: REGION })

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

// Réplica do analyzer, SEM narrativa e SEM persistência (dry-run estrito).
function buildContext(gazetteId) {
  return {
    alertsTable: ALERTS_TABLE,
    extractEntities: createCachedExtractEntities({ gazetteId }),
    generateNarrative: async () => '[canário: narrativa omitida]',
    saveMemory,
    queryAlertsByCnpj,
    querySuppliersContract: (input) => querySuppliersContract.execute(input),
  }
}

async function runFiscais(gazette, cityId) {
  const ctx = buildContext(gazette.id)
  const out = []
  for (const [id, fiscal] of Object.entries(FISCAIS)) {
    try {
      const findings = await fiscal.analisar({ gazette, cityId, context: ctx })
      out.push(...findings)
    } catch (err) {
      console.error(`  [${gazette.id}] ${id} falhou: ${err?.message?.slice(0, 160)}`)
    }
  }
  return out
}

async function* gazettesDDB(cityId, since, until) {
  let ExclusiveStartKey
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: GAZETTES_TABLE,
      FilterExpression: 'begins_with(pk, :p) AND attribute_exists(excerpts)',
      ExpressionAttributeValues: { ':p': `GAZETTE#${cityId}#` },
      ExclusiveStartKey,
    }))
    for (const item of r.Items ?? []) {
      const parts = (item.pk ?? '').split('#')
      const date = item.date ?? parts[2]
      if (date < since || date > until) continue
      if (!item.excerpts?.length) continue
      yield {
        id: `${parts[1]}#${date}#${parts[3] ?? '1'}`,
        territory_id: parts[1],
        date,
        url: item.url ?? '',
        excerpts: item.excerpts,
      }
    }
    ExclusiveStartKey = r.LastEvaluatedKey
  } while (ExclusiveStartKey)
}

async function s3Json(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return JSON.parse(await out.Body.transformToString('utf-8'))
}

async function s3Text(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return out.Body.transformToString('utf-8')
}

function tally(findings) {
  const byType = {}
  for (const f of findings) byType[`${f.fiscalId}/${f.type}`] = (byType[`${f.fiscalId}/${f.type}`] ?? 0) + 1
  return byType
}

async function main() {
  const args = process.argv.slice(2)
  const cityId = args.find((a) => a.startsWith('--city='))?.slice(7) ?? '4305108'
  const since = args.find((a) => a.startsWith('--since='))?.slice(8) ?? '2025-01-01'
  const until = args.find((a) => a.startsWith('--until='))?.slice(8) ?? '2025-07-21'
  const max = Number(args.find((a) => a.startsWith('--max='))?.slice(6) ?? Infinity)

  const { riskThreshold, confidenceThreshold } = await getPublishThresholds()
  console.log(`CANARIO FASE 1 — filterVersion=${FILTER_VERSION} city=${cityId} ${since}..${until}`)
  console.log(`gate de publicacao: risk>=${riskThreshold} conf>=${confidenceThreshold}\n`)

  // ── Braço A: excerpts do DDB (o que a produção vê hoje) ──
  const A = []
  const datasA = new Set()
  let nA = 0
  for await (const g of gazettesDDB(cityId, since, until)) {
    if (nA >= max) break
    nA++
    datasA.add(g.date)
    A.push(...await runFiscais(g, cityId))
    if (nA % 25 === 0) process.stderr.write(`A:${nA} `)
  }

  // ── Braço B: keywordWindows(texto integral do raw/) ──
  const years = [...new Set([since.slice(0, 4), until.slice(0, 4)])]
  const entries = []
  for (const y of years) {
    try {
      const m = await s3Json(`raw/manifests/${cityId}/${y}.json`)
      entries.push(...m.entries.filter((e) => e.date >= since && e.date <= until))
    } catch { /* ano sem manifesto */ }
  }

  const B = []
  const datasB = new Set()
  let nB = 0
  let semJanela = 0
  let truncados = 0
  for (const e of entries) {
    if (nB >= max) break
    nB++
    const texto = await s3Text(e.s3Key)
    const { windows, truncated } = keywordWindows(texto)
    if (truncated) truncados++
    if (windows.length === 0) { semJanela++; continue }
    datasB.add(e.date)
    const gazette = {
      id: `${cityId}#${e.date}#raw${e.sha256.slice(0, 8)}`,
      territory_id: cityId,
      date: e.date,
      url: e.urlOriginal || `s3://${BUCKET}/${e.s3Key}`,
      excerpts: windows,
    }
    B.push(...await runFiscais(gazette, cityId))
    if (nB % 25 === 0) process.stderr.write(`B:${nB} `)
  }
  process.stderr.write('\n')

  // ── Relatório ──
  const gate = (f) => f.riskScore >= riskThreshold && f.confidence >= confidenceThreshold
  const linha = (nome, gaz, fs) =>
    console.log(`${nome}  gazettes=${gaz}  findings=${fs.length}  publicaveis=${fs.filter(gate).length}`)

  console.log('\n══ RESULTADO ══')
  linha('A (excerpts DDB )', nA, A)
  linha('B (raw+filtro   )', nB, B)
  console.log(`\nB: ${semJanela} diários sem nenhuma keyword (filtro os poupou do Bedrock); ${truncados} truncados no teto de janelas`)

  const soB = [...datasB].filter((d) => !datasA.has(d))
  console.log(`cobertura: A viu ${datasA.size} datas, B viu ${datasB.size}; datas SÓ em B: ${soB.length}`)

  console.log('\npor fiscal/tipo (A → B):')
  const tA = tally(A)
  const tB = tally(B)
  for (const k of [...new Set([...Object.keys(tA), ...Object.keys(tB)])].sort()) {
    console.log(`  ${k.padEnd(46)} ${String(tA[k] ?? 0).padStart(4)} → ${String(tB[k] ?? 0).padStart(4)}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
