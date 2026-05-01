import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb'
import type { ChannelName, PublishResult } from './channels/types'
import { AlreadyPublishedError } from './channels/types'

const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'

function alertPk(findingId: string): string {
  return `ALERT#${findingId}`
}

export class PublicationsStore {
  constructor(private readonly client: DynamoDBClient = new DynamoDBClient({})) {}

  /**
   * Pre-check antes de chamar a API do canal.
   * Evita chamada paga / efeito colateral (post duplicado) quando finding já foi publicado.
   */
  async alreadyPublished(findingId: string, channel: ChannelName): Promise<boolean> {
    const res = await this.client.send(
      new GetItemCommand({
        TableName: ALERTS_TABLE,
        Key: { pk: { S: alertPk(findingId) } },
        ProjectionExpression: '#publications.#channel',
        ExpressionAttributeNames: {
          '#publications': 'publications',
          '#channel': channel,
        },
      }),
    )
    return res.Item?.publications?.M?.[channel] != null
  }

  /**
   * Grava o resultado de publicação. DynamoDB exige que pais de paths aninhados existam,
   * então inicializamos `publications = {}` se ausente (1ª escrita) antes do SET aninhado.
   * A 2ª escrita carrega ConditionExpression atômica que falha se o canal já foi gravado —
   * convertida em AlreadyPublishedError.
   */
  async recordPublication(findingId: string, result: PublishResult): Promise<void> {
    const pk = alertPk(findingId)

    // 1) Garante que publications existe como Map. Idempotente.
    await this.ensurePublicationsMap(pk)

    // 2) Grava resultado do canal com guarda de idempotência.
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: ALERTS_TABLE,
          Key: { pk: { S: pk } },
          UpdateExpression:
            'SET #publications.#channel = :result, #published = :true, #publishedAt = if_not_exists(#publishedAt, :now)',
          ConditionExpression: 'attribute_not_exists(#publications.#channel)',
          ExpressionAttributeNames: {
            '#publications': 'publications',
            '#channel': result.channel,
            '#published': 'published',
            '#publishedAt': 'publishedAt',
          },
          ExpressionAttributeValues: {
            ':result': {
              M: {
                externalId: { S: result.externalId },
                url: { S: result.url },
                publishedAt: { S: result.publishedAt },
              },
            },
            ':true': { S: 'true' },
            ':now': { S: result.publishedAt },
          },
        }),
      )
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new AlreadyPublishedError(result.channel, findingId)
      }
      throw err
    }
  }

  private async ensurePublicationsMap(pk: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: ALERTS_TABLE,
          Key: { pk: { S: pk } },
          UpdateExpression: 'SET #publications = :empty',
          ConditionExpression:
            'attribute_exists(#pk) AND attribute_not_exists(#publications)',
          ExpressionAttributeNames: {
            '#pk': 'pk',
            '#publications': 'publications',
          },
          ExpressionAttributeValues: {
            ':empty': { M: {} },
          },
        }),
      )
    } catch (err) {
      // ConditionalCheckFailed = publications já existe, OK.
      // Se o item nem existe (pk ausente), erro real → propaga.
      if (err instanceof ConditionalCheckFailedException) {
        // Distinguir: o item existe sem publications? Ou o item não existe?
        // GetItem rápido para validar.
        const res = await this.client.send(
          new GetItemCommand({
            TableName: ALERTS_TABLE,
            Key: { pk: { S: pk } },
            ProjectionExpression: '#pk',
            ExpressionAttributeNames: { '#pk': 'pk' },
          }),
        )
        if (!res.Item) {
          throw new Error(`Finding ${pk} não existe no DynamoDB — publisher chamado antes do analyzer persistir`)
        }
        return
      }
      throw err
    }
  }
}
