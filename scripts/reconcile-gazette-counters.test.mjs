// Testes do modelo puro do reconciliador (node:test — roda no plan.yml).
//
// O que está sendo protegido: a agregação precisa contar EXATAMENTE o mesmo
// universo que o Scan `begins_with(pk, 'GAZETTE#{cityId}#')` contava na API.
// Se as duas derivações divergirem, o counter serve um número diferente do
// fallback e ninguém percebe — o endpoint responde rápido e errado.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cityIdFromPk, gazetteDate, aggregate } from './reconcile-gazette-counters.mjs'

test('cityIdFromPk extrai o territory_id de pks do Querido Diário', () => {
  assert.equal(cityIdFromPk('GAZETTE#4305108#2026-03-15#a1b2c3'), '4305108')
  assert.equal(cityIdFromPk('GAZETTE#3550308#2021-01-04#deadbeef'), '3550308')
})

test('cityIdFromPk ignora o que não é gazette de cidade', () => {
  // URLHASH: fonte não-QD, não pertence a cidade nenhuma.
  assert.equal(cityIdFromPk('GAZETTE#URLHASH#0123456789abcdef'), null)
  // Os próprios agregados vivem na mesma tabela — não podem se auto-contar.
  assert.equal(cityIdFromPk('AGG#GAZETTE_COUNT'), null)
  assert.equal(cityIdFromPk('AGG#GAZETTE_COUNT#4305108'), null)
  // Watermarks do collector também.
  assert.equal(cityIdFromPk('BACKFILL#4305108'), null)
  assert.equal(cityIdFromPk(undefined), null)
})

test('gazetteDate prefere o atributo e cai para o pk', () => {
  assert.equal(gazetteDate({ pk: 'GAZETTE#4305108#2026-03-15#x', date: '2026-03-15' }), '2026-03-15')
  // Sem atributo `date` — extrai do pk (itens antigos).
  assert.equal(gazetteDate({ pk: 'GAZETTE#4305108#2025-06-10#x' }), '2025-06-10')
  // Atributo presente mas corrompido — não confia, cai para o pk.
  assert.equal(gazetteDate({ pk: 'GAZETTE#4305108#2025-06-10#x', date: 'ontem' }), '2025-06-10')
  assert.equal(gazetteDate({ pk: 'AGG#GAZETTE_COUNT' }), null)
})

test('aggregate soma por cidade e calcula min/max de data', () => {
  const { byCity, globalTotal, skipped } = aggregate([
    { pk: 'GAZETTE#4305108#2026-03-15#a', date: '2026-03-15' },
    { pk: 'GAZETTE#4305108#2021-01-04#b', date: '2021-01-04' },
    { pk: 'GAZETTE#4305108#2024-08-09#c', date: '2024-08-09' },
    { pk: 'GAZETTE#3550308#2026-07-28#d', date: '2026-07-28' },
  ])

  assert.equal(globalTotal, 4)
  assert.equal(skipped, 0)
  assert.deepEqual(byCity.get('4305108'), {
    total: 3,
    firstDate: '2021-01-04',
    lastDate: '2026-03-15',
  })
  assert.deepEqual(byCity.get('3550308'), {
    total: 1,
    firstDate: '2026-07-28',
    lastDate: '2026-07-28',
  })
})

test('aggregate não conta agregados nem watermarks como gazettes', () => {
  // REGRESSÃO: o Scan da API filtrava por prefixo GAZETTE#, então nunca via
  // esses itens. Um reconciliador que os contasse inflaria o total e o
  // endpoint passaria a reportar mais diários do que existem.
  const { byCity, globalTotal, skipped } = aggregate([
    { pk: 'GAZETTE#4305108#2026-03-15#a', date: '2026-03-15' },
    { pk: 'AGG#GAZETTE_COUNT', total: 47720 },
    { pk: 'AGG#GAZETTE_COUNT#4305108', total: 4212 },
    { pk: 'BACKFILL#4305108', lastDate: '2026-07-28' },
  ])

  assert.equal(globalTotal, 1)
  assert.equal(byCity.size, 1)
  assert.equal(byCity.get('4305108').total, 1)
  // `skipped` conta só itens GAZETTE# sem cidade derivável — aqui, nenhum.
  assert.equal(skipped, 0)
})

test('aggregate reporta gazettes URLHASH como skipped, sem inventar cidade', () => {
  const { byCity, globalTotal, skipped } = aggregate([
    { pk: 'GAZETTE#4305108#2026-03-15#a', date: '2026-03-15' },
    { pk: 'GAZETTE#URLHASH#0123456789abcdef', date: '2026-03-16' },
  ])

  assert.equal(globalTotal, 1)
  assert.equal(skipped, 1)
  assert.equal(byCity.has('URLHASH'), false)
})

test('aggregate tolera gazette sem data — conta, mas não move o período', () => {
  const { byCity } = aggregate([
    { pk: 'GAZETTE#4305108#2026-03-15#a', date: '2026-03-15' },
    { pk: 'GAZETTE#4305108#semdata' },
  ])

  assert.equal(byCity.get('4305108').total, 2)
  assert.equal(byCity.get('4305108').firstDate, '2026-03-15')
  assert.equal(byCity.get('4305108').lastDate, '2026-03-15')
})
