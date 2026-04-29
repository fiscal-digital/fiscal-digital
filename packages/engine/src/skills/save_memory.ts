import { putItem } from '../utils/dynamodb'
import type { Skill, SkillResult } from '../types'

export interface SaveMemoryInput {
  pk: string
  table: string
  item: Record<string, unknown>
}

export const saveMemory: Skill<SaveMemoryInput> = {
  name: 'save_memory',
  description: 'Salva entidade ou achado no DynamoDB',

  async execute(input: SaveMemoryInput): Promise<SkillResult<void>> {
    await putItem(input.table, { pk: input.pk, ...input.item })
    return {
      data: undefined,
      source: `dynamodb:${input.table}#${input.pk}`,
      confidence: 1.0,
    }
  },
}
