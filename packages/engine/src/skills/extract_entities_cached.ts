import { createHash } from 'crypto'
import { extractEntities } from './extract_entities'
import { lookupMemory } from './lookup_memory'
import { saveMemory } from './save_memory'
import type { ExtractedEntities, Skill, SkillResult } from '../types'

export interface ExtractEntitiesCachedInput {
  text: string
  gazetteUrl: string
}

/** Versão atual do schema de ExtractedEntities. Bumpar quando schema mudar. */
export const EXTRACTION_SCHEMA_VERSION = 1

const ENTITIES_TABLE = process.env.ENTITIES_TABLE ?? 'fiscal-digital-entities-prod'

function hashText(text: string): string {
  return createHash('md5').update(text).digest('hex').slice(0, 16)
}

interface CachedItem {
  entities?: ExtractedEntities
  confidence?: number
  schemaVersion?: number
  cachedAt?: string
}

/**
 * Cria wrapper cacheado de `extractEntities` escopado a uma gazette.
 *
 * Cache em 2 níveis:
 *   1. Memória (per-Lambda invocation) — elimina chamadas duplicadas entre Fiscais
 *   2. DynamoDB `entities-prod` — permite re-análise sem re-extração
 *
 * Schema versioning: cache hit invalidado se `cached.schemaVersion < EXTRACTION_SCHEMA_VERSION`.
 *
 * Métricas exportadas via console.log com prefixo `[cache]` — facil parsear de CloudWatch
 * para calcular hit rate posteriormente.
 *
 * Quando um novo Fiscal é adicionado e re-roda análise sobre o histórico:
 *   - Cache hit em 100% (excerpts não mudam)
 *   - Custo Bedrock: $0
 */
export function createCachedExtractEntities(opts: {
  gazetteId: string
  table?: string
}): Skill<ExtractEntitiesCachedInput, ExtractedEntities> {
  const memCache = new Map<string, SkillResult<ExtractedEntities>>()
  const table = opts.table ?? ENTITIES_TABLE

  return {
    name: 'extract_entities_cached',
    description: 'extract_entities com cache em memória + DynamoDB entities-prod',

    async execute(input: ExtractEntitiesCachedInput): Promise<SkillResult<ExtractedEntities>> {
      const hash = hashText(input.text)
      const ddbKey = `EXTRACTION#${opts.gazetteId}#${hash}`

      // 1. Memória — duplicate calls dentro do mesmo Lambda
      const memHit = memCache.get(hash)
      if (memHit) {
        console.log('[cache] hit=memory', { gazetteId: opts.gazetteId, hash })
        return memHit
      }

      // 2. DynamoDB — re-runs com novo Fiscal
      try {
        const { data } = await lookupMemory.execute({ pk: ddbKey, table })
        const cached = data as CachedItem | null
        if (
          cached?.entities &&
          (cached.schemaVersion ?? 0) >= EXTRACTION_SCHEMA_VERSION
        ) {
          const result: SkillResult<ExtractedEntities> = {
            data: cached.entities,
            source: input.gazetteUrl,
            confidence: cached.confidence ?? 0.85,
          }
          memCache.set(hash, result)
          console.log('[cache] hit=ddb', { gazetteId: opts.gazetteId, hash })
          return result
        }
      } catch (err) {
        console.error('[cache] lookup failed', { hash, err: (err as Error).message })
      }

      // 3. Bedrock — primeira vez para este excerpt (ou schema mudou)
      console.log('[cache] miss', { gazetteId: opts.gazetteId, hash })
      const result = await extractEntities.execute(input)

      // 4. Persistir cache (best-effort, não bloqueia o fluxo)
      try {
        await saveMemory.execute({
          pk: ddbKey,
          table,
          item: {
            entities: result.data,
            confidence: result.confidence,
            schemaVersion: EXTRACTION_SCHEMA_VERSION,
            cachedAt: new Date().toISOString(),
          },
        })
      } catch (err) {
        console.error('[cache] save failed', { hash, err: (err as Error).message })
      }

      memCache.set(hash, result)
      return result
    },
  }
}
