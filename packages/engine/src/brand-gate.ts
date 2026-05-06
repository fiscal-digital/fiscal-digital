import glossaryRaw from './brand/glossary.json'

interface AvoidEntry { 'pt-br': string; 'en-us': string; reason: string; use_instead: string[] }
interface GlossaryFile { avoid: AvoidEntry[] }

const glossary = glossaryRaw as GlossaryFile

const AVOID_TERMS: string[] = glossary.avoid.flatMap(entry => [
  ...entry['pt-br'].split('/').map(t => t.trim().toLowerCase()),
  ...entry['en-us'].split('/').map(t => t.trim().toLowerCase()),
]).filter(Boolean)

// Mapa hit → use_instead, derivado do glossary. Usado pelo regenerador
// para guiar o Haiku a substituir termos rejeitados por equivalentes
// factuais já curados (ex: "desvio" → "divergência / valor não justificado").
const HIT_TO_USE_INSTEAD: Record<string, string[]> = {}
for (const entry of glossary.avoid) {
  const terms = [
    ...entry['pt-br'].split('/').map(t => t.trim().toLowerCase()),
    ...entry['en-us'].split('/').map(t => t.trim().toLowerCase()),
  ].filter(Boolean)
  for (const term of terms) {
    HIT_TO_USE_INSTEAD[term] = entry.use_instead
  }
}

export interface NarrativeValidationResult {
  valid: boolean
  hits: string[]
}

export function validateNarrative(text: string): NarrativeValidationResult {
  const lower = text.toLowerCase()
  const hits = AVOID_TERMS.filter(term => lower.includes(term))
  return { valid: hits.length === 0, hits }
}

/**
 * Para cada hit do brand gate, retorna a lista curada de equivalentes
 * factuais (do glossary.avoid[].use_instead). Usado no prompt de
 * regeneração para o Haiku substituir o termo rejeitado.
 */
export function getUseInsteadFor(hits: string[]): string[] {
  const out = new Set<string>()
  for (const hit of hits) {
    for (const sub of HIT_TO_USE_INSTEAD[hit.toLowerCase()] ?? []) {
      out.add(sub)
    }
  }
  return Array.from(out)
}
