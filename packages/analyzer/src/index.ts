import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { SQSEvent } from 'aws-lambda'
import {
  fiscalLicitacoes,
  fiscalContratos,
  fiscalFornecedores,
  fiscalPessoal,
  fiscalConvenios,
  fiscalNepotismo,
  fiscalPublicidade,
  fiscalLocacao,
  fiscalDiarias,
  fiscalGeral,
  createCachedExtractEntities,
  saveMemory,
  generateNarrative,
  gazetteKey,
  requireEnv,
  createLogger,
  getPublishThresholds,
  isFeatureEnabled,
} from '@fiscal-digital/engine'
import type {
  CollectorMessage,
  Finding,
  FiscalContext,
  Gazette,
} from '@fiscal-digital/engine'

// ---------------------------------------------------------------------------
// AWS clients (module-scope — reutilizado em warm starts)
// ---------------------------------------------------------------------------

const sqsClient = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

const _rawDdb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
export const docClient = DynamoDBDocumentClient.from(_rawDdb)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'
const GAZETTES_TABLE = process.env.GAZETTES_TABLE ?? 'fiscal-digital-gazettes-prod'
const ALERTS_QUEUE_URL = requireEnv('ALERTS_QUEUE_URL')

const logger = createLogger('analyzer')

// ---------------------------------------------------------------------------
// queryAlertsByCnpj — usa GSI2-cnpj-date em fiscal-digital-alerts-prod
// ---------------------------------------------------------------------------

async function queryAlertsByCnpj(cnpj: string, sinceISO: string): Promise<Finding[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: ALERTS_TABLE,
      IndexName: 'GSI2-cnpj-date',
      KeyConditionExpression: '#cnpj = :cnpj AND #createdAt >= :since',
      ExpressionAttributeNames: {
        '#cnpj': 'cnpj',
        '#createdAt': 'createdAt',
      },
      ExpressionAttributeValues: {
        ':cnpj': cnpj,
        ':since': sinceISO,
      },
    }),
  )
  return ((res.Items ?? []) as unknown[]) as Finding[]
}

// ---------------------------------------------------------------------------
// Persist a Finding to DynamoDB alerts table
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UH-22 Phase 2 — State tracking
// Atualiza processedBy.{fiscalId} = ISO timestamp em gazettes-prod
// ---------------------------------------------------------------------------

async function markFiscalProcessed(gazetteId: string, fiscalIds: string[]): Promise<void> {
  if (fiscalIds.length === 0) return
  const now = new Date().toISOString()
  const setExpr = fiscalIds.map((_, i) => `#pb.#f${i} = :ts`).join(', ')
  const exprNames: Record<string, string> = { '#pb': 'processedBy' }
  fiscalIds.forEach((id, i) => { exprNames[`#f${i}`] = id })

  try {
    await docClient.send(new UpdateCommand({
      TableName: GAZETTES_TABLE,
      Key: { pk: `GAZETTE#${gazetteId}` },
      UpdateExpression: `SET ${setExpr}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: { ':ts': now },
    }))
  } catch (err) {
    // Não-bloqueante: se gazette não existe (smoke test) ou processedBy ainda não foi inicializado,
    // tenta com SET processedBy = if_not_exists()
    try {
      await docClient.send(new UpdateCommand({
        TableName: GAZETTES_TABLE,
        Key: { pk: `GAZETTE#${gazetteId}` },
        UpdateExpression: `SET #pb = if_not_exists(#pb, :empty)`,
        ExpressionAttributeNames: { '#pb': 'processedBy' },
        ExpressionAttributeValues: { ':empty': {} },
      }))
      // Tentar de novo o set dos campos
      await docClient.send(new UpdateCommand({
        TableName: GAZETTES_TABLE,
        Key: { pk: `GAZETTE#${gazetteId}` },
        UpdateExpression: `SET ${setExpr}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: { ':ts': now },
      }))
    } catch (e2) {
      logger.error('markFiscalProcessed falhou', { gazetteId, fiscalIds, err: (e2 as Error).message })
    }
  }
}

async function persistFinding(finding: Finding): Promise<void> {
  const createdAt = finding.createdAt ?? new Date().toISOString()
  // Idempotência: pk derivado da gazette de origem (não do timestamp).
  // Reprocessamento da mesma gazette sobrescreve o finding em vez de criar
  // duplicata. Fallback para createdAt se evidence ausente (LRN-20260503-022).
  const sourceUrl = finding.evidence?.[0]?.source
  const stableKey = sourceUrl ? gazetteKey(sourceUrl) : null
  const pk = `FINDING#${finding.fiscalId}#${finding.cityId}#${finding.type}#${stableKey ?? createdAt}`
  // Hydrate id so publisher can use it for deduplication
  finding.id = pk
  finding.createdAt = createdAt
  await saveMemory.execute({
    pk,
    table: ALERTS_TABLE,
    item: {
      ...(finding as unknown as Record<string, unknown>),
      pk,
    },
  })

  // EVO-002 / MIT-02: deriva SUPPLIER do Finding e grava em suppliers-prod
  // para habilitar cross-supplier (FiscalContratos + FiscalFornecedores Sprint 9).
  // Best-effort: try/catch + feature flag SSM; falha não derruba o finding.
  await maybeWriteSupplier(finding, createdAt)
}

const SUPPLIERS_TABLE = process.env.SUPPLIERS_TABLE ?? 'fiscal-digital-suppliers-prod'

/**
 * Grava SUPPLIER no `suppliers-prod` se o finding tem CNPJ.
 * Best-effort: erros são logados mas não falham o finding.
 * Controlado por feature flag SSM `/fiscal-digital/prod/enable-supplier-write`
 * (default false — flip via CLI quando smoke validar).
 */
async function maybeWriteSupplier(finding: Finding, createdAt: string): Promise<void> {
  if (!finding.cnpj) return
  if (!(await isFeatureEnabled('enable-supplier-write'))) return
  try {
    // sk: {contractedAt}#{contractId} — cronológico + dedupe por contractId.
    // Fallback contractedAt = createdAt do finding (não temos contract date no Finding hoje).
    const contractedAt = createdAt
    const contractId = finding.contractNumber ?? finding.id ?? 'unknown'
    await saveMemory.execute({
      pk: `SUPPLIER#${finding.cnpj}`,
      table: SUPPLIERS_TABLE,
      item: {
        sk: `${contractedAt}#${contractId}`,
        cityId: finding.cityId,
        contractedAt,
        contractId,
        contractNumber: finding.contractNumber,
        valueAmount: finding.value,
        secretaria: finding.secretaria,
        sourceFindingId: finding.id,
        sourceFiscalId: finding.fiscalId,
        capturedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    logger.warn('supplier write falhou — finding preservado', {
      cnpj: finding.cnpj,
      findingId: finding.id,
      err: (err as Error).message,
    })
  }
}

// ---------------------------------------------------------------------------
// Send a qualifying Finding to the publish queue
// ---------------------------------------------------------------------------

// OPS-OPS-004: gazetteId propagado collector → analyzer → publisher.
// MessageAttributes.gazetteId carrega o ID da GAZETTE original (não o
// FINDING#... pk), permitindo correlacionar logs das 3 Lambdas com uma
// única query no CloudWatch Insights:
//   fields @timestamp, service, message
//   | filter gazetteId = "4305108#2026-04-15#1"
//   | sort @timestamp asc
async function enqueueForPublish(finding: Finding, gazetteId: string): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: ALERTS_QUEUE_URL,
      MessageBody: JSON.stringify(finding),
      MessageAttributes: {
        gazetteId: { DataType: 'String', StringValue: gazetteId },
      },
    }),
  )
}

// ---------------------------------------------------------------------------
// Convert CollectorMessage → Gazette (the shape Fiscais expect)
// ---------------------------------------------------------------------------

function toGazette(msg: CollectorMessage): Gazette {
  return {
    id: msg.gazetteId,
    territory_id: msg.territory_id,
    date: msg.date,
    url: msg.url,
    excerpts: msg.excerpts,
  }
}

// ---------------------------------------------------------------------------
// Build FiscalContext with real skills injected
// ---------------------------------------------------------------------------

function buildContext(gazetteId: string): FiscalContext {
  // Cached extractor escopado a esta gazette: cache em memória + DynamoDB entities-prod.
  // Eliminação de 3-5x chamadas Bedrock duplicadas dentro do mesmo Lambda invocation,
  // e 100% cache hit em re-análises (UH-22).
  const cachedExtractor = createCachedExtractEntities({ gazetteId })

  return {
    alertsTable: ALERTS_TABLE,
    extractEntities: cachedExtractor,
    generateNarrative: async (finding: unknown) => {
      const result = await generateNarrative.execute({ finding: finding as Finding })
      return result.data
    },
    saveMemory,
    queryAlertsByCnpj,
  }
}

// ---------------------------------------------------------------------------
// Process a single SQS record
// ---------------------------------------------------------------------------

async function processRecord(body: string): Promise<void> {
  const msg = JSON.parse(body) as CollectorMessage
  const gazette = toGazette(msg)
  const cityId = msg.territory_id
  const ctx = buildContext(gazette.id)

  // UH-22 Phase 2: state tracking. Se enabledFiscals presente, roda só esses
  // (re-analyze de Fiscal novo sem re-executar os demais).
  const enabled = msg.enabledFiscals
  const shouldRun = (id: string): boolean => !enabled || enabled.includes(id)

  // Run only enabled Fiscais; allSettled ensures one failure never stops the others
  const [
    licitacoesResult,
    contratosResult,
    fornecedoresResult,
    pessoalResult,
    conveniosResult,
    nepotismoResult,
    publicidadeResult,
    locacaoResult,
    diariasResult,
  ] = await Promise.allSettled([
    shouldRun('fiscal-licitacoes') ? fiscalLicitacoes.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-contratos') ? fiscalContratos.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-fornecedores') ? fiscalFornecedores.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-pessoal') ? fiscalPessoal.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-convenios') ? fiscalConvenios.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-nepotismo') ? fiscalNepotismo.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-publicidade') ? fiscalPublicidade.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-locacao') ? fiscalLocacao.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
    shouldRun('fiscal-diarias') ? fiscalDiarias.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
  ])

  const specializedFindings: Finding[] = []

  if (licitacoesResult.status === 'fulfilled') {
    specializedFindings.push(...licitacoesResult.value)
  } else {
    logger.error('fiscalLicitacoes falhou', {
      gazetteId: gazette.id,
      error: licitacoesResult.reason,
    })
  }

  if (contratosResult.status === 'fulfilled') {
    specializedFindings.push(...contratosResult.value)
  } else {
    logger.error('fiscalContratos falhou', {
      gazetteId: gazette.id,
      error: contratosResult.reason,
    })
  }

  if (fornecedoresResult.status === 'fulfilled') {
    specializedFindings.push(...fornecedoresResult.value)
  } else {
    logger.error('fiscalFornecedores falhou', {
      gazetteId: gazette.id,
      error: fornecedoresResult.reason,
    })
  }

  if (pessoalResult.status === 'fulfilled') {
    specializedFindings.push(...pessoalResult.value)
  } else {
    logger.error('fiscalPessoal falhou', {
      gazetteId: gazette.id,
      error: pessoalResult.reason,
    })
  }

  if (conveniosResult.status === 'fulfilled') {
    specializedFindings.push(...conveniosResult.value)
  } else {
    logger.error('fiscalConvenios falhou', { gazetteId: gazette.id, error: conveniosResult.reason })
  }

  if (nepotismoResult.status === 'fulfilled') {
    specializedFindings.push(...nepotismoResult.value)
  } else {
    logger.error('fiscalNepotismo falhou', { gazetteId: gazette.id, error: nepotismoResult.reason })
  }

  if (publicidadeResult.status === 'fulfilled') {
    specializedFindings.push(...publicidadeResult.value)
  } else {
    logger.error('fiscalPublicidade falhou', { gazetteId: gazette.id, error: publicidadeResult.reason })
  }

  if (locacaoResult.status === 'fulfilled') {
    specializedFindings.push(...locacaoResult.value)
  } else {
    logger.error('fiscalLocacao falhou', { gazetteId: gazette.id, error: locacaoResult.reason })
  }

  if (diariasResult.status === 'fulfilled') {
    specializedFindings.push(...diariasResult.value)
  } else {
    logger.error('fiscalDiarias falhou', { gazetteId: gazette.id, error: diariasResult.reason })
  }

  // FiscalGeral consolida os findings dos 4 Fiscais especializados e adiciona
  // eventuais meta-findings padrao_recorrente (riskScore >= 90)
  const allFindings: Finding[] = fiscalGeral.consolidar({ findings: specializedFindings, cityId })

  // Persist all Findings regardless of riskScore, then selectively enqueue for publish
  await Promise.allSettled(
    allFindings.map(async finding => {
      try {
        await persistFinding(finding)
      } catch (err) {
        logger.error('falha ao persistir finding', { type: finding.type, err })
      }

      const { riskThreshold, confidenceThreshold } = await getPublishThresholds()
      const shouldPublish =
        finding.riskScore >= riskThreshold &&
        finding.confidence >= confidenceThreshold

      if (shouldPublish) {
        try {
          await enqueueForPublish(finding, gazette.id)
          logger.info('finding enfileirado para publicação', {
            type: finding.type,
            riskScore: finding.riskScore,
            confidence: finding.confidence,
            cityId: finding.cityId,
          })
        } catch (err) {
          logger.error('falha ao enfileirar finding', { type: finding.type, err })
        }
      } else {
        logger.info('finding descartado (abaixo do limiar)', {
          type: finding.type,
          riskScore: finding.riskScore,
          confidence: finding.confidence,
        })
      }
    }),
  )

  // UH-22 Phase 2: marca quais Fiscais executaram com sucesso (não-bloqueante)
  const ranSuccessfully: string[] = []
  if (licitacoesResult.status === 'fulfilled' && shouldRun('fiscal-licitacoes')) ranSuccessfully.push('fiscal-licitacoes')
  if (contratosResult.status === 'fulfilled' && shouldRun('fiscal-contratos')) ranSuccessfully.push('fiscal-contratos')
  if (fornecedoresResult.status === 'fulfilled' && shouldRun('fiscal-fornecedores')) ranSuccessfully.push('fiscal-fornecedores')
  if (pessoalResult.status === 'fulfilled' && shouldRun('fiscal-pessoal')) ranSuccessfully.push('fiscal-pessoal')
  if (conveniosResult.status === 'fulfilled' && shouldRun('fiscal-convenios')) ranSuccessfully.push('fiscal-convenios')
  if (nepotismoResult.status === 'fulfilled' && shouldRun('fiscal-nepotismo')) ranSuccessfully.push('fiscal-nepotismo')
  if (publicidadeResult.status === 'fulfilled' && shouldRun('fiscal-publicidade')) ranSuccessfully.push('fiscal-publicidade')
  if (locacaoResult.status === 'fulfilled' && shouldRun('fiscal-locacao')) ranSuccessfully.push('fiscal-locacao')
  if (diariasResult.status === 'fulfilled' && shouldRun('fiscal-diarias')) ranSuccessfully.push('fiscal-diarias')
  await markFiscalProcessed(gazette.id, ranSuccessfully)

  logger.info('gazette processada', {
    gazetteId: gazette.id,
    cityId,
    fiscaisExecutados: ranSuccessfully,
    findingsEspecializados: specializedFindings.length,
    findingsTotal: allFindings.length,
  })
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (event: SQSEvent): Promise<void> => {
  const { riskThreshold, confidenceThreshold } = await getPublishThresholds()
  logger.info('iniciando', {
    records: event.Records.length,
    publishRiskThreshold: riskThreshold,
    publishConfidenceThreshold: confidenceThreshold,
  })

  for (const record of event.Records) {
    const gazetteId = record.messageAttributes?.['gazetteId']?.stringValue ?? 'unknown'
    logger.appendKeys({ gazetteId })
    try {
      await processRecord(record.body)
    } catch (err) {
      logger.error('falha ao processar record — continuando próximo', {
        messageId: record.messageId,
        err,
      })
    } finally {
      logger.removeKeys(['gazetteId'])
    }
  }
}
