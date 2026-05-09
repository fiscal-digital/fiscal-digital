import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import crypto from 'node:crypto'
import { CITIES, getCityOrFallback, pdfCacheUrl, pdfCacheS3Key, createLogger, getPublishThresholds } from '@fiscal-digital/engine'
import type { Finding } from '@fiscal-digital/engine'

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const GAZETTES_CACHE_BUCKET = process.env.GAZETTES_CACHE_BUCKET ?? 'fiscal-digital-gazettes-cache-prod'

const logger = createLogger('api')

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }))
const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'
const GAZETTES_TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const NEWSLETTER_TABLE = process.env.NEWSLETTER_TABLE ?? 'fiscal-digital-newsletter-prod'
const COSTS_TABLE = process.env.COSTS_TABLE ?? 'fiscal-digital-costs-prod'
const SITE_URL = 'https://fiscaldigital.org'
const API_URL = process.env.API_URL ?? 'https://api.fiscaldigital.org'
// Build timestamp injetado no bundle pelo deploy. Fallback = boot da Lambda.
const BUILD_TIME = process.env.BUILD_TIME ?? new Date().toISOString()

// ── Bedrock cost constants ──────────────────────────────────────────────────
//
// Custos médios por chamada validados no LRN-20260502-009 (eval Bedrock).
// Bedrock fatura em USD; convertemos UMA vez aqui (USD * 5.4 BRL/USD, BCB
// PTAX próximo de 2026-05-02). API expõe APENAS BRL — moeda única do site.
//   Nova Lite: $0.000047/call × 5.4 = R$ 0.0002538
//   Haiku 4.5: $0.000770/call × 5.4 = R$ 0.004158
const COST_NOVA_LITE_PER_CALL_BRL = 0.0002538
const COST_HAIKU_PER_CALL_BRL = 0.004158

// ── Fetch findings from DynamoDB ────────────────────────────────────────────

// Scan paginado completo aplicando os filtros do request. Sem Limit fixo —
// pega todos os itens que casam (DynamoDB retorna em chunks de 1MB) e
// agrega no servidor. Para ~5k findings é OK; depois disso, migrar para
// GSI cursor.
// WIN-API-001: Query GSI1-city-date quando filtro tem city/state.
// Substitui scan da tabela inteira (3,5 MB) por leitura proporcional ao
// tamanho da cidade. Caxias 194 items × ~1 KB = ~200 KB lidos em vez de
// 3,5 MB. GSI1 tem projection ALL — não precisa fetch extra. Itens são
// retornados em ordem DESC por createdAt naturalmente (ScanIndexForward=false).
async function queryFindingsByCity(cityId: string, type?: string): Promise<Finding[]> {
  const all: Finding[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const out: { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new QueryCommand({
      TableName: ALERTS_TABLE,
      IndexName: 'GSI1-city-date',
      KeyConditionExpression: 'cityId = :cid',
      ...(type && {
        FilterExpression: '#type = :type',
        ExpressionAttributeNames: { '#type': 'type' },
      }),
      ExpressionAttributeValues: {
        ':cid': cityId,
        ...(type && { ':type': type }),
      },
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    }))
    all.push(...((out.Items ?? []) as Finding[]))
    exclusiveStartKey = out.LastEvaluatedKey
  } while (exclusiveStartKey)
  return all
}

async function fetchFindings(filters: {
  cityId?: string
  state?: string
  type?: string
  limit?: number
}): Promise<Finding[]> {
  const cityIds = filters.state
    ? Object.values(CITIES).filter(c => c.uf === (filters.state ?? '').toUpperCase()).map(c => c.cityId)
    : filters.cityId ? [filters.cityId] : null

  let all: Finding[] = []
  if (cityIds && cityIds.length > 0) {
    // WIN-API-001 path: 1+ Queries em GSI1-city-date.
    const groups = await Promise.all(cityIds.map(id => queryFindingsByCity(id, filters.type)))
    all = groups.flat()
  } else {
    // Fallback: sem filtro de cidade → scan (cobre /alerts global e /alerts?type=X).
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const out: { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new ScanCommand({
        TableName: ALERTS_TABLE,
        FilterExpression: filters.type
          ? 'begins_with(pk, :prefix) AND #type = :type'
          : 'begins_with(pk, :prefix)',
        ExpressionAttributeNames: filters.type ? { '#type': 'type' } : undefined,
        ExpressionAttributeValues: {
          ':prefix': 'FINDING#',
          ...(filters.type ? { ':type': filters.type } : {}),
        },
        ExclusiveStartKey: exclusiveStartKey,
      }))
      all.push(...((out.Items ?? []) as Finding[]))
      exclusiveStartKey = out.LastEvaluatedKey
    } while (exclusiveStartKey)
  }

  // Gate de publicação: thresholds dinâmicos via SSM (TEC-ENG-002), default 60/0.70.
  // Findings que ficam abaixo desses thresholds não vão para feed/home/RSS —
  // ficam apenas na tabela alerts-prod para auditoria interna.
  //
  // Brand gate exhausted: findings com `unpublishable: true` (ex: narrativas
  // que travaram no glossary.json#avoid mesmo após 3× regeneração) ficam no
  // DDB como audit trail mas não aparecem em feed público. Ver publisher
  // markUnpublishable.
  const { riskThreshold, confidenceThreshold } = await getPublishThresholds()
  return all
    .filter(f => f.type && f.riskScore >= riskThreshold && (f.confidence ?? 0) >= confidenceThreshold)
    .filter(f => !(f as Finding & { unpublishable?: boolean }).unpublishable)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

// Scan completo de findings — usado por /stats. Sem filter de riskScore para
// estatística total. Pagina até esgotar.
async function scanAllFindings(): Promise<Finding[]> {
  const all: Finding[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const out: { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new ScanCommand({
      TableName: ALERTS_TABLE,
      FilterExpression: 'begins_with(pk, :prefix)',
      ExpressionAttributeValues: { ':prefix': 'FINDING#' },
      ExclusiveStartKey: exclusiveStartKey,
    }))
    all.push(...((out.Items ?? []) as Finding[]))
    exclusiveStartKey = out.LastEvaluatedKey
  } while (exclusiveStartKey)
  // Filtra unpublishable também aqui — /stats deve refletir o universo
  // efetivamente publicável, mantendo paridade com /alerts.
  return all.filter(f => !(f as Finding & { unpublishable?: boolean }).unpublishable)
}

// WIN-API-003: counter agregado em `gazettes-prod#AGG#GAZETTE_COUNT`.
// Substitui scan paginado de 23 MB (46k items × ~500 B). O collector incrementa
// atomicamente via `UpdateItem ADD` em cada `markQueued` bem-sucedido.
// Fallback para `null` se item não existir — `/stats` mostra `null` em vez de
// crashar (compatível com tipo atual `totalGazettesProcessed: number | null`).
async function countGazettes(): Promise<number | null> {
  try {
    const out = await ddb.send(new GetCommand({
      TableName: GAZETTES_TABLE,
      Key: { pk: 'AGG#GAZETTE_COUNT' },
      ProjectionExpression: '#t',
      ExpressionAttributeNames: { '#t': 'total' },
    }))
    const total = (out.Item as { total?: number } | undefined)?.total
    return typeof total === 'number' ? total : null
  } catch (err) {
    logger.error('gazettes counter read failed (degraded /stats)', { err })
    return null
  }
}

// ── Stats aggregation ────────────────────────────────────────────────────────

interface StatsResponse {
  totalFindings: number
  totalGazettesProcessed: number | null
  findingsByFiscal: Record<string, number>
  findingsByCity: Array<{ cityId: string; name: string; count: number }>
  findingsByType: Record<string, number>
  /** Custo total estimado em BRL — moeda única do projeto. */
  estimatedCostBrl: number
  lastFindingAt: string | null
  uptimeDays: number
}

function buildStats(findings: Finding[], gazettesCount: number | null): StatsResponse {
  const byFiscal: Record<string, number> = {}
  const byCity: Record<string, number> = {}
  const byType: Record<string, number> = {}
  let earliest: string | null = null
  let latest: string | null = null

  for (const f of findings) {
    if (f.fiscalId) byFiscal[f.fiscalId] = (byFiscal[f.fiscalId] ?? 0) + 1
    if (f.cityId) byCity[f.cityId] = (byCity[f.cityId] ?? 0) + 1
    if (f.type) byType[f.type] = (byType[f.type] ?? 0) + 1
    const ts = f.createdAt
    if (ts) {
      if (!earliest || ts.localeCompare(earliest) < 0) earliest = ts
      if (!latest || ts.localeCompare(latest) > 0) latest = ts
    }
  }

  const totalFindings = findings.length
  const totalGazettes = gazettesCount ?? 0
  // Custo: 1 chamada Nova Lite por gazette + 1 chamada Haiku por finding (narrativa).
  // Custo direto em BRL — fonte de verdade do projeto.
  const estimatedCostBrl = Number(
    (totalGazettes * COST_NOVA_LITE_PER_CALL_BRL + totalFindings * COST_HAIKU_PER_CALL_BRL).toFixed(2)
  )

  const uptimeDays = earliest
    ? Math.max(0, Math.round((Date.now() - new Date(earliest).getTime()) / 86400000))
    : 0

  const findingsByCity = Object.entries(byCity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cityId, count]) => ({ cityId, name: getCityOrFallback(cityId).name, count }))

  return {
    totalFindings,
    totalGazettesProcessed: gazettesCount,
    findingsByFiscal: byFiscal,
    findingsByCity,
    findingsByType: byType,
    estimatedCostBrl,
    lastFindingAt: latest,
    uptimeDays,
  }
}

// ── Cities aggregation ──────────────────────────────────────────────────────

interface CityResponse {
  cityId: string
  name: string
  slug: string
  uf: string
  active: boolean
  findingsCount: number
  lastFindingAt: string | null
}

function buildCities(findings: Finding[]): CityResponse[] {
  const counts: Record<string, { count: number; last: string | null }> = {}
  for (const f of findings) {
    if (!f.cityId) continue
    const e = counts[f.cityId] ?? { count: 0, last: null }
    e.count += 1
    const ts = f.createdAt ?? null
    if (ts && (!e.last || ts.localeCompare(e.last) > 0)) e.last = ts
    counts[f.cityId] = e
  }

  return Object.values(CITIES).map(c => {
    const stats = counts[c.cityId] ?? { count: 0, last: null }
    return {
      cityId: c.cityId,
      name: c.name,
      slug: c.slug,
      uf: c.uf,
      active: c.active,
      findingsCount: stats.count,
      lastFindingAt: stats.last,
    }
  })
}

// WIN-API-002: 1 Query por cidade em GSI1-city-date com projeção mínima.
// Substitui scan da tabela inteira (3,5 MB) por leituras proporcionais a cada
// cidade. Lê apenas os campos necessários para o gate (riskScore, confidence,
// type) + agregação (createdAt). Total < 200 KB para o conjunto das 50 cidades.
async function countFindingsByCity(cityId: string): Promise<{ count: number; last: string | null }> {
  let count = 0
  let last: string | null = null
  let exclusiveStartKey: Record<string, unknown> | undefined
  // Thresholds via SSM (TEC-ENG-002) — uma chamada cacheada por cold start.
  const { riskThreshold, confidenceThreshold } = await getPublishThresholds()
  do {
    const out: { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new QueryCommand({
      TableName: ALERTS_TABLE,
      IndexName: 'GSI1-city-date',
      KeyConditionExpression: 'cityId = :cid',
      // Aplicar gate na própria Query (FilterExpression) — items abaixo do gate
      // não retornam, mas WCU é cobrado como se tivessem retornado. Aceito —
      // ainda 70× menos dados que scan.
      FilterExpression: '#type <> :empty AND riskScore >= :r AND confidence >= :c',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: {
        ':cid': cityId,
        ':empty': '',
        ':r': riskThreshold,
        ':c': confidenceThreshold,
      },
      ProjectionExpression: 'createdAt',
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    }))
    const items = (out.Items ?? []) as Array<{ createdAt?: string }>
    count += items.length
    for (const it of items) {
      const ts = it.createdAt
      if (ts && (!last || ts.localeCompare(last) > 0)) last = ts
    }
    exclusiveStartKey = out.LastEvaluatedKey
  } while (exclusiveStartKey)
  return { count, last }
}

async function buildCitiesFromQueries(): Promise<CityResponse[]> {
  const cities = Object.values(CITIES)
  const stats = await Promise.all(cities.map(c => countFindingsByCity(c.cityId)))
  return cities.map((c, i) => ({
    cityId: c.cityId,
    name: c.name,
    slug: c.slug,
    uf: c.uf,
    active: c.active,
    findingsCount: stats[i].count,
    lastFindingAt: stats[i].last,
  }))
}

// ── City stats (UH-API-001) ─────────────────────────────────────────────────
//
// Retorna métricas por cidade: gazettes processadas + findings publicáveis +
// período coberto. Habilita o 5º KPI "Diários processados" na página de
// cidade no `fiscal-digital-web`.
//
// Conta gazettes via Scan filtrado por prefixo `GAZETTE#${cityId}#` em
// `gazettes-prod`. Para escala atual (~50k gazettes total, ~2k por cidade
// no máximo) o custo de Scan filtrado é aceitável; cache HTTP de 5min
// absorve a maior parte das requisições. Migrar para GSI/cursor se ficar
// pesado depois de 100k+ gazettes.
interface CityStatsResponse {
  cityId: string
  totalGazettesProcessed: number
  totalFindings: number
  lastFindingAt: string | null
  periodCovered: { from: string; to: string } | null
}

async function buildCityStats(cityId: string): Promise<CityStatsResponse> {
  let gazettesCount = 0
  let firstDate: string | null = null
  let lastDate: string | null = null
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const out: { Items?: unknown[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new ScanCommand({
      TableName: GAZETTES_TABLE,
      FilterExpression: 'begins_with(pk, :prefix)',
      ExpressionAttributeValues: { ':prefix': `GAZETTE#${cityId}#` },
      ExclusiveStartKey: exclusiveStartKey,
      // Só precisamos de pk + date para essa agregação.
      ProjectionExpression: 'pk, #d',
      ExpressionAttributeNames: { '#d': 'date' },
    }))
    for (const item of (out.Items ?? []) as { pk?: string; date?: string }[]) {
      gazettesCount += 1
      // Schema: GAZETTE#{territory_id}#{date}#{edition} — fallback para
      // extrair date do pk caso o atributo `date` esteja ausente.
      const date = item.date ?? (item.pk?.match(/^GAZETTE#\d+#(\d{4}-\d{2}-\d{2})/)?.[1])
      if (date) {
        if (!firstDate || date < firstDate) firstDate = date
        if (!lastDate || date > lastDate) lastDate = date
      }
    }
    exclusiveStartKey = out.LastEvaluatedKey
  } while (exclusiveStartKey)

  // Findings já passam pelo gate de publicação dentro de fetchFindings.
  const findings = await fetchFindings({ cityId })
  const lastFindingAt = findings[0]?.createdAt ?? null

  return {
    cityId,
    totalGazettesProcessed: gazettesCount,
    totalFindings: findings.length,
    lastFindingAt,
    periodCovered: firstDate && lastDate ? { from: firstDate, to: lastDate } : null,
  }
}

// ── RSS builder ──────────────────────────────────────────────────────────────

function toRssDate(iso?: string): string {
  return iso ? new Date(iso).toUTCString() : new Date().toUTCString()
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Espelho de fiscal-digital-web/lib/findings.ts FINDING_TYPE_LABELS (versão PT).
// Mantenha sincronizado nos dois lados — labels divergentes confundem leitores
// que veem RSS + site.
function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    dispensa_irregular: 'Dispensa irregular',
    fracionamento: 'Fracionamento',
    aditivo_abusivo: 'Aditivo abusivo',
    prorrogacao_excessiva: 'Prorrogação excessiva',
    cnpj_jovem: 'CNPJ jovem',
    concentracao_fornecedor: 'Concentração de fornecedor',
    pico_nomeacoes: 'Pico de nomeações',
    rotatividade_anormal: 'Rotatividade anormal',
    inexigibilidade_sem_justificativa: 'Inexigibilidade sem justificativa',
    padrao_recorrente: 'Padrão recorrente',
    convenio_sem_chamamento: 'Convênio sem chamamento',
    repasse_recorrente_osc: 'Repasse recorrente a OSC',
    diaria_irregular: 'Diária irregular',
    publicidade_eleitoral: 'Publicidade em janela vedada',
    locacao_sem_justificativa: 'Locação sem justificativa',
    nepotismo_indicio: 'Indício de nepotismo',
    cnpj_situacao_irregular: 'CNPJ em situação irregular',
    fornecedor_sancionado: 'Fornecedor sancionado (CGU)',
  }
  return labels[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function buildRss(findings: Finding[], channelTitle: string, selfUrl: string): string {
  const items = findings.map(f => {
    const city = getCityOrFallback(f.cityId)
    const valueStr = f.value ? ` — R$ ${Number(f.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''
    const title = `[${typeLabel(f.type)}] ${city.name}${valueStr}`
    const source = f.evidence?.[0]?.source ?? SITE_URL
    const description = f.narrative || `${typeLabel(f.type)} identificado em ${city.name}. Base legal: ${f.legalBasis ?? 'Lei 14.133/2021'}.`

    return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(source)}</link>
      <description>${escapeXml(description)}</description>
      <pubDate>${toRssDate(f.createdAt)}</pubDate>
      <guid isPermaLink="false">${escapeXml(f.id ?? '')}</guid>
      <category>${escapeXml(f.type)}</category>
      <category>${escapeXml(city.uf)}</category>
    </item>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${SITE_URL}</link>
    <description>Fiscalização autônoma de gastos públicos municipais brasileiros. Fonte: queridodiario.ok.org.br</description>
    <language>pt-BR</language>
    <lastBuildDate>${toRssDate()}</lastBuildDate>
    <ttl>60</ttl>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`
}

// ── Newsletter — POST /newsletter ────────────────────────────────────────────

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

function hashIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

interface NewsletterBody {
  email?: string
  locale?: 'pt-br' | 'en-us'
  source?: string
  /** Honeypot field — humanos não veem (CSS off-screen + aria-hidden + tabindex=-1).
   *  Se vier preenchido, é bot de form-fill — rejeita silenciosamente. */
  website?: string
}

async function handleNewsletter(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
  }
  let body: NewsletterBody
  try {
    body = JSON.parse(event.body ?? '{}') as NewsletterBody
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_json' }) }
  }

  const emailRaw = body.email
  if (!emailRaw || typeof emailRaw !== 'string' || !EMAIL_RE.test(emailRaw)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_email' }) }
  }
  const email = normalizeEmail(emailRaw)
  const locale: 'pt-br' | 'en-us' = body.locale === 'en-us' ? 'en-us' : 'pt-br'
  const source = (body.source ?? 'home').slice(0, 64)

  // Honeypot — campo `website` invisível no frontend. Bots de form-fill
  // preenchem; humanos não. Resposta 200 ok-like para não revelar a heurística
  // (bots não tentam variantes). NÃO grava no DDB.
  if (typeof body.website === 'string' && body.website.length > 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'subscribed' }) }
  }
  const pk = `NEWSLETTER#${email}`
  const now = new Date().toISOString()
  const ipHash = hashIp(event.requestContext?.http?.sourceIp)

  // Idempotente — se já existe, retorna 200 sem reset (não revela se já existia).
  const existing = await ddb.send(new GetCommand({ TableName: NEWSLETTER_TABLE, Key: { pk } }))
  if (existing.Item) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'already_subscribed' }) }
  }

  await ddb.send(new PutCommand({
    TableName: NEWSLETTER_TABLE,
    Item: {
      pk,
      email,
      createdAt: now,
      locale,
      source,
      ...(ipHash && { ipHash }),
    },
    // Race-safe: só insere se PK não existir
    ConditionExpression: 'attribute_not_exists(pk)',
  })).catch((err: { name?: string }) => {
    if (err?.name === 'ConditionalCheckFailedException') return null
    throw err
  })

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'subscribed' }) }
}

// ── Route handlers ──────────────────────────────────────────────────────────

function ok(body: string, contentType: string, maxAge = 30): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      // /alerts e /rss: 30s (LRN-20260502-015 — dashboard precisa frescor).
      // /stats: 60s (agregado mais caro, frescor menos crítico).
      // /cities: 300s (counts mudam pouco; cidade ativa é estável).
      'Cache-Control': `public, max-age=${maxAge}, must-revalidate`,
    },
    body,
  }
}

// ── Lazy PDF cache — GET /pdf?source=<qdUrl> ─────────────────────────────────
//
// Modelo on-demand: o usuário é o gatilho. Primeira visita popula o cache;
// subsequentes batem no CDN. Sem backfill em massa — cobertura proporcional ao
// interesse real. Falhas (timeout, fetch error) caem em redirect para QD direto.

async function s3HeadExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: GAZETTES_CACHE_BUCKET, Key: key }))
    return true
  } catch (err) {
    // SDK v3 retorna nomes diferentes para 404 (NotFound, NoSuchKey) e o S3
    // com OAC pode retornar 403 para chaves inexistentes em algumas configs.
    // Tratamos qualquer erro de cliente (4xx) como "não existe" — fluxo segue
    // para o caminho de upload. Apenas erros 5xx propagamos.
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    const status = e.$metadata?.httpStatusCode
    if (status && status >= 500) throw err
    return false
  }
}

function redirect(location: string, maxAge = 60): APIGatewayProxyResultV2 {
  return {
    statusCode: 302,
    headers: {
      location,
      'cache-control': `public, max-age=${maxAge}`,
    },
    body: '',
  }
}

async function handlePdfProxy(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const source = event.queryStringParameters?.source ?? ''
  const cdnUrl = pdfCacheUrl(source)
  const key = pdfCacheS3Key(source)
  if (!cdnUrl || !key) {
    // URL inválida ou não-QD — redireciona para a source mesmo assim (fallback honesto)
    if (source.startsWith('https://')) return redirect(source, 0)
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid_source' }), headers: { 'Content-Type': 'application/json' } }
  }

  // 1) Já está no cache? Redirect direto pro CDN (cache no browser 24h).
  try {
    if (await s3HeadExists(key)) {
      return redirect(cdnUrl, 86400)
    }
  } catch (err) {
    logger.warn('s3 head failed — fallback to source', { key, err: (err as Error).message })
    return redirect(source, 0)
  }

  // 2) Não está cacheado — baixa do QD, sobe para S3, redirect pro CDN.
  try {
    const fetchedAt = new Date().toISOString()
    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 25_000)
    const res = await fetch(source, {
      headers: { 'User-Agent': 'FiscalDigital/1.0 (+https://fiscaldigital.org)' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timeoutId))

    if (!res.ok) {
      logger.warn('qd fetch failed — fallback', { source, status: res.status })
      return redirect(source, 0)
    }

    const contentType = res.headers.get('content-type') ?? 'application/pdf'
    const buf = Buffer.from(await res.arrayBuffer())
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')

    await s3.send(new PutObjectCommand({
      Bucket: GAZETTES_CACHE_BUCKET,
      Key: key,
      Body: buf,
      ContentType: 'application/pdf',
      ContentDisposition: 'inline',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        originalUrl: source,
        sha256,
        mimeType: contentType,
        bytes: String(buf.byteLength),
        fetchedAt,
        triggeredBy: 'lazy-on-demand',
      },
    }))

    logger.info('pdf cached on-demand', { key, bytes: buf.byteLength })
    return redirect(cdnUrl, 86400)
  } catch (err) {
    logger.warn('lazy cache failed — fallback to source', { source, err: (err as Error).message })
    return redirect(source, 0)
  }
}

// ── FiscalCustos — UH-OPS-001 ───────────────────────────────────────────────
//
// Lê snapshots persistidos pela Lambda fiscal-digital-costs-prod.
// API NÃO chama Cost Explorer no request path (custo $0.01/call).
// Tabela é PAY_PER_REQUEST single-key — Scan com prefix filter é cheap.

interface CostDailyItem {
  pk: string
  date: string
  totalUsd: number
  totalBrl: number
  byService: Array<{ service: string; usd: number; brl: number }>
  ptaxBrl: number
  capturedAt: string
}

interface CostMonthlyItem {
  pk: string
  month: string
  mtdUsd: number
  mtdBrl: number
  projectedUsd: number
  projectedBrl: number
  prevMonthBrl: number | null
  deltaPct: number | null
  byService: Array<{ service: string; usd: number; brl: number }>
  ptaxBrl: number
  capturedAt: string
}

async function fetchCostsHistory(days: number): Promise<{
  daily: CostDailyItem[]
  monthly: CostMonthlyItem | null
}> {
  // Daily: scan prefix COST#DAILY# (no máx ~365 itens, payload kB).
  const dailyOut = await ddb.send(new ScanCommand({
    TableName: COSTS_TABLE,
    FilterExpression: 'begins_with(pk, :p)',
    ExpressionAttributeValues: { ':p': 'COST#DAILY#' },
  }))
  const allDaily = ((dailyOut.Items ?? []) as CostDailyItem[])
    .filter(i => typeof i.date === 'string')
    .sort((a, b) => a.date.localeCompare(b.date))

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const cutoffIso = cutoff.toISOString().slice(0, 10)
  const daily = allDaily.filter(i => i.date >= cutoffIso)

  // Monthly: pega mês corrente.
  const now = new Date()
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const monthlyOut = await ddb.send(new GetCommand({
    TableName: COSTS_TABLE,
    Key: { pk: `COST#MONTHLY#${monthKey}` },
  }))
  const monthly = (monthlyOut.Item as CostMonthlyItem | undefined) ?? null

  return { daily, monthly }
}

interface LifetimeTotalItem {
  pk: string
  totalUsd: number
  totalBrl: number
  ptaxBrl: number
  fromMonth: string
  toMonth: string
  capturedAt: string
}

interface CostMtdResponse {
  currency: 'BRL'
  month: string
  mtdBrl: number
  projectedBrl: number
  lifetimeBrl: number
  deltaPct: number | null
  updatedAt: string | null
  source: 'aws-cost-explorer'
}

async function fetchCostsMtd(): Promise<CostMtdResponse | null> {
  const now = new Date()
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const [monthlyOut, lifetimeOut] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: COSTS_TABLE,
      Key: { pk: `COST#MONTHLY#${monthKey}` },
    })),
    ddb.send(new GetCommand({
      TableName: COSTS_TABLE,
      Key: { pk: 'COST#TOTAL#LIFETIME' },
    })),
  ])

  const monthly = monthlyOut.Item as CostMonthlyItem | undefined
  const lifetime = lifetimeOut.Item as LifetimeTotalItem | undefined

  if (!monthly && !lifetime) return null

  return {
    currency: 'BRL',
    month: monthKey,
    mtdBrl: monthly?.mtdBrl ?? 0,
    projectedBrl: monthly?.projectedBrl ?? 0,
    lifetimeBrl: lifetime?.totalBrl ?? monthly?.mtdBrl ?? 0,
    deltaPct: monthly?.deltaPct ?? null,
    updatedAt: monthly?.capturedAt ?? lifetime?.capturedAt ?? null,
    source: 'aws-cost-explorer',
  }
}

async function buildCostsRss(): Promise<string> {
  // 1) Fetch daily costs (últimos 365 dias ou menos se houver menos dados).
  const dailyOut = await ddb.send(new ScanCommand({
    TableName: COSTS_TABLE,
    FilterExpression: 'begins_with(pk, :p)',
    ExpressionAttributeValues: { ':p': 'COST#DAILY#' },
  }))
  const allDaily = ((dailyOut.Items ?? []) as CostDailyItem[])
    .filter(i => typeof i.date === 'string')
    .sort((a, b) => b.date.localeCompare(a.date)) // DESC — mais recente primeiro

  // 2) Fetch lifetime total
  const lifetimeOut = await ddb.send(new GetCommand({
    TableName: COSTS_TABLE,
    Key: { pk: 'COST#TOTAL#LIFETIME' },
  }))
  const lifetime = (lifetimeOut.Item as LifetimeTotalItem | undefined) ?? null

  // 3) Map mês → monthly snapshot para rápido acesso no loop.
  const monthlyByKey = new Map<string, CostMonthlyItem>()
  const monthlyOut = await ddb.send(new ScanCommand({
    TableName: COSTS_TABLE,
    FilterExpression: 'begins_with(pk, :p)',
    ExpressionAttributeValues: { ':p': 'COST#MONTHLY#' },
  }))
  for (const item of (monthlyOut.Items ?? []) as CostMonthlyItem[]) {
    monthlyByKey.set(item.month, item)
  }

  // 4) Gera entrada RSS por dia.
  // Cada entrada mostra: data, custo do dia, custo do mês corrente, total vitalício.
  const items = allDaily
    .map(daily => {
      const month = daily.date.slice(0, 7) // YYYY-MM
      const monthlySnap = monthlyByKey.get(month)
      const monthValueBrl = monthlySnap?.mtdBrl ?? 0
      const lifetimeValueBrl = lifetime?.totalBrl ?? 0

      const dateFmt = new Date(daily.date + 'T00:00:00Z').toLocaleDateString('pt-BR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      const title = `Custos FiscalDigital — ${dateFmt} | Mês: R$ ${monthValueBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | Total: R$ ${lifetimeValueBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      const description = `
Dia ${dateFmt}
Custo do dia: R$ ${daily.totalBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
Custo do mês (até hoje): R$ ${monthValueBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
Total vitalício (desde ${lifetime?.fromMonth ?? '2026-01'}): R$ ${lifetimeValueBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

Breakdown por serviço (dia):
${daily.byService.map(s => `  • ${s.service}: R$ ${s.brl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join('\n')}

Taxa PTAX utilizada: R$ 1 USD = R$ ${daily.ptaxBrl.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}`

      return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${SITE_URL}/transparencia/custos</link>
      <description>${escapeXml(description)}</description>
      <pubDate>${toRssDate(daily.capturedAt)}</pubDate>
      <guid isPermaLink="false">fiscal-digital-costs-${daily.date}</guid>
      <category>Custos</category>
    </item>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Fiscal Digital — Custos de Operação</title>
    <link>${SITE_URL}/transparencia/custos</link>
    <description>Transparência dos custos de operação do Fiscal Digital. Acompanhe nossos gastos mensais e investimento total no projeto.</description>
    <language>pt-BR</language>
    <lastBuildDate>${toRssDate()}</lastBuildDate>
    <ttl>600</ttl>
    <atom:link href="${escapeXml(`${API_URL}/transparencia/costs/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`
}

// ── Lambda handler ──────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const path = event.rawPath ?? '/'
  const qs = event.queryStringParameters ?? {}
  const method = event.requestContext?.http?.method?.toUpperCase() ?? 'GET'

  try {
    // Newsletter — POST /newsletter
    if (path === '/newsletter' || path === '/newsletter/') {
      if (method !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }), headers: { 'Content-Type': 'application/json' } }
      }
      return await handleNewsletter(event)
    }

    // Lazy PDF cache — GET /pdf?source=<qdUrl>
    if (path === '/pdf' || path === '/pdf/') {
      if (method !== 'GET') {
        return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }), headers: { 'Content-Type': 'application/json' } }
      }
      return await handlePdfProxy(event)
    }

    const filters = {
      cityId: qs.city,
      state: qs.state,
      type: qs.type,
    }

    if (path === '/rss' || path === '/rss/') {
      const findings = await fetchFindings(filters)
      const label = filters.state
        ? `Fiscal Digital — ${filters.state.toUpperCase()}`
        : filters.cityId
          ? `Fiscal Digital — ${getCityOrFallback(filters.cityId).name}`
          : 'Fiscal Digital — Alertas de Gastos Públicos'
      const selfUrl = `${API_URL}/rss${Object.keys(qs).length ? '?' + new URLSearchParams(qs as Record<string, string>).toString() : ''}`
      return ok(buildRss(findings, label, selfUrl), 'application/rss+xml; charset=UTF-8')
    }

    // GET /alerts/{slug} — single finding por id base64url-encoded.
    // Substitui o padrão antigo "fetch all + find" do site (que limitava a busca
    // aos primeiros N resultados). GetItem O(1) por pk; gate de publicação aplicado.
    if (path.startsWith('/alerts/') && path !== '/alerts/') {
      // path: /alerts/{slug} ou /alerts/{slug}/
      const slug = path.slice('/alerts/'.length).replace(/\/$/, '')
      if (!slug) {
        return { statusCode: 404, body: JSON.stringify({ error: 'missing_slug' }), headers: { 'Content-Type': 'application/json' } }
      }
      // Slug é base64url do `pk` (FINDING#fiscal#cityId#type#timestamp).
      // Decode com tolerância — fallback `--` → `#` se não for base64.
      let pk: string
      try {
        const padding = '=='.slice((slug.length + 2) % 4)
        const b64 = slug.replace(/-/g, '+').replace(/_/g, '/') + padding
        pk = Buffer.from(b64, 'base64').toString('utf-8')
      } catch {
        pk = slug.replace(/--/g, '#')
      }
      if (!pk.startsWith('FINDING#')) {
        return { statusCode: 404, body: JSON.stringify({ error: 'invalid_finding_slug' }), headers: { 'Content-Type': 'application/json' } }
      }
      const out = await ddb.send(new GetCommand({
        TableName: ALERTS_TABLE,
        Key: { pk },
      }))
      const f = out.Item as Finding | undefined
      // Gate de publicação via SSM (TEC-ENG-002) — não expor findings abaixo do threshold via URL pública.
      const { riskThreshold: rt, confidenceThreshold: ct } = await getPublishThresholds()
      if (!f || !f.type || (f.riskScore ?? 0) < rt || (f.confidence ?? 0) < ct) {
        return { statusCode: 404, body: JSON.stringify({ error: 'finding_not_found' }), headers: { 'Content-Type': 'application/json' } }
      }
      const source = f.evidence?.[0]?.source
      return ok(JSON.stringify({
        id: f.id,
        fiscalId: f.fiscalId,
        type: f.type,
        cityId: f.cityId,
        city: getCityOrFallback(f.cityId).name,
        state: getCityOrFallback(f.cityId).uf,
        riskScore: f.riskScore,
        confidence: f.confidence,
        value: f.value,
        cnpj: f.cnpj,
        contractNumber: f.contractNumber,
        secretaria: f.secretaria,
        legalBasis: f.legalBasis,
        narrative: f.narrative,
        source,
        cachedPdfUrl: pdfCacheUrl(source),
        evidence: f.evidence,
        createdAt: f.createdAt,
      }), 'application/json; charset=UTF-8', 60)
    }

    if (path === '/alerts' || path === '/alerts/') {
      const findings = await fetchFindings(filters)
      // pageInfo é GLOBAL (sobre o conjunto inteiro filtrado), itens são paginados.
      // Permite que o frontend mostre KPIs corretos ("X alertas em Y cidades")
      // mesmo quando a lista visível é só uma fatia.
      const pageSize = Math.min(parseInt(qs.size ?? '50', 10) || 50, 200)
      const page = Math.max(parseInt(qs.page ?? '1', 10) || 1, 1)
      const offset = (page - 1) * pageSize
      const visible = findings.slice(offset, offset + pageSize)
      const totalValue = findings.reduce((s, f) => s + (typeof f.value === 'number' ? f.value : 0), 0)
      const citiesCount = new Set(findings.map(f => f.cityId).filter(Boolean)).size
      const pageInfo = {
        total: findings.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(findings.length / pageSize)),
        totalValue,
        citiesCount,
      }
      return ok(JSON.stringify({
        total: findings.length,
        filters,
        pageInfo,
        items: visible.map(f => {
          const source = f.evidence?.[0]?.source
          return {
            id: f.id,
            fiscalId: f.fiscalId,
            type: f.type,
            cityId: f.cityId,
            city: getCityOrFallback(f.cityId).name,
            state: getCityOrFallback(f.cityId).uf,
            riskScore: f.riskScore,
            confidence: f.confidence,
            value: f.value,
            cnpj: f.cnpj,
            contractNumber: f.contractNumber,
            secretaria: f.secretaria,
            legalBasis: f.legalBasis,
            narrative: f.narrative,
            // `source` mantido como alias de evidence[0].source para backwards
            // compat com `fiscal-digital-web/lib/api.ts` atual.
            source,
            // CDN cache derivado do source — pode estar 404 se ainda não foi
            // cacheado. Site deve preferir pdfProxyUrl (que faz lazy cache).
            cachedPdfUrl: pdfCacheUrl(source),
            // Lazy cache on-demand — endpoint /pdf?source=... que sempre
            // funciona: cache hit → 302 CDN; cache miss → baixa do QD, sobe
            // para S3, 302 CDN; erro → 302 source QD direto. Site usa este
            // como src do iframe — primeira visita popula, próximas vão direto.
            pdfProxyUrl: source ? `${API_URL}/pdf?source=${encodeURIComponent(source)}` : null,
            evidence: f.evidence ?? [],
            published: f.published,
            publishedAt: f.publishedAt,
            createdAt: f.createdAt,
          }
        }),
      }, null, 2), 'application/json; charset=UTF-8')
    }

    if (path === '/stats' || path === '/stats/') {
      const [allFindings, gazettesCount, thresholds] = await Promise.all([
        scanAllFindings(),
        countGazettes(),
        getPublishThresholds(),
      ])
      // Aplicar gate de publicação (SSM TEC-ENG-002) para consistência com /alerts e /cities.
      // KPIs do site (Hero, StatsCounter) devem mostrar findings publicáveis,
      // não TODOS findings na tabela (que inclui rascunhos < gate).
      const findings = allFindings.filter(
        f => f.type && f.riskScore >= thresholds.riskThreshold && (f.confidence ?? 0) >= thresholds.confidenceThreshold,
      )
      const stats = buildStats(findings, gazettesCount)
      return ok(JSON.stringify(stats, null, 2), 'application/json; charset=UTF-8', 60)
    }

    if (path === '/cities' || path === '/cities/') {
      // WIN-API-002: 50 Queries paralelas em GSI1-city-date com projeção
      // mínima e gate na própria Query. Substitui scan completo da tabela
      // (3,5 MB → ~150 KB total). Mantém consistência com /alerts (mesmo
      // gate de publicação).
      const cities = await buildCitiesFromQueries()
      return ok(JSON.stringify(cities, null, 2), 'application/json; charset=UTF-8', 300)
    }

    // /transparencia/costs?days=30 — UH-OPS-001 (FiscalCustos)
    if (path === '/transparencia/costs' || path === '/transparencia/costs/') {
      const days = Math.min(Math.max(parseInt(qs.days ?? '30', 10) || 30, 1), 365)
      const { daily, monthly } = await fetchCostsHistory(days)
      const updatedAt = monthly?.capturedAt ?? daily.at(-1)?.capturedAt ?? null
      return ok(JSON.stringify({
        currency: 'BRL',
        days,
        updatedAt,
        monthly,
        daily: daily.map(d => ({
          date: d.date,
          totalBrl: d.totalBrl,
          totalUsd: d.totalUsd,
          byService: d.byService,
          ptaxBrl: d.ptaxBrl,
        })),
      }, null, 2), 'application/json; charset=UTF-8', 600)
    }

    // /transparencia/costs/mtd — UH-OPS-002 (HeroStats)
    // Endpoint focado para home — custo real operacional do mês, cache 1h.
    if (path === '/transparencia/costs/mtd' || path === '/transparencia/costs/mtd/') {
      const mtd = await fetchCostsMtd()
      if (!mtd) {
        return {
          statusCode: 503,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          body: JSON.stringify({ error: 'costs_not_yet_available' }),
        }
      }
      return ok(JSON.stringify(mtd, null, 2), 'application/json; charset=UTF-8', 3600)
    }

    // /transparencia/costs/feed.xml — RSS feed com valores mensais e total vitalício
    if (path === '/transparencia/costs/feed.xml' || path === '/transparencia/costs/feed.xml/') {
      const rss = await buildCostsRss()
      return ok(rss, 'application/rss+xml; charset=UTF-8', 600)
    }

    // /cities/{cityId}/stats — UH-API-001 (Sprint 6)
    const cityStatsMatch = path.match(/^\/cities\/(\d+)\/stats\/?$/)
    if (cityStatsMatch) {
      const cityId = cityStatsMatch[1]
      if (!CITIES[cityId]) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'city_not_found' }),
          headers: { 'Content-Type': 'application/json' },
        }
      }
      const stats = await buildCityStats(cityId)
      return ok(JSON.stringify(stats, null, 2), 'application/json; charset=UTF-8', 300)
    }

    if (path === '/' || path === '/health') {
      return ok(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        cities: Object.values(CITIES).filter(c => c.active).length,
        lastDeployedAt: BUILD_TIME,
        endpoints: [
          'GET /alerts',
          'GET /alerts/{slug}',
          'GET /cities',
          'GET /cities/{cityId}/stats',
          'GET /stats',
          'GET /rss',
          'GET /pdf?source=...',
          'GET /transparencia/costs?days=30',
          'GET /transparencia/costs/mtd',
          'GET /transparencia/costs/feed.xml',
          'POST /newsletter',
          'GET /health',
        ],
      }), 'application/json')
    }

    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }), headers: { 'Content-Type': 'application/json' } }
  } catch (err) {
    logger.error('unhandled error', { err })
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }), headers: { 'Content-Type': 'application/json' } }
  }
}
