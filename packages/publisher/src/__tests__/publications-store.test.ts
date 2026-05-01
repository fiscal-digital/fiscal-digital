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
