import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { CITIES, getCityOrFallback } from '@fiscal-digital/engine'
import type { Finding } from '@fiscal-digital/engine'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }))
const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'
const GAZETTES_TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
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

  return (Items as Finding[])
    .filter(f => f.type && f.riskScore >= 60)
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
    console.error('[api] gazettes scan failed (degraded /stats)', err)
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

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    dispensa_irregular: 'DISPENSA IRREGULAR',
    fracionamento: 'FRACIONAMENTO',
    aditivo_abusivo: 'ADITIVO ABUSIVO',
    prorrogacao_excessiva: 'PRORROGAÇÃO EXCESSIVA',
    cnpj_jovem: 'CNPJ JOVEM',
    concentracao_fornecedor: 'CONCENTRAÇÃO FORNECEDOR',
    pico_nomeacoes: 'PICO NOMEAÇÕES',
    rotatividade_anormal: 'ROTATIVIDADE ANORMAL',
    padrao_recorrente: 'PADRÃO RECORRENTE',
  }
  return labels[type] ?? type.toUpperCase()
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

// ── Lambda handler ──────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const path = event.rawPath ?? '/'
  const qs = event.queryStringParameters ?? {}

  try {
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
        items: findings.map(f => ({
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
          source: f.evidence?.[0]?.source,
          evidence: f.evidence ?? [],
          published: f.published,
          publishedAt: f.publishedAt,
          createdAt: f.createdAt,
        })),
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
    console.error('[api] error', err)
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }), headers: { 'Content-Type': 'application/json' } }
  }
}
