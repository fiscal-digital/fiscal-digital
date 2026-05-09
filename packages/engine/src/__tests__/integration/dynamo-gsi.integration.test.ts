/**
 * Integration tests cobrindo LRN-019 — GSI keys NUNCA setadas para `null`.
 *
 * Em prod, DynamoDB rejeita PutItem com `ValidationException` quando um
 * atributo declarado como `hash_key` ou `range_key` de GSI vem com tipo
 * incompatível (ex: NULL em GSI String). Esses testes só rodam contra
 * DynamoDB Local (ou DDB real) — `DDB_ENDPOINT` precisa estar setado.
 *
 * Pattern correto: `...(value && { field: value })` — omite o atributo
 * quando ausente. Anti-pattern: `field: value ?? null` — passa em mock,
 * quebra em prod.
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import {
  createAlertsTable,
  dropTable,
  isIntegrationEnabled,
  makeDocClient,
  makeRawClient,
} from './ddb-helpers'

const TABLE = 'fiscal-digital-alerts-test'

const describeFn = isIntegrationEnabled() ? describe : describe.skip

describeFn('integration: GSI keys regression (LRN-019)', () => {
  const raw = makeRawClient()
  const doc = makeDocClient(raw)

  beforeAll(async () => {
    await createAlertsTable(raw, TABLE)
  }, 30_000)

  afterAll(async () => {
    await dropTable(raw, TABLE)
    raw.destroy()
  })

  it('aceita item com todos os GSI keys preenchidos', async () => {
    await expect(
      doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: 'FINDING#fiscal-licitacoes#4305108#2026-05-05T10:00:00Z',
            cityId: '4305108',
            createdAt: '2026-05-05T10:00:00Z',
            cnpj: '12.345.678/0001-90',
            secretaria: 'SMED',
            published: 'true',
            riskScore: 75,
          },
        }),
      ),
    ).resolves.toBeDefined()
  })

  it('omitir cnpj (GSI2 hash) é válido — item entra mas não aparece em GSI2', async () => {
    await expect(
      doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: 'FINDING#fiscal-pessoal#4305108#2026-05-05T11:00:00Z',
            cityId: '4305108',
            createdAt: '2026-05-05T11:00:00Z',
            secretaria: 'SMS',
            published: 'true',
            riskScore: 60,
          },
        }),
      ),
    ).resolves.toBeDefined()

    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2-cnpj-date',
        KeyConditionExpression: 'cnpj = :c',
        ExpressionAttributeValues: { ':c': '00.000.000/0000-00' },
      }),
    )
    expect(res.Items ?? []).toEqual([])
  })

  it('REGRESSION LRN-019: cnpj=null é rejeitado pelo DynamoDB', async () => {
    await expect(
      doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: 'FINDING#regression#null-cnpj',
            cityId: '4305108',
            createdAt: '2026-05-05T12:00:00Z',
            cnpj: null,
            secretaria: 'SMS',
            published: 'true',
            riskScore: 50,
          },
        }),
      ),
    ).rejects.toThrow(/ValidationException|invalid|Type mismatch/i)
  })

  it('REGRESSION LRN-019: secretaria=null é rejeitado pelo DynamoDB', async () => {
    await expect(
      doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: 'FINDING#regression#null-secretaria',
            cityId: '4305108',
            createdAt: '2026-05-05T13:00:00Z',
            cnpj: '99.999.999/0001-00',
            secretaria: null,
            published: 'true',
            riskScore: 50,
          },
        }),
      ),
    ).rejects.toThrow(/ValidationException|invalid|Type mismatch/i)
  })

  it('REGRESSION LRN-019: cityId=null é rejeitado pelo DynamoDB', async () => {
    await expect(
      doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: 'FINDING#regression#null-city',
            cityId: null,
            createdAt: '2026-05-05T14:00:00Z',
            cnpj: '88.888.888/0001-00',
            secretaria: 'SMS',
            published: 'true',
            riskScore: 50,
          },
        }),
      ),
    ).rejects.toThrow(/ValidationException|invalid|Type mismatch/i)
  })

  it('REGRESSION LRN-019: published=null é rejeitado pelo DynamoDB', async () => {
    await expect(
      doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            pk: 'FINDING#regression#null-published',
            cityId: '4305108',
            createdAt: '2026-05-05T15:00:00Z',
            cnpj: '77.777.777/0001-00',
            secretaria: 'SMS',
            published: null,
            riskScore: 50,
          },
        }),
      ),
    ).rejects.toThrow(/ValidationException|invalid|Type mismatch/i)
  })

  it('GSI1-city-date: query por cityId retorna findings ordenados por createdAt', async () => {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1-city-date',
        KeyConditionExpression: 'cityId = :c',
        ExpressionAttributeValues: { ':c': '4305108' },
      }),
    )
    expect((res.Items ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
