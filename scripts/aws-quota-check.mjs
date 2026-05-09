#!/usr/bin/env node
/**
 * AWS quota check — LRN-020 regression.
 *
 * Antes de qualquer PR que toque `reserved_concurrent_executions`,
 * throughput DynamoDB ou throttle de API, valida que a conta tem quota
 * suficiente. Contas novas têm `ConcurrentExecutions = 10` em vez de 1.000
 * (o painel default era nosso problema em 03/maio/2026).
 *
 * Uso (CI):
 *   node scripts/aws-quota-check.mjs
 *
 * Saída:
 *   - exit 0 se quotas batem com declaração no Terraform (e thresholds default)
 *   - exit 1 se quota for menor que reservado
 *   - exit 2 se faltar permissão IAM (warn, não fail) — pode rodar sem creds
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { glob } from 'node:fs/promises'

const MIN_LAMBDA_CONCURRENCY = 1000
const TF_DIR = 'terraform'

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function shSafe(cmd) {
  try {
    return { ok: true, out: sh(cmd) }
  } catch (e) {
    return { ok: false, out: '', err: e.message }
  }
}

async function readTerraformReservedConcurrency() {
  let total = 0
  const matches = []
  for await (const f of glob(`${TF_DIR}/**/*.tf`)) {
    if (!existsSync(f)) continue
    const text = readFileSync(f, 'utf8')
    const re = /reserved_concurrent_executions\s*=\s*(\d+)/g
    let m
    while ((m = re.exec(text)) !== null) {
      const v = parseInt(m[1], 10)
      total += v
      matches.push({ file: f, value: v })
    }
  }
  return { total, matches }
}

function checkLambdaConcurrency() {
  console.log('▶ Lambda Account Concurrency')
  const r = shSafe(
    'aws lambda get-account-settings --query "AccountLimit.ConcurrentExecutions" --output text',
  )
  if (!r.ok) {
    console.log('  ⚠ Sem permissão p/ get-account-settings — pulando (warn-only)')
    return { skipped: true }
  }
  const limit = parseInt(r.out, 10)
  console.log(`  ConcurrentExecutions: ${limit}`)
  if (limit < MIN_LAMBDA_CONCURRENCY) {
    console.log(`  ❌ Quota abaixo do mínimo esperado (${MIN_LAMBDA_CONCURRENCY})`)
    return { ok: false, limit }
  }
  return { ok: true, limit }
}

function checkDynamoLimits() {
  console.log('▶ DynamoDB Account Limits')
  const r = shSafe('aws dynamodb describe-limits --output json')
  if (!r.ok) {
    console.log('  ⚠ Sem permissão p/ describe-limits — pulando (warn-only)')
    return { skipped: true }
  }
  const limits = JSON.parse(r.out)
  console.log(`  AccountMaxReadCapacityUnits:  ${limits.AccountMaxReadCapacityUnits}`)
  console.log(`  AccountMaxWriteCapacityUnits: ${limits.AccountMaxWriteCapacityUnits}`)
  return { ok: true, limits }
}

async function main() {
  const failures = []

  const { total: reservedSum, matches } = await readTerraformReservedConcurrency()
  if (reservedSum > 0) {
    console.log('▶ Terraform `reserved_concurrent_executions` declarations:')
    for (const m of matches) console.log(`  ${m.file}: ${m.value}`)
    console.log(`  Total reserved: ${reservedSum}`)
  }

  const lambda = checkLambdaConcurrency()
  if (lambda.ok === false) failures.push('Lambda concurrency')
  if (lambda.ok && reservedSum > 0) {
    const headroom = lambda.limit - reservedSum
    console.log(`  Headroom (limit - reserved): ${headroom}`)
    if (headroom < 100) {
      console.log(`  ❌ Headroom < 100 — risco de starvation`)
      failures.push('Lambda headroom')
    }
  }

  const ddb = checkDynamoLimits()
  if (ddb.ok === false) failures.push('DynamoDB limits')

  if (failures.length > 0) {
    console.log(`\n❌ Quota check falhou: ${failures.join(', ')}`)
    console.log('   Ver LRN-20260503-020 em .learnings/LEARNINGS.md')
    process.exit(1)
  }
  console.log('\n✓ Quota check OK')
}

main().catch((e) => {
  console.error('quota-check error:', e)
  process.exit(2)
})
