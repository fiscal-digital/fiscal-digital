import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'

const raw = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.DDB_ENDPOINT
    ? {
        endpoint: process.env.DDB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {}),
})
// removeUndefinedValues: entidades extraídas por LLM têm campos opcionais
// undefined em maps aninhados (ex: entities.cnpj) — sem esta opção o marshaller
// lança e o cache de extração nunca é salvo (toda reanálise paga Bedrock de novo).
// Não afeta LRN-019: GSI keys continuam omitidas, nunca null.
export const docClient = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
})

export async function getItem(
  table: string,
  pk: string,
): Promise<Record<string, unknown> | null> {
  const res = await docClient.send(new GetCommand({ TableName: table, Key: { pk } }))
  return (res.Item as Record<string, unknown>) ?? null
}

export async function putItem(
  table: string,
  item: Record<string, unknown>,
): Promise<void> {
  await docClient.send(new PutCommand({ TableName: table, Item: item }))
}

export async function queryIndex(
  table: string,
  indexName: string,
  keyCondition: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
  limit?: number,
): Promise<Record<string, unknown>[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: indexName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ...(limit != null ? { Limit: limit } : {}),
    }),
  )
  return (res.Items as Record<string, unknown>[]) ?? []
}
