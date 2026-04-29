import { getItem } from '../utils/dynamodb'
import type { Skill, SkillResult } from '../types'

export interface LookupMemoryInput {
  pk: string
  table: string
}

export const lookupMemory: Skill<LookupMemoryInput, Record<string, unknown> | null> = {
  name: 'lookup_memory',
  description: 'Consulta histórico de entidade no DynamoDB',

  async execute(input: LookupMemoryInput): Promise<SkillResult<Record<string, unknown> | null>> {
    const item = await getItem(input.table, input.pk)
    return {
      data: item,
      source: `dynamodb:${input.table}#${input.pk}`,
      confidence: 1.0,
    }
  },
}
