# Correlation ID — `gazetteId` end-to-end

`gazetteId` é o identificador estável de uma `GAZETTE#{cityId}#{date}#{idx}` propagado pelas 3 Lambdas para correlacionar logs.

## Fluxo

```
collector
  └─ markQueued(gazette)
       SQS gazettes-queue
         MessageAttributes.gazetteId = gazette.id

analyzer
  └─ logger.appendKeys({ gazetteId })
       → todos os logs subsequentes carregam gazetteId
  └─ enqueueForPublish(finding, gazetteId)
       SQS alerts-queue
         MessageAttributes.gazetteId = gazette.id (NÃO finding.id)

publisher
  └─ const gazetteId = record.messageAttributes?.['gazetteId']?.stringValue
  └─ logger.appendKeys({ gazetteId })
       → todos os logs do registro carregam gazetteId
  └─ logger.removeKeys(['gazetteId']) ao fim do registro (evita leak entre records)
```

## Por que `gazetteId` e não `finding.id`

- 1 gazette → N findings. `finding.id` é granular demais para correlação cross-Lambda.
- LRN-20260503-024 — testar propagação no **último hop** (publisher), não só no primeiro.

## Query CloudWatch Insights — debug por gazette

```
fields @timestamp, service, message, @logStream
| filter gazetteId = "4305108#2026-04-15#1"
| sort @timestamp asc
```

Substitua `4305108#2026-04-15#1` pelo ID alvo. Rode em todos os log groups simultaneamente:
- `/aws/lambda/fiscal-digital-collector-prod`
- `/aws/lambda/fiscal-digital-analyzer-prod`
- `/aws/lambda/fiscal-digital-publisher-prod`

## Query — encontrar gazettes que travaram (analisadas mas não publicadas)

```
fields @timestamp, gazetteId
| filter service = "analyzer" and message like /finding enfileirado/
| stats count(*) as analyzed by gazetteId
| join (fields gazetteId | filter service = "publisher" and message like /publicado|unpublishable/ | stats count(*) as published by gazetteId) on gazetteId
| filter analyzed > published
```

## Query — taxa de brand-gate fail por dia

```
fields @timestamp, gazetteId
| filter service = "publisher" and message = "brand gate exaurido — marcando unpublishable"
| stats count(*) as exhausted by bin(1d)
```

## Implementação relevante

- [packages/analyzer/src/index.ts:enqueueForPublish](../packages/analyzer/src/index.ts) — analyzer enfileira `MessageAttributes.gazetteId`
- [packages/publisher/src/index.ts](../packages/publisher/src/index.ts#L56) — publisher lê `record.messageAttributes?.['gazetteId']?.stringValue` e chama `logger.appendKeys({ gazetteId })`
- [packages/collector/src/collector.ts](../packages/collector/src/collector.ts#L88) — collector enfileira no primeiro hop

## LRNs

- **LRN-20260503-024** — Correlation ID multi-hop SQS: testar propagação no ÚLTIMO hop
