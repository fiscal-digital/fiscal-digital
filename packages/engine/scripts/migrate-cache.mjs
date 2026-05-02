#!/usr/bin/env node
/**
 * migrate-cache.mjs — UH-22 Phase 5
 *
 * Popula a tabela entities-prod com extrações Bedrock para todas as gazettes
 * históricas (cache 100% pronto). Após rodar, qualquer novo Fiscal pode
 * processar o histórico via reanalyze.mjs sem custo de extração ($0 Bedrock).
 *
 * Estratégia:
 *   1. Para cada cidade ativa × semestre 2021→hoje
 *   2. Query Querido Diário (mesmo querystring KEYWORDS do collector)
 *   3. Para cada excerpt retornado:
 *      a. Hash md5 truncado (16 chars)
 *      b. GetItem em entities-prod (cache hit?)
 *      c. Miss → Bedrock Nova Lite → PutItem
 *   4. Idempotente: re-runs custam $0 (cache hit em tudo)
 *
 * Uso:
 *   node packages/engine/scripts/migrate-cache.mjs                 # full run (50 cidades)
 *   node packages/engine/scripts/migrate-cache.mjs --poc           # só Caxias + Porto Alegre
 *   node packages/engine/scripts/migrate-cache.mjs --dry-run       # só conta
 *   node packages/engine/scripts/migrate-cache.mjs --city=4305108  # single city
 *
 * Custo estimado full run: ~$4 (46k gazettes × ~2 excerpts × $0.000047)
 * Tempo: ~30-40 min
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { createHash } from 'crypto'

// ── Config ───────────────────────────────────────────────────────────────────

const QD_API = 'https://api.queridodiario.ok.org.br'
const ENTITIES_TABLE = 'fiscal-digital-entities-prod'
const EXTRACTION_MODEL = 'amazon.nova-lite-v1:0'
const SCHEMA_VERSION = 1
const REGION = 'us-east-1'
const QD_PAGE_SIZE = 50
const QD_RATE_DELAY_MS = 1100  // 60/min = ~1 req/sec, +100ms safety
const BEDROCK_CONCURRENCY = 10 // chamadas Bedrock paralelas por batch

const KEYWORDS = [
  'dispensa de licitação', 'inexigibilidade', 'contratação direta',
  'aditivo', 'prorrogação', 'nomeação', 'exoneração',
  'licitação', 'pregão', 'tomada de preços',
]

// 50 cidades ativas (mesmo set de cities/index.ts active=true)
const CITIES = [
  '3550308', '3304557', '5300108', '2304400', '2927408', '3106200', '1302603',
  '4106902', '2611606', '5208707', '4314902', '1501402', '3518800', '3509502',
  '2111300', '2704302', '5002704', '3304904', '2211001', '2507507', '3548708',
  '3301702', '3303500', '2408102', '3547809', '3534401', '3552205', '3170206',
  '3543402', '3549904', '5103403', '2607901', '3118601', '4209102', '2910800',
  '2800308', '4113700', '3136702', '4205407', '5201405', '3205002', '3301009',
  '3300456', '3303302', '3549805', '1500800', '3205200', '1100205', '3530607',
  '4305108',
]

const SYSTEM_PROMPT = `Você é um extrator de entidades de diários oficiais municipais brasileiros.
Analise o texto e extraia:
- secretaria: nome da secretaria municipal responsável (string ou null)
- actType: tipo do ato — contrato | licitacao | dispensa | inexigibilidade | nomeacao | exoneracao | aditivo | prorrogacao | outro (string ou null)
- supplier: razão social da empresa ou pessoa contratada (string ou null)
- legalBasis: base legal citada, ex: "Lei 14.133/2021, Art. 75" (string ou null)
- subtype: classifica o objeto da contratação para determinar o inciso da Lei 14.133/2021 Art. 75 —
  "obra_engenharia" (obras civis, reforma de imóvel/prédio/escola/estrada, construção, pavimentação) |
  "servico" (consultoria, assessoria, manutenção de equipamentos não-imobiliária, limpeza, eventos, tecnologia da informação) |
  "compra" (aquisição de bens, equipamentos, veículos, materiais) |
  null (ambíguo ou não aplicável)
- valorOriginalContrato: quando o texto for de aditivo e citar explicitamente o valor original do contrato (ex: "valor original de R$ X", "contrato originalmente firmado por R$ X", "valor inicial do contrato de R$ X"), extrair o número; null caso contrário

Responda APENAS com JSON válido, sem texto adicional.`

// ── Clients ──────────────────────────────────────────────────────────────────

const bedrock = new BedrockRuntimeClient({ region: REGION })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))
const hashText = text => createHash('md5').update(text).digest('hex').slice(0, 16)

function generateSemesters() {
  const out = []
  let cur = new Date('2021-01-01T00:00:00Z')
  const today = new Date()
  while (cur < today) {
    const since = cur.toISOString().split('T')[0]
    const next = new Date(cur)
    next.setMonth(next.getMonth() + 6)
    const until = next > today ? today.toISOString().split('T')[0] : next.toISOString().split('T')[0]
    out.push({ since, until })
    cur = next
  }
  return out
}

async function queryQD(territoryId, since, until, offset) {
  const params = new URLSearchParams({
    territory_ids: territoryId,
    size: String(QD_PAGE_SIZE),
    offset: String(offset),
    excerpt_size: '300',
    number_of_excerpts: '5',
    querystring: KEYWORDS.join(' OR '),
    published_since: since,
    published_until: until,
  })
  const r = await fetch(`${QD_API}/gazettes?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'fiscal-digital-cache-migration/0.1' },
  })
  if (!r.ok) throw new Error(`QD ${r.status}: ${r.statusText}`)
  return r.json()
}

async function cacheGet(gazetteId, hash) {
  const r = await ddb.send(new GetCommand({
    TableName: ENTITIES_TABLE,
    Key: { pk: `EXTRACTION#${gazetteId}#${hash}` },
  }))
  return r.Item ?? null
}

async function cachePut(gazetteId, hash, entities, confidence) {
  await ddb.send(new PutCommand({
    TableName: ENTITIES_TABLE,
    Item: {
      pk: `EXTRACTION#${gazetteId}#${hash}`,
      entities,
      confidence,
      schemaVersion: SCHEMA_VERSION,
      cachedAt: new Date().toISOString(),
    },
  }))
}

async function bedrockExtract(text) {
  const cmd = new ConverseCommand({
    modelId: EXTRACTION_MODEL,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: text.slice(0, 4000) }] }],
    inferenceConfig: { maxTokens: 256, temperature: 0 },
  })
  const r = await bedrock.send(cmd)
  const raw = r.output?.message?.content?.[0]?.text ?? ''
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return {} // tolerável — regex base no analyzer ainda preenche
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const poc = args.includes('--poc')
  const cityArg = args.find(a => a.startsWith('--city='))?.replace('--city=', '')
  // PoC = Caxias do Sul (origem MVP) + Porto Alegre (capital escala média)
  // Ver CLAUDE.md "Cidades-padrão para Provas de Conceito"
  const cities = cityArg
    ? [cityArg]
    : poc
      ? ['4305108', '4314902']
      : CITIES
  const semesters = generateSemesters()

  console.log(`\n${'='.repeat(72)}`)
  console.log('  Fiscal Digital — UH-22 Phase 5: Migration de Cache de Extração')
  console.log(`  Cidades: ${cities.length} · Semestres: ${semesters.length}`)
  console.log(`  Tabela: ${ENTITIES_TABLE}`)
  if (dryRun) console.log('  Modo: DRY-RUN (não chama Bedrock nem grava em DynamoDB)')
  console.log(`${'='.repeat(72)}\n`)

  let totalGazettes = 0
  let totalExcerpts = 0
  let cacheHits = 0
  let cacheMisses = 0
  let bedrockErrors = 0

  const start = Date.now()

  for (const cityId of cities) {
    let cityGazettes = 0
    let cityHits = 0
    let cityMisses = 0

    for (const { since, until } of semesters) {
      let offset = 0
      while (true) {
        let body
        try {
          body = await queryQD(cityId, since, until, offset)
        } catch (err) {
          console.error(`[${cityId}] QD error ${since}→${until} offset=${offset}: ${err.message}`)
          break
        }
        await sleep(QD_RATE_DELAY_MS)

        const gazettes = body.gazettes ?? []
        if (gazettes.length === 0) break

        // Coleta (gazetteId, excerpt) tasks da página inteira para processar em paralelo
        const tasks = []
        for (const g of gazettes) {
          const gazetteId = `${g.territory_id}#${g.date}#${g.edition ?? '1'}`
          totalGazettes++
          cityGazettes++
          for (const excerpt of g.excerpts ?? []) {
            totalExcerpts++
            tasks.push({ gazetteId, excerpt, hash: hashText(excerpt) })
          }
        }

        if (dryRun) continue

        // Processa em batches de BEDROCK_CONCURRENCY
        for (let i = 0; i < tasks.length; i += BEDROCK_CONCURRENCY) {
          const batch = tasks.slice(i, i + BEDROCK_CONCURRENCY)
          const results = await Promise.allSettled(batch.map(async ({ gazetteId, excerpt, hash }) => {
            const cached = await cacheGet(gazetteId, hash)
            if (cached && cached.entities && (cached.schemaVersion ?? 0) >= SCHEMA_VERSION) {
              return 'hit'
            }
            const entities = await bedrockExtract(excerpt)
            await cachePut(gazetteId, hash, entities, 0.85)
            return 'miss'
          }))
          for (const r of results) {
            if (r.status === 'fulfilled') {
              if (r.value === 'hit') { cacheHits++; cityHits++ }
              else { cacheMisses++; cityMisses++ }
            } else {
              bedrockErrors++
              console.error(`  error: ${r.reason?.message?.slice(0, 80) ?? r.reason}`)
            }
          }
        }

        offset += QD_PAGE_SIZE
        if (offset >= (body.total_gazettes ?? 0)) break
      }
    }

    const total = cityHits + cityMisses
    const hitRate = total > 0 ? Math.round((cityHits / total) * 100) : 0
    console.log(`  ${cityId}: ${cityGazettes} gazettes · ${cityHits} hits · ${cityMisses} misses (${hitRate}% cache hit)`)
  }

  const durSec = ((Date.now() - start) / 1000).toFixed(0)
  const totalCalls = cacheHits + cacheMisses
  const hitRate = totalCalls > 0 ? Math.round((cacheHits / totalCalls) * 100) : 0
  const costUsd = (cacheMisses * 0.000047).toFixed(4)

  console.log(`\n${'='.repeat(72)}`)
  console.log(`  CONCLUÍDO em ${durSec}s`)
  console.log(`  Gazettes processadas: ${totalGazettes}`)
  console.log(`  Excerpts: ${totalExcerpts}`)
  console.log(`  Cache hits: ${cacheHits} · misses (Bedrock): ${cacheMisses}`)
  console.log(`  Hit rate: ${hitRate}%`)
  console.log(`  Erros Bedrock: ${bedrockErrors}`)
  console.log(`  Custo Bedrock estimado: $${costUsd}`)
  console.log(`${'='.repeat(72)}\n`)
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
