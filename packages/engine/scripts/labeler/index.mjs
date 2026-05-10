#!/usr/bin/env node
/**
 * EVO-003 — CLI Labeler
 *
 * Rotula amostras do golden set (fixtures/golden-set.json) interativamente.
 *
 * Modos:
 *   npm run label                              # rotula amostras pendentes
 *   npm run label -- --import --fiscal=X --count=N  # importa novas amostras de prod
 *   npm run label -- --fiscal=X                # filtra para 1 Fiscal só
 *   npm run label -- --stats                   # mostra distribuicao atual
 *
 * Cada amostra leva <10s: mostra excerpt + finding hipotetico, pede T/F/N/B/?.
 *
 * Plan agent OPUS: rotulagem fatiga apos 90min. Nao tentar 70 num dia.
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const GOLDEN_SET_PATH = path.join(REPO_ROOT, 'fixtures/golden-set.json')

// ── Distribuicao alvo (Plan agent: ponderada por risco reputacional) ─────────

const TARGET_DISTRIBUTION = {
  'fiscal-pessoal': 12,
  'fiscal-nepotismo': 12,
  'fiscal-licitacoes': 8,
  'fiscal-contratos': 8,
  'fiscal-fornecedores': 8,
  'fiscal-geral': 6,
  'fiscal-diarias': 4,
  'fiscal-publicidade': 4,
  'fiscal-convenios': 4,
  'fiscal-locacao': 4,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadDataset() {
  if (!fs.existsSync(GOLDEN_SET_PATH)) {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      description: 'EVO-003 golden set',
      samples: [],
    }
  }
  return JSON.parse(fs.readFileSync(GOLDEN_SET_PATH, 'utf8'))
}

function saveDataset(ds) {
  fs.writeFileSync(GOLDEN_SET_PATH, JSON.stringify(ds, null, 2) + '\n')
}

function nextId(samples) {
  const max = samples.reduce((m, s) => {
    const n = parseInt(s.id?.replace('GS-', '') ?? '0', 10)
    return Math.max(m, isNaN(n) ? 0 : n)
  }, 0)
  return `GS-${String(max + 1).padStart(3, '0')}`
}

function distributionStats(samples) {
  const labeled = {}
  const pending = {}
  for (const fiscal of Object.keys(TARGET_DISTRIBUTION)) {
    labeled[fiscal] = 0
    pending[fiscal] = 0
  }
  for (const s of samples) {
    if (labeled[s.fiscalId] === undefined) {
      labeled[s.fiscalId] = 0
      pending[s.fiscalId] = 0
    }
    if (s.label) labeled[s.fiscalId]++
    else pending[s.fiscalId]++
  }
  return { labeled, pending }
}

function printStats(ds) {
  const { labeled, pending } = distributionStats(ds.samples)
  console.log('\n┌─────────────────────────────────┬─────────┬─────────┬──────────┐')
  console.log('│ Fiscal                          │  Alvo   │ Rotulado│ Pendente │')
  console.log('├─────────────────────────────────┼─────────┼─────────┼──────────┤')
  let totalTarget = 0
  let totalLabeled = 0
  let totalPending = 0
  for (const fiscal of Object.keys(TARGET_DISTRIBUTION)) {
    const target = TARGET_DISTRIBUTION[fiscal]
    const lab = labeled[fiscal] ?? 0
    const pen = pending[fiscal] ?? 0
    totalTarget += target
    totalLabeled += lab
    totalPending += pen
    const status = lab >= target ? '✓' : ' '
    console.log(`│ ${status} ${fiscal.padEnd(29)} │   ${String(target).padStart(3)}   │   ${String(lab).padStart(3)}   │   ${String(pen).padStart(3)}    │`)
  }
  console.log('├─────────────────────────────────┼─────────┼─────────┼──────────┤')
  console.log(`│ Total                           │   ${String(totalTarget).padStart(3)}   │   ${String(totalLabeled).padStart(3)}   │   ${String(totalPending).padStart(3)}    │`)
  console.log('└─────────────────────────────────┴─────────┴─────────┴──────────┘')
  const progress = totalTarget > 0 ? (totalLabeled / totalTarget * 100).toFixed(1) : '0.0'
  console.log(`\nProgresso global: ${progress}% (${totalLabeled}/${totalTarget})\n`)
}

// ── Import de candidatos de prod (gazettes-prod) ─────────────────────────────

async function importCandidates({ fiscal, count }) {
  if (!fiscal || !TARGET_DISTRIBUTION[fiscal]) {
    console.error(`Fiscal invalido: ${fiscal}`)
    console.error(`Validos: ${Object.keys(TARGET_DISTRIBUTION).join(', ')}`)
    process.exit(1)
  }

  // Imports tardios para nao carregar AWS SDK em --stats / --help
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb')
  const { DynamoDBDocumentClient, ScanCommand } = await import('@aws-sdk/lib-dynamodb')
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }))

  console.log(`\n▶ Importando ate ${count} candidatos para ${fiscal}...`)

  // Estrategia: scan paginado de alerts-prod com FilterExpression por fiscalId.
  // GSI1-city-date filtra por cidade; mas muitos Fiscais tem findings concentrados
  // em poucas cidades (ou cidades nao-POC). Scan global cobre amostragem real.
  const candidates = []
  let ExclusiveStartKey
  let scanned = 0
  const MAX_SCANNED = 5000  // limite de seguranca (alerts-prod tem ~3862 items hoje)
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: 'fiscal-digital-alerts-prod',
      FilterExpression: 'fiscalId = :f AND begins_with(pk, :p)',
      ExpressionAttributeValues: { ':f': fiscal, ':p': 'FINDING#' },
      ExclusiveStartKey,
    }))
    candidates.push(...(r.Items ?? []))
    scanned += r.ScannedCount ?? 0
    ExclusiveStartKey = r.LastEvaluatedKey
    // Para cedo se ja temos amostras suficientes para diversificar (count * 5)
    if (candidates.length >= count * 5) break
    if (scanned >= MAX_SCANNED) break
  } while (ExclusiveStartKey)

  // Embaralhar e pegar `count`
  const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, count)
  console.log(`  Encontrados ${candidates.length} (scanned ${scanned}), selecionados ${shuffled.length}`)

  if (shuffled.length === 0) {
    console.warn(`  ⚠ Nenhum finding em prod para ${fiscal}. Possiveis causas:`)
    console.warn(`     - Fiscal conservador demais (Nepotismo, Fornecedores) — 0 findings`)
    console.warn(`     - Adicionar amostras manualmente em fixtures/golden-set.json com label="FN"`)
    console.warn(`       indica que Fiscal nao detecta caso real (gap de recall)`)
  }

  return shuffled.map(f => ({
    fiscalId: f.fiscalId,
    cityId: f.cityId,
    type: f.type,
    riskScore: f.riskScore,
    confidence: f.confidence,
    narrative: f.narrative,
    legalBasis: f.legalBasis,
    cnpj: f.cnpj,
    secretaria: f.secretaria,
    value: f.value,
    contractNumber: f.contractNumber,
    evidence: f.evidence,
    sourceFindingId: f.id ?? f.pk,
    createdAt: f.createdAt,
  }))
}

// ── Loop interativo ──────────────────────────────────────────────────────────

function ask(rl, q) {
  return new Promise(resolve => rl.question(q, ans => resolve(ans.trim())))
}

function renderSample(sample, idx, total) {
  const ev = sample.evidence?.[0]
  const excerpt = ev?.excerpt ?? '(sem excerpt)'
  const source = ev?.source ?? '(sem url)'
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`  Amostra ${idx + 1}/${total}  ·  Fiscal: ${sample.fiscalId}  ·  Cidade: ${sample.cityId}`)
  console.log(`${'─'.repeat(72)}`)
  console.log(`  Tipo: ${sample.type}  |  Risk: ${sample.riskScore}  |  Conf: ${sample.confidence}`)
  if (sample.cnpj) console.log(`  CNPJ: ${sample.cnpj}`)
  if (sample.secretaria) console.log(`  Secretaria: ${sample.secretaria}`)
  if (sample.value) console.log(`  Valor: R$ ${sample.value.toLocaleString('pt-BR')}`)
  if (sample.contractNumber) console.log(`  Contrato: ${sample.contractNumber}`)
  console.log(`  Lei: ${sample.legalBasis ?? '(sem base legal)'}`)
  console.log(`${'─'.repeat(72)}`)
  console.log(`  Excerpt:`)
  console.log(`  ${excerpt.slice(0, 500)}${excerpt.length > 500 ? '...' : ''}`)
  console.log(`${'─'.repeat(72)}`)
  console.log(`  Narrativa Haiku:`)
  console.log(`  ${(sample.narrative ?? '(sem narrativa)').slice(0, 300)}`)
  console.log(`${'─'.repeat(72)}`)
  console.log(`  Fonte: ${source}`)
}

async function labelLoop(ds, filterFiscal) {
  const pending = ds.samples
    .filter(s => !s.label)
    .filter(s => !filterFiscal || s.fiscalId === filterFiscal)

  if (pending.length === 0) {
    console.log('\n✓ Sem amostras pendentes para rotular.')
    if (filterFiscal) console.log(`  (filtrado para ${filterFiscal})`)
    return
  }

  console.log(`\n▶ ${pending.length} amostras pendentes${filterFiscal ? ` (${filterFiscal})` : ''}.`)
  console.log(`  Comandos: T (true positive)  F (false positive)  N (false negative)  B (borderline)`)
  console.log(`            S (skip)  Q (quit/save)  ? (help)`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  for (let i = 0; i < pending.length; i++) {
    const sample = pending[i]
    renderSample(sample, i, pending.length)

    let label = null
    while (label === null) {
      const ans = (await ask(rl, '\n  → [T/F/N/B/S/Q/?]: ')).toUpperCase()
      switch (ans) {
        case 'T': label = 'TP'; break
        case 'F': label = 'FP'; break
        case 'N': label = 'FN'; break
        case 'B': label = 'borderline'; break
        case 'S':
          console.log('  ⊘ pulado (continua pendente)')
          label = 'SKIP'
          break
        case 'Q':
          rl.close()
          saveDataset(ds)
          console.log(`\n✓ Salvo. ${i} amostras rotuladas nesta sessao.`)
          return
        case '?':
          console.log(`
    T = TP (devia disparar e disparou — finding correto)
    F = FP (disparou mas nao devia — falso positivo)
    N = FN (devia disparar mas nao detectou — golden set tem expected null)
    B = borderline (caso ambiguo, sinaliza incerteza)
    S = skip (mantem pendente, proximo)
    Q = quit (salva e sai)
          `)
          break
        default:
          console.log('  ⚠ comando invalido')
      }
    }

    if (label !== 'SKIP') {
      sample.label = label
      sample.labeledBy = 'diego'
      sample.labeledAt = new Date().toISOString()
      const optionalNotes = await ask(rl, '  Notas (opcional, Enter pula): ')
      if (optionalNotes) sample.notes = optionalNotes
      console.log(`  ✓ ${sample.id} = ${label}`)
      // Auto-save a cada 5
      if ((i + 1) % 5 === 0) {
        saveDataset(ds)
        console.log(`  💾 auto-salvo (${i + 1}/${pending.length})`)
      }
    }
  }

  rl.close()
  saveDataset(ds)
  console.log(`\n✓ Concluido. ${pending.length} amostras processadas.`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const importMode = args.includes('--import')
  const statsOnly = args.includes('--stats')
  const fiscal = args.find(a => a.startsWith('--fiscal='))?.replace('--fiscal=', '')
  const count = parseInt(args.find(a => a.startsWith('--count='))?.replace('--count=', '') ?? '5', 10)

  const ds = loadDataset()

  if (statsOnly) {
    printStats(ds)
    return
  }

  if (importMode) {
    const candidates = await importCandidates({ fiscal, count })
    for (const c of candidates) {
      ds.samples.push({
        id: nextId(ds.samples),
        ...c,
        label: null,
        labeledBy: null,
        labeledAt: null,
        schemaVersion: 1,
      })
    }
    saveDataset(ds)
    console.log(`\n✓ ${candidates.length} amostras importadas. Rode 'npm run label' para rotular.`)
    printStats(ds)
    return
  }

  printStats(ds)
  await labelLoop(ds, fiscal)
  printStats(ds)
}

main().catch(err => {
  console.error('\n✗ Erro fatal:', err)
  process.exit(1)
})
