// FiscalCustos — agente de transparência de custos da operação Fiscal Digital.
//
// Roda diariamente via EventBridge (06:00 UTC = 03:00 BRT, depois do collector).
// Persiste em fiscal-digital-costs-prod:
//   - COST#DAILY#{YYYY-MM-DD}   snapshot diário por serviço (USD + BRL)
//   - COST#MONTHLY#{YYYY-MM}    rollup do mês corrente (mtd + projeção)
//   - COST#FX#{YYYY-MM-DD}      PTAX BCB usado naquele dia (auditável)
//
// USD→BRL: PTAX BCB SGS série 1 (cotação de venda). Última disponível ≤ data alvo.
// Filosofia: "transparência de gastos públicos → também transparência dos nossos."

import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb'
import { createLogger, requireEnv } from '@fiscal-digital/engine'

const logger = createLogger('costs')

// Cost Explorer SOMENTE em us-east-1 (region-less na cobrança, mas endpoint fixo).
const ce = new CostExplorerClient({ region: 'us-east-1' })
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' }),
)

const COSTS_TABLE = requireEnv('COSTS_TABLE')

// Janela de coleta: últimos 7 dias (idempotente — overwrite). Cobre eventual
// atraso de finalização do CE (data parcial até ~24h após o fim do dia).
const COLLECTION_WINDOW_DAYS = 7

// ---------------------------------------------------------------------------
// PTAX BCB — USD/BRL (SGS série 1)
// ---------------------------------------------------------------------------

interface BcbSgsRow {
  data: string // "DD/MM/YYYY"
  valor: string // "4.9878"
}

// Busca PTAX (cotação de venda do dólar comercial) — SGS série 1.
// Endpoint Olinda OData mudou a estrutura algumas vezes; SGS é mais estável.
// BCB devolve apenas dias úteis — cotação mais recente dentro da janela.
async function fetchPtaxFor(_dateIso: string): Promise<number> {
  const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/5?formato=json'
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`BCB SGS HTTP ${res.status}`)
  const rows = (await res.json()) as BcbSgsRow[]
  const last = rows.at(-1)
  if (!last) throw new Error('BCB sem dados PTAX')
  const value = Number.parseFloat(last.valor)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`BCB PTAX inválido: ${last.valor}`)
  return value
}

// ---------------------------------------------------------------------------
// Cost Explorer
// ---------------------------------------------------------------------------

interface DailyServiceCost {
  service: string
  usd: number
}

interface DailyCostBucket {
  date: string // YYYY-MM-DD
  byService: DailyServiceCost[]
  totalUsd: number
}

async function fetchDailyCosts(startIso: string, endIso: string): Promise<DailyCostBucket[]> {
  const out = await ce.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: startIso, End: endIso },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    }),
  )
  const buckets: DailyCostBucket[] = []
  for (const period of out.ResultsByTime ?? []) {
    const date = period.TimePeriod?.Start ?? ''
    const byService: DailyServiceCost[] = []
    let totalUsd = 0
    for (const g of period.Groups ?? []) {
      const service = g.Keys?.[0] ?? 'Unknown'
      const usd = Number.parseFloat(g.Metrics?.UnblendedCost?.Amount ?? '0')
      if (Number.isFinite(usd) && usd > 0) {
        byService.push({ service, usd })
        totalUsd += usd
      }
    }
    byService.sort((a, b) => b.usd - a.usd)
    buckets.push({ date, byService, totalUsd })
  }
  return buckets
}

async function fetchMonthlyTotal(startIso: string, endIso: string): Promise<number> {
  const out = await ce.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: startIso, End: endIso },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
    }),
  )
  const total = out.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount
  return total ? Number.parseFloat(total) : 0
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function firstDayOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}

function round(n: number, places = 4): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

interface DailySnapshot {
  pk: string
  date: string
  totalUsd: number
  totalBrl: number
  byService: Array<{ service: string; usd: number; brl: number }>
  ptaxBrl: number
  capturedAt: string
}

interface MonthlySnapshot {
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

interface LifetimeTotalSnapshot {
  pk: string
  totalUsd: number
  totalBrl: number
  ptaxBrl: number
  fromMonth: string
  toMonth: string
  capturedAt: string
}

async function persistDaily(bucket: DailyCostBucket, ptaxBrl: number): Promise<DailySnapshot> {
  const totalBrl = round(bucket.totalUsd * ptaxBrl, 4)
  const item: DailySnapshot = {
    pk: `COST#DAILY#${bucket.date}`,
    date: bucket.date,
    totalUsd: round(bucket.totalUsd, 6),
    totalBrl,
    byService: bucket.byService.map(s => ({
      service: s.service,
      usd: round(s.usd, 6),
      brl: round(s.usd * ptaxBrl, 4),
    })),
    ptaxBrl: round(ptaxBrl, 4),
    capturedAt: new Date().toISOString(),
  }
  await ddb.send(new PutCommand({ TableName: COSTS_TABLE, Item: item }))
  return item
}

async function persistFx(date: string, ptaxBrl: number): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: COSTS_TABLE,
      Item: {
        pk: `COST#FX#${date}`,
        date,
        ptaxBrl: round(ptaxBrl, 4),
        source: 'BCB-PTAX',
        capturedAt: new Date().toISOString(),
      },
    }),
  )
}

async function loadPrevMonthBrl(prevMonthKey: string): Promise<number | null> {
  const out = await ddb.send(
    new GetCommand({ TableName: COSTS_TABLE, Key: { pk: `COST#MONTHLY#${prevMonthKey}` } }),
  )
  const item = out.Item as { mtdBrl?: number } | undefined
  return item?.mtdBrl ?? null
}

async function persistMonthly(
  monthKey: string,
  mtdUsd: number,
  ptaxBrl: number,
  byService: Map<string, number>,
  prevMonthBrl: number | null,
  daysElapsed: number,
  totalDaysMonth: number,
): Promise<MonthlySnapshot> {
  const mtdBrl = round(mtdUsd * ptaxBrl, 4)
  // Projeção linear: mtd / dias decorridos × dias do mês.
  const projectedUsd = daysElapsed > 0 ? (mtdUsd / daysElapsed) * totalDaysMonth : mtdUsd
  const projectedBrl = round(projectedUsd * ptaxBrl, 4)
  const deltaPct =
    prevMonthBrl && prevMonthBrl > 0 ? round(((mtdBrl - prevMonthBrl) / prevMonthBrl) * 100, 2) : null

  const services = Array.from(byService.entries())
    .map(([service, usd]) => ({
      service,
      usd: round(usd, 6),
      brl: round(usd * ptaxBrl, 4),
    }))
    .sort((a, b) => b.usd - a.usd)

  const item: MonthlySnapshot = {
    pk: `COST#MONTHLY#${monthKey}`,
    month: monthKey,
    mtdUsd: round(mtdUsd, 6),
    mtdBrl,
    projectedUsd: round(projectedUsd, 6),
    projectedBrl,
    prevMonthBrl,
    deltaPct,
    byService: services,
    ptaxBrl: round(ptaxBrl, 4),
    capturedAt: new Date().toISOString(),
  }
  await ddb.send(new PutCommand({ TableName: COSTS_TABLE, Item: item }))
  return item
}

// Calcula custos acumulados de domínio (GoDaddy fiscaldigital.org).
// Comprado em 27/04/2026: R$ 64,99 (primeiro ano)
// Renovação anual 27/04: +R$ 129,99
function calculateDomainCostBrl(upToDate: Date): number {
  const DOMAIN_PURCHASE_DATE = new Date(Date.UTC(2026, 3, 27)) // 27/04/2026
  const FIRST_YEAR_COST = 64.99
  const RENEWAL_COST = 129.99

  if (upToDate < DOMAIN_PURCHASE_DATE) return 0

  let total = FIRST_YEAR_COST
  let nextRenewal = new Date(Date.UTC(2027, 3, 27)) // 27/04/2027

  while (nextRenewal <= upToDate) {
    total += RENEWAL_COST
    nextRenewal = new Date(nextRenewal.getUTCFullYear() + 1, nextRenewal.getUTCMonth(), nextRenewal.getUTCDate())
  }

  return round(total, 2)
}

// Calcula e persiste total vitalício (lifetime).
// Idempotente — atualiza o snapshot a cada execução diária.
async function persistLifetimeTotal(ptaxBrl: number): Promise<LifetimeTotalSnapshot> {
  // Período: sempre a contar de 2026-01-01 (bootstrap do projeto) até hoje.
  // CE retorna data agregada até o último dia completo.
  const from = '2026-01-01'
  const now = new Date()
  const to = isoDate(addDays(now, 1)) // CE end é exclusivo
  const lifetimeUsd = await fetchMonthlyTotal(from, to)
  const awsCostsBrl = round(lifetimeUsd * ptaxBrl, 4)

  // Somar custos externos (domínio).
  const domainCostBrl = calculateDomainCostBrl(now)
  const lifetimeBrl = round(awsCostsBrl + domainCostBrl, 2)

  const now_iso = new Date().toISOString()
  const now_month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const item: LifetimeTotalSnapshot = {
    pk: 'COST#TOTAL#LIFETIME',
    totalUsd: round(lifetimeUsd, 6),
    totalBrl: lifetimeBrl,
    ptaxBrl: round(ptaxBrl, 4),
    fromMonth: '2026-01',
    toMonth: now_month,
    capturedAt: now_iso,
  }
  await ddb.send(new PutCommand({ TableName: COSTS_TABLE, Item: item }))
  return item
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  const now = new Date()
  // CE devolve dado de "ontem" só após ~24h. Usamos janela [today-7, today].
  const windowEnd = isoDate(now)
  const windowStart = isoDate(addDays(now, -COLLECTION_WINDOW_DAYS))

  logger.info('FiscalCustos start', { windowStart, windowEnd })

  // 1) PTAX para hoje (cobre conversão da janela inteira; PTAX intra-semana
  //    varia ~0.5% — diferença irrelevante para o painel).
  const ptaxBrl = await fetchPtaxFor(windowEnd)
  logger.info('PTAX fetched', { ptaxBrl })

  // 2) Daily buckets (últimos 7 dias)
  const buckets = await fetchDailyCosts(windowStart, windowEnd)
  logger.info('CE daily fetched', { days: buckets.length })

  // 3) Persiste cada dia + FX do dia
  for (const b of buckets) {
    if (b.totalUsd === 0 && b.byService.length === 0) continue
    await persistDaily(b, ptaxBrl)
  }
  await persistFx(windowEnd, ptaxBrl)

  // 4) Monthly rollup do mês corrente
  const monthStart = firstDayOfMonth(now)
  const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`
  const mtdEnd = isoDate(addDays(now, 1)) // CE end é exclusivo
  const mtdUsd = await fetchMonthlyTotal(isoDate(monthStart), mtdEnd)

  // Agrega serviços do mês a partir dos buckets diários do mês corrente.
  // Para o primeiro dia do mês, buckets pode não cobrir tudo — esse é um
  // trade-off aceito (precisão crítica é mtdUsd, não breakdown).
  const monthlyByService = new Map<string, number>()
  for (const b of buckets) {
    if (!b.date.startsWith(monthKey)) continue
    for (const s of b.byService) {
      monthlyByService.set(s.service, (monthlyByService.get(s.service) ?? 0) + s.usd)
    }
  }

  // Mês anterior (para comparativo)
  const prev = new Date(monthStart)
  prev.setUTCMonth(prev.getUTCMonth() - 1)
  const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`
  const prevMonthBrl = await loadPrevMonthBrl(prevKey)

  const daysElapsed = now.getUTCDate()
  const totalDaysMonth = daysInMonth(now)

  const monthly = await persistMonthly(
    monthKey,
    mtdUsd,
    ptaxBrl,
    monthlyByService,
    prevMonthBrl,
    daysElapsed,
    totalDaysMonth,
  )

  // 5) Lifetime total — backfill para RSS /transparencia/costs/feed.xml
  const lifetime = await persistLifetimeTotal(ptaxBrl)

  logger.info('FiscalCustos done', {
    monthKey,
    mtdUsd: monthly.mtdUsd,
    mtdBrl: monthly.mtdBrl,
    projectedBrl: monthly.projectedBrl,
    deltaPct: monthly.deltaPct,
    lifetimeTotalBrl: lifetime.totalBrl,
  })

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      windowStart,
      windowEnd,
      monthKey,
      mtdBrl: monthly.mtdBrl,
      projectedBrl: monthly.projectedBrl,
      lifetimeTotalBrl: lifetime.totalBrl,
    }),
  }
}
