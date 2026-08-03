import {
  ConditionalCheckFailedException,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'
import { PublicationsStore } from '../publications-store'
import { AlreadyPublishedError } from '../channels/types'
import type { PublishResult } from '../channels/types'

function makeMockClient() {
  const send = jest.fn()
  return {
    send,
    client: { send } as unknown as ConstructorParameters<typeof PublicationsStore>[0],
  }
}

const PUBLISH_RESULT: PublishResult = {
  channel: 'x',
  externalId: 'tweet-123',
  url: 'https://x.com/LiFiscalDigital/status/tweet-123',
  publishedAt: '2026-05-01T10:00:00.000Z',
}

describe('PublicationsStore.alreadyPublished', () => {
  it('retorna true quando publications.<channel> existe', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValueOnce({
      Item: { publications: { M: { x: { M: { externalId: { S: 'tweet-123' } } } } } },
    })

    const store = new PublicationsStore(client)
    const result = await store.alreadyPublished('finding-001', 'x')

    expect(result).toBe(true)
    const call = send.mock.calls[0][0]
    expect(call).toBeInstanceOf(GetItemCommand)
  })

  it('retorna false quando item existe mas publications.<channel> ausente', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValueOnce({ Item: { publications: { M: {} } } })

    const store = new PublicationsStore(client)
    expect(await store.alreadyPublished('finding-001', 'x')).toBe(false)
  })

  it('retorna false quando item não existe', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValueOnce({})

    const store = new PublicationsStore(client)
    expect(await store.alreadyPublished('finding-001', 'x')).toBe(false)
  })
})

describe('PublicationsStore.recordPublication', () => {
  it('faz 2 UpdateItems: ensure publications map + set channel', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValueOnce({}) // ensurePublicationsMap success
    send.mockResolvedValueOnce({}) // SET publications.x success

    const store = new PublicationsStore(client)
    await store.recordPublication('finding-001', PUBLISH_RESULT)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toBeInstanceOf(UpdateItemCommand)
    expect(send.mock.calls[1][0]).toBeInstanceOf(UpdateItemCommand)
  })

  it('converte ConditionalCheckFailed na 2ª update em AlreadyPublishedError', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValueOnce({}) // ensure ok
    send.mockRejectedValueOnce(
      new ConditionalCheckFailedException({
        $metadata: {},
        message: 'duplicate',
      }),
    )

    const store = new PublicationsStore(client)
    await expect(
      store.recordPublication('finding-001', PUBLISH_RESULT),
    ).rejects.toBeInstanceOf(AlreadyPublishedError)
  })

  it('tolera ConditionalCheckFailed na 1ª update se item já tem publications', async () => {
    const { send, client } = makeMockClient()
    // 1ª update: falha porque publications já existe
    send.mockRejectedValueOnce(
      new ConditionalCheckFailedException({
        $metadata: {},
        message: 'publications already set',
      }),
    )
    // GetItem confirma que pk existe
    send.mockResolvedValueOnce({ Item: { pk: { S: 'ALERT#finding-001' } } })
    // 2ª update: SET do canal sucede
    send.mockResolvedValueOnce({})

    const store = new PublicationsStore(client)
    await expect(
      store.recordPublication('finding-001', PUBLISH_RESULT),
    ).resolves.toBeUndefined()
  })

  it('lança erro se item não existe (ConditionalCheckFailed na 1ª + GetItem vazio)', async () => {
    const { send, client } = makeMockClient()
    send.mockRejectedValueOnce(
      new ConditionalCheckFailedException({
        $metadata: {},
        message: 'item missing',
      }),
    )
    send.mockResolvedValueOnce({}) // GetItem vazio = item não existe

    const store = new PublicationsStore(client)
    await expect(
      store.recordPublication('finding-001', PUBLISH_RESULT),
    ).rejects.toThrow(/não existe no DynamoDB/)
  })
})

// ─── #146 — pk da publicação é o próprio FINDING# ───────────────────────────
//
// `alertPk` retornava `ALERT#${findingId}`, namespace que NUNCA existiu na
// tabela: scan completo em 2026-08-02 achou 0 de 2.982 itens com esse prefixo.
// Como `ensurePublicationsMap` exige `attribute_exists(pk)`, todo
// `recordPublication` lançaria — e o publish iria para a DLQ no dia em que o
// DRY_RUN saísse. Consequência colateral: `published` nunca chegava ao item
// FINDING#, deixando o `GSI4-risk-published` com ItemCount 0.
//
// O pk real vem de `persistFinding` (analyzer): FINDING#{fiscalId}#{cityId}#{type}#{gazetteKey}
const FINDING_PK = 'FINDING#fiscal-licitacoes#4305108#dispensa_irregular#4305108#2026-03-15#abc123'

describe('#146 — pk da publicação', () => {
  it('REGRESSÃO: recordPublication grava no pk do FINDING#, nunca em ALERT#', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValue({})

    const store = new PublicationsStore(client)
    await store.recordPublication(FINDING_PK, PUBLISH_RESULT)

    // Toda chamada ao DDB tem de usar o pk do FINDING# — nenhuma pode inventar
    // namespace novo, senão o item não existe e a condição de guarda falha.
    expect(send.mock.calls.length).toBeGreaterThan(0)
    for (const [cmd] of send.mock.calls) {
      const pk = cmd.input?.Key?.pk?.S
      expect(pk).toBe(FINDING_PK)
      expect(pk).not.toMatch(/^ALERT#/)
    }
  })

  it('REGRESSÃO: alreadyPublished consulta o mesmo pk que recordPublication grava', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValue({ Item: {} })

    const store = new PublicationsStore(client)
    await store.alreadyPublished(FINDING_PK, 'x')

    expect(send.mock.calls[0][0].input?.Key?.pk?.S).toBe(FINDING_PK)
  })

  it('grava published como String — GSI4 tem published como hash_key e chave não aceita BOOL', async () => {
    const { send, client } = makeMockClient()
    send.mockResolvedValue({})

    const store = new PublicationsStore(client)
    await store.recordPublication(FINDING_PK, PUBLISH_RESULT)

    // O UpdateItem que grava o resultado do canal também seta `published`.
    const comPublished = send.mock.calls
      .map(([c]) => c)
      .find((c) => String(c.input?.UpdateExpression ?? '').includes('#published'))
    expect(comPublished).toBeDefined()
    // terraform/modules/dynamodb/main.tf:36-39 declara published com type = "S"
    expect(comPublished.input.ExpressionAttributeValues[':true']).toEqual({ S: 'true' })
  })
})
