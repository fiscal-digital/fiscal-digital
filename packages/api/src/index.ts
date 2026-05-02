import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { CITIES, getCityOrFallback } from '@fiscal-digital/engine'
import type { Finding } from '@fiscal-digital/engine'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }))
const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'
const SITE_URL = 'https://fiscaldigital.org'
const API_URL = process.env.API_URL ?? 'https://api.fiscaldigital.org'

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

function ok(body: string, contentType: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
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
          type: f.type,
          cityId: f.cityId,
          city: getCityOrFallback(f.cityId).name,
          state: getCityOrFallback(f.cityId).uf,
          riskScore: f.riskScore,
          confidence: f.confidence,
          value: f.value,
          secretaria: f.secretaria,
          legalBasis: f.legalBasis,
          narrative: f.narrative,
          source: f.evidence?.[0]?.source,
          createdAt: f.createdAt,
        })),
      }, null, 2), 'application/json; charset=UTF-8')
    }

    if (path === '/' || path === '/health') {
      return ok(JSON.stringify({ status: 'ok', version: '1.0.0', cities: Object.values(CITIES).filter(c => c.active).length }), 'application/json')
    }

    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }), headers: { 'Content-Type': 'application/json' } }
  } catch (err) {
    console.error('[api] error', err)
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }), headers: { 'Content-Type': 'application/json' } }
  }
}
