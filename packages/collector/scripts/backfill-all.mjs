#!/usr/bin/env node
/**
 * backfill-all.mjs — Roda backfill 2021→hoje para todas as cidades pendentes
 *
 * Executa o backfill.mjs sequencialmente para cada cidade que ainda não foi
 * processada (ou que precisa atualização). Cidades sem cobertura QD retornam
 * processed=0 rapidamente.
 *
 * Uso: node packages/collector/scripts/backfill-all.mjs
 */

import { execSync } from 'child_process'

// PoC = Caxias do Sul (origem MVP) + Porto Alegre (capital escala média)
// Ver CLAUDE.md "Cidades-padrão para Provas de Conceito"
const POC_CITIES = [
  { id: '4305108', name: 'Caxias do Sul' },
  { id: '4314902', name: 'Porto Alegre' },
]

const PENDING = [
  { id: '3304557', name: 'Rio de Janeiro' },
  { id: '5300108', name: 'Brasília' },
  { id: '3106200', name: 'Belo Horizonte' },
  { id: '2304400', name: 'Fortaleza' },
  { id: '2927408', name: 'Salvador' },
  { id: '1302603', name: 'Manaus' },
  { id: '2611606', name: 'Recife' },
  { id: '5208707', name: 'Goiânia' },
  { id: '1501402', name: 'Belém' },
  { id: '3518800', name: 'Guarulhos' },
  { id: '2111300', name: 'São Luís' },
  { id: '2704302', name: 'Maceió' },
  { id: '5002704', name: 'Campo Grande' },
  { id: '3304904', name: 'São Gonçalo' },
  { id: '2211001', name: 'Teresina' },
  { id: '2507507', name: 'João Pessoa' },
  { id: '3548708', name: 'São Bernardo do Campo' },
  { id: '3301702', name: 'Duque de Caxias' },
  { id: '3303500', name: 'Nova Iguaçu' },
  { id: '2408102', name: 'Natal' },
  { id: '3547809', name: 'Santo André' },
  { id: '3534401', name: 'Osasco' },
  { id: '3552205', name: 'Sorocaba' },
  { id: '3170206', name: 'Uberlândia' },
  { id: '3543402', name: 'Ribeirão Preto' },
  { id: '3549904', name: 'São José dos Campos' },
  { id: '5103403', name: 'Cuiabá' },
  { id: '2607901', name: 'Jaboatão dos Guararapes' },
  { id: '3118601', name: 'Contagem' },
  { id: '4209102', name: 'Joinville' },
  { id: '2910800', name: 'Feira de Santana' },
  { id: '2800308', name: 'Aracaju' },
  { id: '4113700', name: 'Londrina' },
  { id: '3136702', name: 'Juiz de Fora' },
  { id: '5201405', name: 'Aparecida de Goiânia' },
  { id: '3205002', name: 'Serra' },
  { id: '3301009', name: 'Campos dos Goytacazes' },
  { id: '3300456', name: 'Belford Roxo' },
  { id: '3303302', name: 'Niterói' },
  { id: '3549805', name: 'São José do Rio Preto' },
  { id: '1500800', name: 'Ananindeua' },
  { id: '3205200', name: 'Vila Velha' },
  { id: '1100205', name: 'Porto Velho' },
  { id: '3530607', name: 'Mogi das Cruzes' },
]

console.log(`\n${'='.repeat(70)}`)
console.log(`  Fiscal Digital — Backfill em massa (${PENDING.length} cidades)`)
console.log(`${'='.repeat(70)}\n`)

const startedAt = Date.now()
const results = []

for (let i = 0; i < PENDING.length; i++) {
  const c = PENDING[i]
  const prefix = `[${String(i + 1).padStart(2)}/${PENDING.length}]`
  console.log(`\n${prefix} ${c.name} (${c.id})`)

  const t0 = Date.now()
  try {
    const out = execSync(
      `node packages/collector/scripts/backfill.mjs --city=${c.id}`,
      { encoding: 'utf-8', stdio: 'pipe', timeout: 1200000 }
    )
    const m = out.match(/Gazettes verificadas: (\d+)\s+Novas → SQS: (\d+)/)
    const verified = m?.[1] ?? '?'
    const sent = m?.[2] ?? '?'
    const dur = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`  ✓ ${verified} verificadas · ${sent} novas · ${dur}s`)
    results.push({ city: c.name, verified, sent, ok: true })
  } catch (err) {
    console.log(`  ✗ ERRO: ${err.message?.slice(0, 80)}`)
    results.push({ city: c.name, ok: false, error: err.message?.slice(0, 80) })
  }
}

const totalSec = ((Date.now() - startedAt) / 1000).toFixed(0)
const totalSent = results.reduce((s, r) => s + (Number(r.sent) || 0), 0)
const ok = results.filter(r => r.ok).length
const erros = results.filter(r => !r.ok).length

console.log(`\n${'='.repeat(70)}`)
console.log(`  CONCLUÍDO em ${totalSec}s`)
console.log(`  ${ok}/${PENDING.length} cidades processadas · ${erros} erros`)
console.log(`  Total novas gazettes → SQS: ${totalSent}`)
console.log(`${'='.repeat(70)}\n`)
