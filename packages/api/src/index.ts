import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import crypto from 'node:crypto'
import { CITIES, getCityOrFallback, pdfCacheUrl, pdfCacheS3Key, createLogger } from '@fiscal-digital/engine'
import type { Finding } from '@fiscal-digital/engine'

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const GAZETTES_CACHE_BUCKET = process.env.GAZETTES_CACHE_BUCKET ?? 'fiscal-digital-gazettes-cache-prod'

const logger = createLogger('api')

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }))
const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'
const GAZETTES_TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const NEWSLETTER_TABLE = process.env.NEWSLETTER_TABLE ?? 'fiscal-digital-newsletter-prod'
const SITE_URL = 'https://fiscaldigital.org'
const API_URL = process.env.API_URL ?? 'https://api.fiscaldigital.org'
// Build timestamp injetado no bundle pelo deploy. Fallback = boot da Lambda.
const BUILD_TIME = process.env.BUILD_TIME ?? new Date().toISOString()

// ── Bedrock cost constants ──────────────────────────────────────────────────
//
// Custos médios por chamada validados no LRN-20260502-009 (eval Bedrock).
// Nova Lite ≈ $0.047 / 1k gazettes (extração) → $0.000047 / call
// Haiku 4.5 ≈ $0.77  / 1k narrativas (riskScore >= 60) → $0.00077 / call
const COST_NOVA_LITE_PER_CALL = 0.000047
const COST_HAIKU_PER_CALL = 0.00077

// ── Fetch findings from DynamoDB ────────────────────────────────────────────

async function fetchFindings(filters: {
  cityId?: string
  state?: string
  type?: string
  limit?: number
}): Promise<Finding[]> {
  const cityIds = filters.state
    ? Object.values(CITIES).filter(c => c.uf === (filters.state ?? '').toUpperCase()).map(c => c.cityId)
    : filters.cityId ? [filters.cityId] : null

  const { Items = [] } = await ddb.send(new ScanCommand({
    TableName: ALERTS_TABLE,
    FilterExpression: cityIds
      ? 'begins_with(pk, :prefix) AND cityId IN (' + cityIds.map((_, i) => `:cid${i}`).join(', ') + ')'
      : filters.type
        ? 'begins_with(pk, :prefix) AND #type = :type'
        : 'begins_with(pk, :prefix)',
    ExpressionAttributeNames: filters.type && !cityIds ? { '#type': 'type' } : undefined,
    ExpressionAttributeValues: {
      ':prefix': 'FINDING#',
      ...(cityIds && Object.fromEntries(cityIds.map((id, i) => [`:cid${i}`, id]))),
      ...(filters.type && !cityIds ? { ':type': filters.type } : {}),
    },
    Limit: filters.limit ?? 200,
  }))

  // Gate de publicação: CLAUDE.md exige riskScore >= 60 E confidence >= 0.70.
  // Findings que ficam abaixo desses thresholds não vão para feed/home/RSS —
  // ficam apenas na tabela alerts-prod para auditoria interna. Fiscais novos
  // (locacao, convenios) foram calibrados com confidence 0.65; sobem para 0.70+
  // depois de mais validação manual.
  return (Items as Finding[])
    .filter(f => f.type && f.riskScore >= 60 && (f.confidence ?? 0) >= 0.70)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 50)
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
  return all
}

// Scan COUNT em gazettes-prod — apenas Count, sem trazer items (econômico).
// Se a Lambda não tiver permissão, retorna null e /stats degrada graciosamente.
async function countGazettes(): Promise<number | null> {
  try {
    let count = 0
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const out: { Count?: number; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new ScanCommand({
        TableName: GAZETTES_TABLE,
        Select: 'COUNT',
        FilterExpression: 'begins_with(pk, :prefix)',
        ExpressionAttributeValues: { ':prefix': 'GAZETTE#' },
        ExclusiveStartKey: exclusiveStartKey,
      }))
      count += out.Count ?? 0
      exclusiveStartKey = out.LastEvaluatedKey
    } while (exclusiveStartKey)
    return count
  } catch (err) {
    logger.error('gazettes scan failed (degraded /stats)', { err })
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
  estimatedCostUsd: number
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
  const estimatedCostUsd = Number(
    (totalGazettes * COST_NOVA_LITE_PER_CALL + totalFindings * COST_HAIKU_PER_CALL).toFixed(4)
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
    estimatedCostUsd,
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
  locale?: 'pt' | 'en'
  source?: string
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
  const locale = body.locale === 'en' ? 'en' : 'pt'
  const source = (body.source ?? 'home').slice(0, 64)
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

    if (path === '/alerts' || path === '/alerts/') {
      const findings = await fetchFindings(filters)
      return ok(JSON.stringify({
        total: findings.length,
        filters,
        items: findings.map(f => {
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
      const [findings, gazettesCount] = await Promise.all([
        scanAllFindings(),
        countGazettes(),
      ])
      const stats = buildStats(findings, gazettesCount)
      return ok(JSON.stringify(stats, null, 2), 'application/json; charset=UTF-8', 60)
    }

    if (path === '/cities' || path === '/cities/') {
      const findings = await scanAllFindings()
      const cities = buildCities(findings)
      return ok(JSON.stringify(cities, null, 2), 'application/json; charset=UTF-8', 300)
    }

    if (path === '/' || path === '/health') {
      return ok(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        cities: Object.values(CITIES).filter(c => c.active).length,
        lastDeployedAt: BUILD_TIME,
      }), 'application/json')
    }

    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }), headers: { 'Content-Type': 'application/json' } }
  } catch (err) {
    logger.error('unhandled error', { err })
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }), headers: { 'Content-Type': 'application/json' } }
  }
}
