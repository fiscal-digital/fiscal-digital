#!/usr/bin/env node
/**
 * Testa cobertura do Querido Diário por cidade — com e sem keyword filter
 */

const QD = 'https://api.queridodiario.ok.org.br'
const UA = 'fiscal-digital/0.1 (audit; +https://fiscaldigital.org)'

async function totalFor(territoryId, opts = {}) {
  const params = new URLSearchParams({
    territory_ids: territoryId,
    size: '1',
    published_since: '2021-01-01',
    published_until: '2026-12-31',
  })
  if (opts.keywords) params.set('querystring', opts.keywords.join(' OR '))
  const url = `${QD}/gazettes?${params}`
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const body = await r.json()
    return { total: body.total_gazettes, sample: body.gazettes?.[0]?.date }
  } catch (e) {
    return { error: e.message }
  }
}

const KEYWORDS = ['dispensa de licitação', 'inexigibilidade', 'contratação direta', 'aditivo', 'prorrogação', 'nomeação', 'exoneração', 'licitação', 'pregão', 'tomada de preços']

const cities = [
  { id: '3550308', name: 'São Paulo' },
  { id: '4106902', name: 'Curitiba' },
  { id: '4314902', name: 'Porto Alegre' },
  { id: '4305108', name: 'Caxias do Sul' },
  { id: '3304557', name: 'Rio de Janeiro' },
  { id: '5300108', name: 'Brasília' },
  { id: '3106200', name: 'Belo Horizonte' },
  { id: '2304400', name: 'Fortaleza' },
]

console.log(`${'Cidade'.padEnd(20)} ${'Sem filtro'.padStart(12)} ${'Com keywords'.padStart(14)}  Sample date`)
console.log('─'.repeat(75))
for (const c of cities) {
  const allG = await totalFor(c.id)
  const filtG = await totalFor(c.id, { keywords: KEYWORDS })
  const samp = allG.sample ?? '—'
  console.log(`${c.name.padEnd(20)} ${String(allG.total ?? allG.error).padStart(12)} ${String(filtG.total ?? filtG.error).padStart(14)}  ${samp}`)
  await new Promise(r => setTimeout(r, 500))
}
