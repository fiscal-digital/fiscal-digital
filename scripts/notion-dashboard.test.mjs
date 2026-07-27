// Testes do modelo puro do dashboard (node:test — roda no workflow antes do run).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, modelToBlocks } from './notion-dashboard.mjs'

const issue = (n, title, state, labels, repo = 'fiscal-digital/fiscal-digital') => ({
  number: n, title, state, url: `https://github.com/${repo}/issues/${n}`,
  labels: labels.map((name) => ({ name })), repo,
})

const FIX = {
  issues: [
    issue(144, 'P0: /cities responde sem-dados', 'OPEN', ['ciclo-confiabilidade', 'frente-observabilidade']),
    issue(139, 'P0: matcher por numeral', 'OPEN', ['ciclo-confiabilidade', 'frente-juridica']),
    issue(140, 'Replay fiscal-pessoal', 'OPEN', ['ciclo-confiabilidade', 'frente-juridica']),
    issue(150, 'Automação: dashboard', 'OPEN', ['ciclo-confiabilidade']),
    issue(133, 'Corpus fechado', 'CLOSED', ['ciclo-confiabilidade', 'frente-juridica']),
  ],
  prs: [{ number: 155, title: 'feat(iam): roles', url: 'https://x', isDraft: false, repo: 'fiscal-digital/fiscal-digital' }],
}

test('buildModel: contagens, P0 por título, frentes e sem-frente', () => {
  const m = buildModel(FIX, '2026-07-27 12:00 UTC')
  assert.equal(m.total, 5)
  assert.equal(m.abertas, 4)
  assert.equal(m.fechadas, 1)
  assert.deepEqual(m.p0s.map((i) => i.number).sort(), [139, 144])
  const juridica = m.porFrente.find((f) => f.titulo === 'Frente jurídica')
  assert.deepEqual(juridica.itens.map((i) => i.number).sort(), [139, 140]) // fechada fica fora
  assert.deepEqual(m.semFrente.map((i) => i.number), [150])
})

test('modelToBlocks: aviso de página gerada, seções e links', () => {
  const blocks = modelToBlocks(buildModel(FIX, '2026-07-27 12:00 UTC'))
  const json = JSON.stringify(blocks)
  assert.match(json, /gerada automaticamente/)
  assert.match(json, /P0 abertos \(2\)/)
  assert.match(json, /Frente jurídica \(2\)/)
  assert.match(json, /PRs abertos \(1\)/)
  assert.match(json, /issues\/144/) // link presente
  // frente vazia mostra placeholder em vez de sumir
  assert.match(json, /nada aberto/)
})

test('modelToBlocks: nunca excede 2000 chars por rich_text (limite Notion)', () => {
  const longa = issue(9, 'x'.repeat(5000), 'OPEN', ['ciclo-confiabilidade'])
  const blocks = modelToBlocks(buildModel({ issues: [longa], prs: [] }, 'now'))
  for (const b of blocks) {
    const rts = JSON.stringify(b).match(/"content":"(?:[^"\\]|\\.)*"/g) ?? []
    for (const r of rts) assert.ok(r.length < 2100, 'rich_text estourou o limite')
  }
})
