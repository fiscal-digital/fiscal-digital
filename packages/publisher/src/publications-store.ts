import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb'
import type { ChannelName, PublishResult } from './channels/types'
import { AlreadyPublishedError } from './channels/types'

const ALERTS_TABLE = process.env.ALERTS_TABLE ?? 'fiscal-digital-alerts-prod'

/**
 * pk do item onde a publicação é registrada — é o PRÓPRIO item do FINDING.
 *
 * BUG #146: esta função retornava `ALERT#${findingId}`, um namespace que NUNCA
 * existiu na tabela (scan completo em 2026-08-02: 0 de 2.982 itens com prefixo
 * `ALERT#`). Como `ensurePublicationsMap` exige `attribute_exists(pk)`, toda
 * chamada a `recordPublication` lançaria erro e o publish iria para a DLQ — no
 * dia exato em que o DRY_RUN saísse. O defeito estava mascarado justamente
 * porque o publisher nunca chegou a gravar em produção.
 *
 * O `findingId` JÁ É o pk (`FINDING#{fiscalId}#{cityId}#{type}#{gazetteKey}`),
 * hidratado por `persistFinding` no analyzer. `markUnpublishable` sempre usou
 * esse pk direto — o comentário dela já apontava a divergência, tratando
 * `recordPublication` como "legacy".
 *
 * Consequência do bug além da DLQ: o atributo `published` nunca chegava ao item
 * FINDING#, então o `GSI4-risk-published` ficava vazio (ItemCount 0) e o feed
 * público não tinha como distinguir publicado de não publicado.
 */
function alertPk(findingId: string): string {
  return findingId
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

  /**
   * Marca um finding como `unpublishable` no DDB. Chamado quando o brand
   * gate rejeita a narrativa em todas as N tentativas de regeneração — o
   * finding fica preservado (audit trail) mas é filtrado do feed público
   * pela API.
   *
   * O pk usado é o do próprio FINDING# (mesmo item criado pelo analyzer) —
   * itens FINDING# são os que aparecem no /alerts. Desde a correção do #146,
   * `recordPublication` usa o mesmo namespace; a divergência que este
   * comentário apontava deixou de existir.
   */
  async markUnpublishable(
    findingPk: string,
    reason: string,
    hits: string[],
  ): Promise<void> {
    const hitList = hits.length
      ? { L: hits.map((h) => ({ S: h })) }
      : { L: [] as { S: string }[] }
    await this.client.send(
      new UpdateItemCommand({
        TableName: ALERTS_TABLE,
        Key: { pk: { S: findingPk } },
        UpdateExpression:
          'SET #unpub = :true, #reason = :reason, #hits = :hits, #unpubAt = :now',
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#unpub': 'unpublishable',
          '#reason': 'unpublishableReason',
          '#hits': 'unpublishableHits',
          '#unpubAt': 'unpublishableAt',
        },
        ExpressionAttributeValues: {
          ':true': { BOOL: true },
          ':reason': { S: reason },
          ':hits': hitList,
          ':now': { S: new Date().toISOString() },
        },
      }),
    )
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
