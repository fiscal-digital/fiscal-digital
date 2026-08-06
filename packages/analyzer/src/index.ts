import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { SQSEvent } from 'aws-lambda'
import {
  fiscalLicitacoes,
  fiscalContratos,
  fiscalFornecedores,
  fiscalFornecedoresV2,
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
  querySuppliersContract,
  queryConcentracaoGSI2,
  gazetteKey,
  requireEnv,
  createLogger,
  getPublishThresholds,
  isFeatureEnabled,
  maybeWriteSupplier,
} from '@fiscal-digital/engine'
import type {
  CollectorMessage,
  Finding,
  FiscalContext,
  FiscalContextV2,
  Gazette,
} from '@fiscal-digital/engine'

// ---------------------------------------------------------------------------
// AWS clients (module-scope — reutilizado em warm starts)
// ---------------------------------------------------------------------------

const sqsClient = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
const s3Client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const GAZETTES_CACHE_BUCKET = process.env.GAZETTES_CACHE_BUCKET ?? 'fiscal-digital-gazettes-cache-prod'

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

/** @returns true se persistiu; false quando o finding não tem fonte estável. */
async function persistFinding(finding: Finding): Promise<boolean> {
  const createdAt = finding.createdAt ?? new Date().toISOString()
  // Idempotência: pk derivado da gazette de origem (não do timestamp).
  // Reprocessamento da mesma gazette sobrescreve o finding em vez de criar
  // duplicata.
  //
  // TEC-ANL-001: o fallback antigo (`stableKey ?? createdAt`) violava a
  // idempotência — cada reanálise criava um item NOVO com pk-timestamp
  // (duplicação silenciosa) — e um finding sem URL de fonte válida fere o
  // princípio "sempre citar a fonte" (não é publicável nem verificável).
  // Agora: sem stableKey → não persiste, loga ERROR com contexto (o alarme
  // analyzer-errors não dispara por log, mas a métrica fica rastreável via
  // CloudWatch Insights).
  const sourceUrl = finding.evidence?.[0]?.source
  const stableKey = sourceUrl ? gazetteKey(sourceUrl) : null
  if (!stableKey) {
    logger.error('finding sem fonte estável — não persistido (TEC-ANL-001)', {
      fiscalId: finding.fiscalId,
      cityId: finding.cityId,
      type: finding.type,
      sourceUrl: sourceUrl ?? null,
    })
    return false
  }
  const pk = `FINDING#${finding.fiscalId}#${finding.cityId}#${finding.type}#${stableKey}`
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
  await writeSupplierFromFinding(finding)
  return true
}

const SUPPLIERS_TABLE = process.env.SUPPLIERS_TABLE ?? 'fiscal-digital-suppliers-prod'

/**
 * Deriva um registro de fornecedor do Finding e delega `maybeWriteSupplier`
 * (engine), que aplica a feature flag e o gate de qualidade de dado.
 *
 * ## Por que isto substituiu o writer local (EVO-005, 2026-07-25)
 *
 * Havia dois writers para a mesma tabela. O local, que rodou de 2026-05-09 a
 * 2026-07-25, gravou 251 registros e **nenhum** era legível:
 *
 *   - `pk` COM MÁSCARA em 250 deles (`SUPPLIER#02.321.000/0001-19`) enquanto o
 *     leitor `querySuppliersContract` consulta a pk normalizada → nunca achava nada.
 *   - `contractedAt` = timestamp da ANÁLISE, não a data do contrato → corrompia
 *     o cálculo de aditivo% e a janela de 12 meses do GSI2.
 *   - gravava `secretariaCityKey` em vez de `secretariaId`/`mesCNPJ` → o
 *     `GSI2_ConcentracaoSecretaria` ficou 100% vazio (0 de 359 itens).
 *   - `contractId` = a pk inteira do FINDING, não um número de contrato.
 *
 * A skill do engine é a fonte única: normalização de CNPJ byte-a-byte idêntica
 * à do leitor, chaves derivadas do contrato (idempotência real) e gate que
 * **pula** o registro parcial em vez de gravá-lo pela metade.
 *
 * ## Estado conhecido: o gate pula quase tudo hoje
 *
 * `Finding` não carrega `contractedAt` — nenhum Fiscal popula o campo, porque a
 * extração devolve `dates: string[]` sem rotular qual é a data de assinatura.
 * Sem ela a skill responde `contracted_at_invalido` e não grava. Isso é
 * proposital: não gravar é melhor do que gravar com a data errada, que foi o
 * defeito original. Acender aditivo% e concentração depende de a extração passar
 * a produzir `contractedAt` + `contractNumber` — trabalho separado.
 *
 * Best-effort: falha de write nunca derruba o finding.
 */
async function writeSupplierFromFinding(finding: Finding): Promise<void> {
  if (!finding.cnpj) return
  try {
    const result = await maybeWriteSupplier.execute({
      cnpj: finding.cnpj,
      cityId: finding.cityId,
      contractNumber: finding.contractNumber ?? '',
      contractedAt: finding.contractedAt ?? '',
      valueAmount: finding.value ?? 0,
      secretaria: finding.secretaria ?? '',
      sourceFindingId: finding.id,
      table: SUPPLIERS_TABLE,
    })
    const { written, skipReason } = result.data
    // `feature_flag_off` é no-op esperado e não vira log (a skill já silencia).
    if (!written && skipReason && skipReason !== 'feature_flag_off') {
      logger.info('supplier nao gravado — registro incompleto', {
        reason: skipReason,
        findingId: finding.id,
        fiscalId: finding.fiscalId,
      })
    }
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

/**
 * Fase 0 da camada raw: resolve o texto da mensagem.
 *
 * Precedência: excerpts inline (mensagens antigas / rollback) > ponteiro S3.
 * O conteúdo é IDÊNTICO nos dois caminhos — esta fase muda só o transporte,
 * nunca o que os Fiscais veem; os thresholds calibrados para ~300 chars
 * continuam válidos (a mudança de conteúdo é a Fase 1, com filtro versionado).
 *
 * Falha na resolução LANÇA de propósito — degradar para lista vazia
 * esconderia gazette não analisada como "analisada sem findings".
 *
 * ⚠️ Semântica atual do handler: o erro é LOGADO e o record PULADO (mesmo
 * tratamento do body inválido) — não há retry nem DLQ, porque o handler
 * engole erros de record para não envenenar o batch. Isso é aceitável
 * enquanto as mensagens carregam excerpts inline (o ponteiro é caminho
 * alternativo); ANTES de ligar mensagens só-ponteiro no collector, o handler
 * precisa migrar para partial batch response (ReportBatchItemFailures), senão
 * um soluço de S3 perde gazette em silêncio. Ver issue de Fase 0.
 */
export async function resolveExcerpts(msg: CollectorMessage): Promise<string[]> {
  if (msg.excerpts && msg.excerpts.length > 0) return msg.excerpts
  if (msg.excerptsS3Key) {
    const out = await s3Client.send(new GetObjectCommand({
      Bucket: GAZETTES_CACHE_BUCKET,
      Key: msg.excerptsS3Key,
    }))
    const raw = await out.Body?.transformToString('utf-8')
    if (!raw) throw new Error(`excerptsS3Key ${msg.excerptsS3Key}: objeto vazio`)
    const parsed = JSON.parse(raw) as { excerpts?: string[] }
    if (!Array.isArray(parsed.excerpts) || parsed.excerpts.length === 0) {
      throw new Error(`excerptsS3Key ${msg.excerptsS3Key}: JSON sem excerpts[]`)
    }
    return parsed.excerpts
  }
  throw new Error(`mensagem sem excerpts nem excerptsS3Key (gazetteId=${msg.gazetteId})`)
}

function toGazette(msg: CollectorMessage, excerpts: string[]): Gazette {
  return {
    id: msg.gazetteId,
    territory_id: msg.territory_id,
    date: msg.date,
    url: msg.url,
    excerpts,
  }
}

// ---------------------------------------------------------------------------
// Build FiscalContext with real skills injected
// ---------------------------------------------------------------------------

function buildContext(gazetteId: string): FiscalContextV2 {
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
    // ADR-001 Contratos follow-up — cross-ref valor original em suppliers-prod.
    // Skill consulta DDB Query por pk=SUPPLIER#{cnpj} + filtra contractNumber+cityId.
    querySuppliersContract: input => querySuppliersContract.execute(input),
    // FiscalFornecedores v2 — GSI2 query injetado no contexto para testabilidade.
    // Quando feature flag OFF, buildContext ainda inclui a função (custo zero),
    // mas ela nunca é chamada porque fiscalFornecedores (v1) não conhece este campo.
    queryConcentracaoGSI2,
  }
}

// ---------------------------------------------------------------------------
// Process a single SQS record
// ---------------------------------------------------------------------------

async function processRecord(body: string): Promise<void> {
  const msg = JSON.parse(body) as CollectorMessage
  const gazette = toGazette(msg, await resolveExcerpts(msg))
  const cityId = msg.territory_id
  const ctx = buildContext(gazette.id)

  // UH-22 Phase 2: state tracking. Se enabledFiscals presente, roda só esses
  // (re-analyze de Fiscal novo sem re-executar os demais).
  const enabled = msg.enabledFiscals
  const shouldRun = (id: string): boolean => !enabled || enabled.includes(id)

  // FiscalFornecedores: v2 se feature flag ON, v1 caso contrário.
  // O check SSM é cacheado em memória (cold start) via isFeatureEnabled,
  // portanto não adiciona latência a warm invocations.
  const useFornecedoresV2 = await isFeatureEnabled('enable-fiscal-fornecedores-v2')
  const activeFornecedor = useFornecedoresV2 ? fiscalFornecedoresV2 : fiscalFornecedores

  if (useFornecedoresV2) {
    logger.info('FiscalFornecedores v2 ativo (feature flag ON)')
  }

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
    shouldRun('fiscal-fornecedores') ? activeFornecedor.analisar({ gazette, cityId, context: ctx }) : Promise.resolve([]),
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
      let persisted = false
      try {
        persisted = await persistFinding(finding)
      } catch (err) {
        logger.error('falha ao persistir finding', { type: finding.type, err })
      }

      const { riskThreshold, confidenceThreshold } = await getPublishThresholds()
      // TEC-ANL-001: finding sem fonte estável não persiste nem publica —
      // "sempre citar a fonte" vale para o feed também.
      const shouldPublish =
        persisted &&
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
