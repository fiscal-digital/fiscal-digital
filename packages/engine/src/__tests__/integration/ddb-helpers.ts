import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

export function isIntegrationEnabled(): boolean {
  return !!process.env.DDB_ENDPOINT
}

export function makeRawClient(): DynamoDBClient {
  return new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.DDB_ENDPOINT,
    credentials: { accessKeyId: 'dummy', secretAccessKey: 'dummy' },
  })
}

export function makeDocClient(raw: DynamoDBClient): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(raw)
}

export async function dropTable(raw: DynamoDBClient, name: string): Promise<void> {
  try {
    await raw.send(new DeleteTableCommand({ TableName: name }))
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e
  }
}

export async function tableExists(raw: DynamoDBClient, name: string): Promise<boolean> {
  try {
    await raw.send(new DescribeTableCommand({ TableName: name }))
    return true
  } catch (e) {
    if (e instanceof ResourceNotFoundException) return false
    throw e
  }
}

export async function createAlertsTable(raw: DynamoDBClient, name: string): Promise<void> {
  await dropTable(raw, name)
  await raw.send(
    new CreateTableCommand({
      TableName: name,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'cityId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
        { AttributeName: 'cnpj', AttributeType: 'S' },
        { AttributeName: 'secretaria', AttributeType: 'S' },
        { AttributeName: 'published', AttributeType: 'S' },
        { AttributeName: 'riskScore', AttributeType: 'N' },
      ],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1-city-date',
          KeySchema: [
            { AttributeName: 'cityId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2-cnpj-date',
          KeySchema: [
            { AttributeName: 'cnpj', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI3-secretaria-date',
          KeySchema: [
            { AttributeName: 'secretaria', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI4-risk-published',
          KeySchema: [
            { AttributeName: 'published', KeyType: 'HASH' },
            { AttributeName: 'riskScore', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  )
}
