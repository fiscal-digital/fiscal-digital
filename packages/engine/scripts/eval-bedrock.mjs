#!/usr/bin/env node
/**
 * eval-bedrock.mjs — Comparativo de modelos AWS Bedrock para extract_entities
 *
 * Testa extração de entidades de diários oficiais em PT-BR usando:
 *   - Amazon Nova Micro  (mais barato do Bedrock)
 *   - Amazon Nova Lite   (mid-tier da Amazon)
 *   - Claude Haiku 3.5   (baseline de qualidade via Bedrock)
 *
 * Uso:
 *   node packages/engine/scripts/eval-bedrock.mjs
 *   node packages/engine/scripts/eval-bedrock.mjs --models nova-micro,haiku
 *
 * Requisitos:
 *   - AWS credentials configuradas (OIDC ou profile local)
 *   - Modelos habilitados no Bedrock console (us-east-1):
 *       https://console.aws.amazon.com/bedrock/home#/modelaccess
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'

// ── Modelos ──────────────────────────────────────────────────────────────────

const MODELS = {
  'nova-micro': {
    id: 'amazon.nova-micro-v1:0',
    label: 'Nova Micro',
    priceInput: 0.000035,   // $/1K tokens
    priceOutput: 0.000140,
  },
  'nova-lite': {
    id: 'amazon.nova-lite-v1:0',
    label: 'Nova Lite',
    priceInput: 0.000060,
    priceOutput: 0.000240,
  },
  'haiku': {
    id: 'us.anthropic.claude-3-haiku-20240307-v1:0',
    label: 'Claude Haiku 3',
    priceInput: 0.000250,
    priceOutput: 0.001250,
  },
  'haiku45': {
    id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    label: 'Claude Haiku 4.5',
    priceInput: 0.000800,
    priceOutput: 0.004000,
  },
  'nova-lite': {
    id: 'amazon.nova-lite-v1:0',
    label: 'Nova Lite',
    priceInput: 0.000060,
    priceOutput: 0.000240,
  },
}

// ── System Prompt (idêntico ao extract_entities.ts) ──────────────────────────

const SYSTEM_PROMPT = `Você é um extrator de entidades de diários oficiais municipais brasileiros.
Analise o texto e extraia:
- secretaria: nome da secretaria municipal responsável (string ou null)
- actType: tipo do ato — contrato | licitacao | dispensa | inexigibilidade | nomeacao | exoneracao | aditivo | prorrogacao | outro (string ou null)
- supplier: razão social da empresa ou pessoa contratada (string ou null)
- legalBasis: base legal citada, ex: "Lei 14.133/2021, Art. 75" (string ou null)
- subtype: classifica o objeto da contratação para determinar o inciso da Lei 14.133/2021 Art. 75 —
  "obra_engenharia" (obras civis, reforma de imóvel/prédio/escola/estrada, construção, pavimentação) |
  "servico" (consultoria, assessoria, manutenção de equipamentos não-imobiliária, limpeza, eventos, tecnologia da informação) |
  "compra" (aquisição de bens, equipamentos, veículos, materiais) |
  null (ambíguo ou não aplicável)
- valorOriginalContrato: quando o texto for de aditivo e citar explicitamente o valor original do contrato (ex: "valor original de R$ X", "contrato originalmente firmado por R$ X", "valor inicial do contrato de R$ X"), extrair o número; null caso contrário

Responda APENAS com JSON válido, sem texto adicional.`

// ── Amostras de Diários de Caxias do Sul ─────────────────────────────────────

const SAMPLES = [
  {
    id: 'dispensa-servico-alto',
    label: 'Dispensa serviço R$ 80k (acima teto)',
    text: 'DISPENSA DE LICITAÇÃO n° 012/2026. Objeto: contratação de serviços de consultoria em tecnologia da informação. Valor: R$ 80.000,00. Base Legal: Lei 14.133/2021, Art. 75, II. Contratada: Tech Solutions LTDA, CNPJ: 12.345.678/0001-90. Secretaria Municipal de Administração.',
    expected: { actType: 'dispensa', subtype: 'servico', secretaria: 'Secretaria Municipal de Administração' },
  },
  {
    id: 'obra-acima-teto',
    label: 'Dispensa obra R$ 150k (acima teto I)',
    text: 'DISPENSA DE LICITAÇÃO n° 023/2026. Objeto: reforma do prédio da escola municipal. Valor: R$ 150.000,00. Base Legal: Lei 14.133/2021, Art. 75, I. Contratada: Construções Caxias LTDA, CNPJ: 55.666.777/0001-88. Secretaria Municipal de Educação.',
    expected: { actType: 'dispensa', subtype: 'obra_engenharia', secretaria: 'Secretaria Municipal de Educação' },
  },
  {
    id: 'aditivo-com-valor-original',
    label: 'Aditivo contratual com valor original explícito',
    text: 'TERMO ADITIVO n° 003/2026 ao Contrato n° 045/2025. Objeto: acréscimo de 30% ao valor contratual para serviços de limpeza. Contratante: Prefeitura Municipal de Caxias do Sul. Contratada: Limpeza Total LTDA, CNPJ: 98.765.432/0001-10. Valor original do contrato: R$ 100.000,00. Valor do aditivo: R$ 30.000,00. Secretaria Municipal de Saúde.',
    expected: { actType: 'aditivo', valorOriginalContrato: 100000, secretaria: 'Secretaria Municipal de Saúde' },
  },
  {
    id: 'nomeacao-cargo-comissao',
    label: 'Nomeação para cargo em comissão',
    text: 'PORTARIA n° 1.234/2026. O Prefeito Municipal de Caxias do Sul, no uso de suas atribuições, NOMEIA João da Silva para exercer o cargo em Comissão de Diretor de Departamento, símbolo DAS-3, junto à Secretaria Municipal de Finanças. Caxias do Sul, 15 de março de 2026.',
    expected: { actType: 'nomeacao', secretaria: 'Secretaria Municipal de Finanças', supplier: null },
  },
  {
    id: 'inexigibilidade-empresa-unica',
    label: 'Inexigibilidade por fornecedor único',
    text: 'INEXIGIBILIDADE DE LICITAÇÃO n° 008/2026. Objeto: contratação de empresa exclusiva para fornecimento de software de gestão municipal com suporte técnico especializado. Empresa: SoftGov Sistemas LTDA, CNPJ: 11.222.333/0001-44. Valor: R$ 250.000,00. Base Legal: Lei 14.133/2021, Art. 74, I. Secretaria de Planejamento e Gestão.',
    expected: { actType: 'inexigibilidade', subtype: 'servico', legalBasis: 'Lei 14.133/2021, Art. 74, I' },
  },
]

// ── Cliente Bedrock ───────────────────────────────────────────────────────────

const client = new BedrockRuntimeClient({ region: 'us-east-1' })

async function callModel(modelKey, text) {
  const model = MODELS[modelKey]
  const start = Date.now()

  const command = new ConverseCommand({
    modelId: model.id,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: text.slice(0, 4000) }] }],
    inferenceConfig: { maxTokens: 256, temperature: 0 },
  })

  const response = await client.send(command)
  const latencyMs = Date.now() - start

  const rawText = response.output?.message?.content?.[0]?.text ?? ''
  const inputTokens = response.usage?.inputTokens ?? 0
  const outputTokens = response.usage?.outputTokens ?? 0
  const costUsd = (inputTokens * model.priceInput + outputTokens * model.priceOutput) / 1000

  // Strip markdown code blocks se presentes (```json ... ``` ou ``` ... ```)
  const cleanText = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed = null
  let parseError = null
  try {
    parsed = JSON.parse(cleanText)
  } catch (e) {
    parseError = e.message
  }

  return { rawText, parsed, parseError, latencyMs, inputTokens, outputTokens, costUsd }
}

// ── Comparar resultado com esperado ──────────────────────────────────────────

function checkResult(parsed, expected) {
  if (!parsed) return { correct: 0, total: Object.keys(expected).length, issues: ['JSON inválido'] }

  const issues = []
  let correct = 0
  for (const [key, expectedVal] of Object.entries(expected)) {
    const actual = parsed[key]
    if (expectedVal === null) {
      if (actual === null || actual === undefined) { correct++ } else { issues.push(`${key}: esperado null, got "${actual}"`) }
    } else if (typeof expectedVal === 'number') {
      if (Number(actual) === expectedVal) { correct++ } else { issues.push(`${key}: esperado ${expectedVal}, got ${actual}`) }
    } else {
      const norm = (s) => String(s ?? '').toLowerCase().trim()
      if (norm(actual).includes(norm(String(expectedVal))) || norm(String(expectedVal)).includes(norm(actual))) {
        correct++
      } else {
        issues.push(`${key}: esperado "${expectedVal}", got "${actual}"`)
      }
    }
  }
  return { correct, total: Object.keys(expected).length, issues }
}

// ── Runner principal ──────────────────────────────────────────────────────────

async function runEval() {
  const args = process.argv.slice(2)
  const modelsArg = args.find(a => a.startsWith('--models='))
  const modelKeys = modelsArg
    ? modelsArg.replace('--models=', '').split(',')
    : ['nova-micro', 'nova-lite', 'haiku']

  const validKeys = modelKeys.filter(k => MODELS[k])
  if (validKeys.length === 0) {
    console.error('Modelos inválidos. Use: nova-micro, nova-lite, haiku')
    process.exit(1)
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log('  Fiscal Digital — Bedrock Model Evaluation')
  console.log(`  Modelos: ${validKeys.map(k => MODELS[k].label).join(', ')}`)
  console.log(`  Amostras: ${SAMPLES.length}`)
  console.log(`${'='.repeat(70)}\n`)

  const summary = {}
  for (const key of validKeys) {
    summary[key] = { totalCorrect: 0, totalChecks: 0, totalCost: 0, totalLatency: 0, errors: 0 }
  }

  for (const sample of SAMPLES) {
    console.log(`\n── ${sample.label} ─────────────────────────`)
    console.log(`   Input: "${sample.text.slice(0, 80)}..."`)

    for (const key of validKeys) {
      const model = MODELS[key]
      try {
        const result = await callModel(key, sample.text)
        const check = checkResult(result.parsed, sample.expected)

        summary[key].totalCorrect += check.correct
        summary[key].totalChecks += check.total
        summary[key].totalCost += result.costUsd
        summary[key].totalLatency += result.latencyMs

        const scoreEmoji = check.correct === check.total ? '✅' : check.correct > 0 ? '⚠️' : '❌'
        console.log(`\n   [${model.label}] ${scoreEmoji} ${check.correct}/${check.total} corretos | ${result.latencyMs}ms | $${result.costUsd.toFixed(6)}`)
        if (result.parsed) {
          console.log(`   JSON: ${JSON.stringify(result.parsed)}`)
        } else {
          console.log(`   ERRO parse: ${result.parseError}`)
          console.log(`   Raw: ${result.rawText.slice(0, 200)}`)
          summary[key].errors++
        }
        if (check.issues.length > 0) {
          console.log(`   Issues: ${check.issues.join('; ')}`)
        }
      } catch (err) {
        console.log(`\n   [${model.label}] 💥 FALHA: ${err.message}`)
        summary[key].errors++
      }
    }
  }

  // ── Resumo ──────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}`)
  console.log('  RESUMO')
  console.log(`${'='.repeat(70)}`)
  console.log(
    `\n${'Modelo'.padEnd(20)} ${'Acurácia'.padEnd(12)} ${'Latência'.padEnd(12)} ${'Custo/amostra'.padEnd(16)} ${'Custo 1k gazettes'}`
  )
  console.log('-'.repeat(80))

  for (const key of validKeys) {
    const s = summary[key]
    const accuracy = s.totalChecks > 0 ? ((s.totalCorrect / s.totalChecks) * 100).toFixed(0) + '%' : 'N/A'
    const avgLatency = (s.totalLatency / SAMPLES.length).toFixed(0) + 'ms'
    const avgCost = (s.totalCost / SAMPLES.length)
    const costPer1k = (avgCost * 1000).toFixed(4)
    console.log(
      `${MODELS[key].label.padEnd(20)} ${accuracy.padEnd(12)} ${avgLatency.padEnd(12)} $${avgCost.toFixed(6).padEnd(15)} $${costPer1k}`
    )
  }

  console.log('\n  Nota: Haiku 4.5 direto (Anthropic) = $0.80/MTok input, $4.00/MTok output')
  console.log('  Bedrock não suporta prompt caching nos mesmos moldes do SDK Anthropic.')
  console.log('  Para migração, avaliar se a ausência de cache afeta latência em prod.\n')
}

runEval().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
