/**
 * Regression: cache de extração nunca salvava em prod — o marshaller do
 * lib-dynamodb lança `Pass options.removeUndefinedValues=true` quando o item
 * tem `undefined` em map aninhado (entities.cnpj etc., campos opcionais do
 * output LLM). Sintoma em prod: `ERROR cache save failed` em toda invocação
 * do analyzer; efeito: toda reanálise re-paga Bedrock (cache hit 0%).
 *
 * O caminho testado é o de prod: saveMemory → putItem → docClient compartilhado
 * (utils/dynamodb.ts), que precisa de `marshallOptions.removeUndefinedValues`.
 */

import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { getItem, putItem } from '../../utils/dynamodb'
import { dropTable, isIntegrationEnabled } from './ddb-helpers'

const TABLE = 'fiscal-digital-entities-test'

const describeFn = isIntegrationEnabled() ? describe : describe.skip

describeFn('integration: putItem com undefined aninhado (cache save failed)', () => {
  // NÃO usar makeRawClient (credenciais 'dummy'): o DDB Local sem -sharedDb
  // particiona tabelas por accessKeyId+region. Como o teste exercita o
  // docClient de produção (utils/dynamodb, credenciais 'local' sob
  // DDB_ENDPOINT), a tabela precisa ser criada no mesmo namespace.
  const raw = new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.DDB_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  })

  beforeAll(async () => {
    await dropTable(raw, TABLE)
    await raw.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      }),
    )
  }, 30_000)

  afterAll(async () => {
    await dropTable(raw, TABLE)
    raw.destroy()
  })

  it('salva item de cache com campos undefined no map entities', async () => {
    const pk = 'EXTRACTION#4305108#2026-07-17#1#deadbeef00000000'
    await putItem(TABLE, {
      pk,
      entities: {
        tipoAto: 'dispensa',
        valor: 179000,
        cnpj: undefined,
        secretaria: undefined,
      },
      confidence: 0.85,
      schemaVersion: 1,
      cachedAt: '2026-07-20T12:00:00.000Z',
    })

    const saved = await getItem(TABLE, pk)
    expect(saved).not.toBeNull()
    const entities = saved?.entities as Record<string, unknown>
    expect(entities.tipoAto).toBe('dispensa')
    expect(entities.valor).toBe(179000)
    // undefined é removido, não persistido como null
    expect('cnpj' in entities).toBe(false)
  })

  it('mantém omissão de atributos undefined no topo do item (LRN-019)', async () => {
    const pk = 'EXTRACTION#topo-undefined'
    await putItem(TABLE, { pk, cnpj: undefined, createdAt: '2026-07-20T12:00:00.000Z' })
    const saved = await getItem(TABLE, pk)
    expect(saved).not.toBeNull()
    expect(saved && 'cnpj' in saved).toBe(false)
  })
})
