#!/usr/bin/env node
// notion-dashboard.mjs — gera o dashboard do Ciclo de Confiabilidade no Notion
// a partir do GitHub (issue #150). GitHub é a fonte de verdade; esta página é
// WRITE-ONLY: o script nunca lê estado do Notion para decidir nada.
//
// Fluxo: gh api (issues das 3 frentes + PRs + milestone) → modelo → blocos
// Notion → apaga blocos antigos da página → append dos novos.
//
// Env obrigatório: NOTION_TOKEN (integration com acesso só à página),
//                  NOTION_DASHBOARD_PAGE_ID, GH_TOKEN (para o gh CLI).
// Custo: zero AWS. Uso local: node scripts/notion-dashboard.mjs --dry-run

import { execFileSync } from 'node:child_process'

const REPOS = [
  'fiscal-digital/fiscal-digital',
  'fiscal-digital/fiscal-digital-collectors',
  'fiscal-digital/fiscal-digital-evaluations',
]
const LABEL = 'ciclo-confiabilidade'
const FRENTES = [
  ['frente-juridica', 'Frente jurídica'],
  ['frente-dados', 'Frente dados/coleta'],
  ['frente-observabilidade', 'Frente observabilidade'],
  ['frente-transparencia', 'Frente transparência'],
]
const NOTION_VERSION = '2022-06-28'

// ── Coleta (GitHub) ──────────────────────────────────────────────────────────

function gh(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
}

export function fetchGithubState() {
  const issues = REPOS.flatMap((repo) =>
    gh(['issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'all',
      '--json', 'number,title,state,labels,url', '--limit', '200'])
      .map((i) => ({ ...i, repo })))
  const prs = REPOS.flatMap((repo) =>
    gh(['pr', 'list', '--repo', repo, '--state', 'open',
      '--json', 'number,title,url,isDraft', '--limit', '50'])
      .map((p) => ({ ...p, repo })))
  return { issues, prs }
}

// ── Modelo (puro, testado) ───────────────────────────────────────────────────

export function buildModel({ issues, prs }, nowISO) {
  const abertas = issues.filter((i) => i.state === 'OPEN')
  const hasLabel = (i, name) => i.labels.some((l) => l.name === name)

  const p0s = abertas.filter((i) => /\bP0\b/i.test(i.title))
  const porFrente = FRENTES.map(([label, titulo]) => ({
    titulo,
    itens: abertas.filter((i) => hasLabel(i, label)),
  }))
  const semFrente = abertas.filter((i) => !FRENTES.some(([l]) => hasLabel(i, l)))

  return {
    geradoEm: nowISO,
    total: issues.length,
    abertas: abertas.length,
    fechadas: issues.length - abertas.length,
    p0s,
    porFrente,
    semFrente,
    prs,
  }
}

const rt = (text, link) => ({
  type: 'text',
  text: { content: text.slice(0, 1990), ...(link ? { link: { url: link } } : {}) },
})
const h2 = (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [rt(t)] } })
const para = (parts) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: parts } })
const bullet = (parts) => ({
  object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parts },
})
const issueLine = (i) => bullet([
  rt(`${i.repo.split('/')[1]}#${i.number} `, i.url),
  rt(i.title),
])

export function modelToBlocks(m) {
  const blocks = [
    para([rt('⚠️ Página gerada automaticamente (workflow notion-dashboard.yml) — não editar. '),
      rt('Fonte de verdade: rastreio #153', 'https://github.com/fiscal-digital/fiscal-digital/issues/153')]),
    para([rt(`Gerado em ${m.geradoEm} · ${m.abertas} abertas / ${m.fechadas} fechadas de ${m.total} no ciclo`)]),
  ]
  if (m.p0s.length) {
    blocks.push(h2(`🔴 P0 abertos (${m.p0s.length})`), ...m.p0s.map(issueLine))
  }
  for (const f of m.porFrente) {
    blocks.push(h2(`${f.titulo} (${f.itens.length})`))
    blocks.push(...(f.itens.length ? f.itens.map(issueLine) : [para([rt('— nada aberto')])]))
  }
  if (m.semFrente.length) blocks.push(h2(`Meta/automação (${m.semFrente.length})`), ...m.semFrente.map(issueLine))
  blocks.push(h2(`PRs abertos (${m.prs.length})`))
  blocks.push(...(m.prs.length
    ? m.prs.map((p) => bullet([rt(`${p.repo.split('/')[1]}#${p.number}${p.isDraft ? ' (draft)' : ''} `, p.url), rt(p.title)]))
    : [para([rt('— nenhum')])]))
  return blocks
}

// ── Notion (write-only) ──────────────────────────────────────────────────────

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`Notion ${method} ${path}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function replacePageBlocks(pageId, blocks) {
  // apaga os blocos atuais…
  let cursor
  const old = []
  do {
    const r = await notion('GET', `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
    old.push(...r.results.map((b) => b.id))
    cursor = r.has_more ? r.next_cursor : null
  } while (cursor)
  for (const id of old) await notion('DELETE', `/blocks/${id}`)
  // …e escreve os novos em lotes de 100 (limite da API)
  for (let i = 0; i < blocks.length; i += 100) {
    await notion('PATCH', `/blocks/${pageId}/children`, { children: blocks.slice(i, i + 100) })
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const state = fetchGithubState()
  const model = buildModel(state, new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC')
  const blocks = modelToBlocks(model)
  console.log(`[dashboard] ${model.abertas} abertas · ${model.p0s.length} P0 · ${model.prs.length} PRs · ${blocks.length} blocos`)
  if (dryRun) {
    console.log(JSON.stringify(model, null, 1).slice(0, 3000))
    return
  }
  const pageId = process.env.NOTION_DASHBOARD_PAGE_ID
  if (!process.env.NOTION_TOKEN || !pageId) throw new Error('NOTION_TOKEN e NOTION_DASHBOARD_PAGE_ID são obrigatórios')
  await replacePageBlocks(pageId, blocks)
  console.log('[dashboard] página atualizada')
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  main().catch((err) => { console.error(err.stack || err.message); process.exit(1) })
}
