import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { SQSEvent } from 'aws-lambda'
import {
  fiscalLicitacoes,
  fiscalContratos,
  fiscalFornecedores,
  fiscalPessoal,
  fiscalGeral,
  extractEntities,
  saveMemory,
  generateNarrative,
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
const ALERTS_QUEUE_URL = process.env.ALERTS_QUEUE_URL!
const PUBLISH_RISK_THRESHOLD = 60
const PUBLISH_CONFIDENCE_THRESHOLD = 0.70

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

async function persistFinding(finding: Finding): Promise<void> {
  const createdAt = finding.createdAt ?? new Date().toISOString()
  const pk = `FINDING#${finding.fiscalId}#${finding.cityId}#${finding.type}#${createdAt}`
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
}

// ---------------------------------------------------------------------------
// Send a qualifying Finding to the publish queue
// ---------------------------------------------------------------------------

async function enqueueForPublish(finding: Finding): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: ALERTS_QUEUE_URL,
      MessageBody: JSON.stringify(finding),
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

function buildContext(): FiscalContext {
  return {
    alertsTable: ALERTS_TABLE,
    extractEntities,
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
  const ctx = buildContext()

  // Run all 4 specialized Fiscais in parallel; allSettled ensures one failure never stops the others
  const [licitacoesResult, contratosResult, fornecedoresResult, pessoalResult] =
    await Promise.allSettled([
      fiscalLicitacoes.analisar({ gazette, cityId, context: ctx }),
      fiscalContratos.analisar({ gazette, cityId, context: ctx }),
      fiscalFornecedores.analisar({ gazette, cityId, context: ctx }),
      fiscalPessoal.analisar({ gazette, cityId, context: ctx }),
    ])

  const specializedFindings: Finding[] = []

  if (licitacoesResult.status === 'fulfilled') {
    specializedFindings.push(...licitacoesResult.value)
  } else {
    console.error('[analyzer] fiscalLicitacoes falhou', {
      gazetteId: gazette.id,
      error: licitacoesResult.reason,
    })
  }

  if (contratosResult.status === 'fulfilled') {
    specializedFindings.push(...contratosResult.value)
  } else {
    console.error('[analyzer] fiscalContratos falhou', {
      gazetteId: gazette.id,
      error: contratosResult.reason,
    })
  }

  if (fornecedoresResult.status === 'fulfilled') {
    specializedFindings.push(...fornecedoresResult.value)
  } else {
    console.error('[analyzer] fiscalFornecedores falhou', {
      gazetteId: gazette.id,
      error: fornecedoresResult.reason,
    })
  }

  if (pessoalResult.status === 'fulfilled') {
    specializedFindings.push(...pessoalResult.value)
  } else {
    console.error('[analyzer] fiscalPessoal falhou', {
      gazetteId: gazette.id,
      error: pessoalResult.reason,
    })
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
        console.error('[analyzer] falha ao persistir finding', { type: finding.type, err })
      }

      const shouldPublish =
        finding.riskScore >= PUBLISH_RISK_THRESHOLD &&
        finding.confidence >= PUBLISH_CONFIDENCE_THRESHOLD

      if (shouldPublish) {
        try {
          await enqueueForPublish(finding)
          console.log('[analyzer] finding enfileirado para publicação', {
            type: finding.type,
            riskScore: finding.riskScore,
            confidence: finding.confidence,
            cityId: finding.cityId,
          })
        } catch (err) {
          console.error('[analyzer] falha ao enfileirar finding', { type: finding.type, err })
        }
      } else {
        console.log('[analyzer] finding descartado (abaixo do limiar)', {
          type: finding.type,
          riskScore: finding.riskScore,
          confidence: finding.confidence,
        })
      }
    }),
  )

  console.log('[analyzer] gazette processada', {
    gazetteId: gazette.id,
    cityId,
    findingsEspecializados: specializedFindings.length,
    findingsTotal: allFindings.length,
  })
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('[analyzer] iniciando', { records: event.Records.length })

  for (const record of event.Records) {
    try {
      await processRecord(record.body)
    } catch (err) {
      console.error('[analyzer] falha ao processar record — continuando próximo', {
        messageId: record.messageId,
        err,
      })
    }
  }
}
