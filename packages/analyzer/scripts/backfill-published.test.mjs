// Logica pura do backfill de `published` (#146).
// node --test packages/analyzer/scripts/backfill-published.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valorPublished, ehFinding } from './backfill-published.mjs'

test('unpublishable vira false; o resto vira true', () => {
  assert.equal(valorPublished({ unpublishable: true }), 'false')
  assert.equal(valorPublished({ unpublishable: false }), 'true')
  assert.equal(valorPublished({}), 'true')
  assert.equal(valorPublished(undefined), 'true')
})

test('o valor e String — chave de indice do DynamoDB nao aceita BOOL', () => {
  assert.equal(typeof valorPublished({}), 'string')
  assert.equal(typeof valorPublished({ unpublishable: true }), 'string')
})

test('so FINDING# entra no indice', () => {
  assert.equal(ehFinding('FINDING#fiscal-licitacoes#4305108#x#y'), true)
  assert.equal(ehFinding('DISPENSA#4305108#cnpj#100'), false)
  assert.equal(ehFinding('ADITIVO#x'), false)
  assert.equal(ehFinding(undefined), false)
  assert.equal(ehFinding(''), false)
})
