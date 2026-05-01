import glossaryRaw from './brand/glossary.json'

interface AvoidEntry { pt: string; en: string; reason: string; use_instead: string[] }
interface GlossaryFile { avoid: AvoidEntry[] }

const glossary = glossaryRaw as GlossaryFile

const AVOID_TERMS: string[] = glossary.avoid.flatMap(entry => [
  ...entry.pt.split('/').map(t => t.trim().toLowerCase()),
  ...entry.en.split('/').map(t => t.trim().toLowerCase()),
]).filter(Boolean)

export interface NarrativeValidationResult {
  valid: boolean
  hits: string[]
}

export function validateNarrative(text: string): NarrativeValidationResult {
  const lower = text.toLowerCase()
  const hits = AVOID_TERMS.filter(term => lower.includes(term))
  return { valid: hits.length === 0, hits }
}
