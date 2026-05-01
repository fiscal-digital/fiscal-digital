import type { Finding, Gazette } from '../types'
import type { extractEntities as _extractEntities } from '../skills/extract_entities'
import type { saveMemory as _saveMemory } from '../skills/save_memory'

export interface FiscalContext {
  alertsTable?: string                                                      // default 'fiscal-digital-alerts-prod'
  now?: () => Date                                                          // default () => new Date()
  extractEntities?: typeof _extractEntities                                 // permite mock em teste
  queryAlertsByCnpj?: (cnpj: string, sinceISO: string) => Promise<Finding[]>  // injetável p/ teste
  generateNarrative?: (...args: unknown[]) => Promise<string>               // mock em teste
  saveMemory?: typeof _saveMemory                                           // permite mock em teste
}

export interface AnalisarInput {
  gazette: Gazette
  cityId: string
  context?: FiscalContext
}

export interface Fiscal {
  id: string
  description: string
  analisar(input: AnalisarInput): Promise<Finding[]>
}
