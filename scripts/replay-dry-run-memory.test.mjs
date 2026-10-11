// Testes da memória em RAM do dry-run do replay-fiscal (node:test — roda no plan.yml).
//
// O que está sendo protegido: o dry-run não escreve no DynamoDB, mas o
// fracionamento continua vendo as dispensas das gazettes anteriores do run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDryRunMemory } from './replay-dry-run-memory.mjs'

const CNPJ = '89.982.037/0001-76'

test('saveMemory grava só em RAM', async () => {
  const mem = createDryRunMemory()
  const r = await mem.saveMemory.execute({ pk: 'DISPENSA#a', item: { cnpj: CNPJ, createdAt: '2026-01-01T00:00:00Z' } })
  assert.equal(mem.size(), 1)
  assert.equal(r.confidence, 1.0)
})

test('withMemory devolve o que foi gravado no run junto com o remoto', async () => {
  const mem = createDryRunMemory()
  await mem.saveMemory.execute({ pk: 'DISPENSA#local', item: { cnpj: CNPJ, createdAt: '2026-03-01T00:00:00Z', valor: 40000 } })
  const query = mem.withMemory(async () => [{ pk: 'DISPENSA#remoto', cnpj: CNPJ, createdAt: '2026-02-01T00:00:00Z' }])

  const pks = (await query(CNPJ, '2025-03-01T00:00:00Z')).map(i => i.pk).sort()
  assert.deepEqual(pks, ['DISPENSA#local', 'DISPENSA#remoto'])
})

test('withMemory respeita cnpj e janela, como a GSI2-cnpj-date', async () => {
  const mem = createDryRunMemory()
  await mem.saveMemory.execute({ pk: 'DISPENSA#outro', item: { cnpj: '11.111.111/0001-11', createdAt: '2026-03-01T00:00:00Z' } })
  await mem.saveMemory.execute({ pk: 'DISPENSA#antiga', item: { cnpj: CNPJ, createdAt: '2024-01-01T00:00:00Z' } })
  await mem.saveMemory.execute({ pk: 'DISPENSA#semdata', item: { cnpj: CNPJ } })
  const query = mem.withMemory(async () => [])

  assert.deepEqual(await query(CNPJ, '2025-03-01T00:00:00Z'), [])
})

test('item em RAM substitui o remoto de mesmo pk, como o PutItem faria', async () => {
  const mem = createDryRunMemory()
  await mem.saveMemory.execute({ pk: 'DISPENSA#x', item: { cnpj: CNPJ, createdAt: '2026-03-01T00:00:00Z', valor: 2 } })
  const query = mem.withMemory(async () => [{ pk: 'DISPENSA#x', cnpj: CNPJ, createdAt: '2026-03-01T00:00:00Z', valor: 1 }])

  const r = await query(CNPJ, '2025-03-01T00:00:00Z')
  assert.equal(r.length, 1)
  assert.equal(r[0].valor, 2)
})
