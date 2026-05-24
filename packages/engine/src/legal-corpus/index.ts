// index.ts — API de leitura da base local de textos legais.
//
// Uso primario:
//   import { lookup, validateCitation } from '@fiscal-digital/engine/legal-corpus'
//
//   const texto = lookup('Lei 14.133/2021, Art. 75')
//   if (!texto) throw new Error('Referencia nao coberta pela base local — atualizar manifest + rodar sync.mjs')
//
//   const check = validateCitation('Lei 14.133/2021, Art. 75, II — limite R$ 65.492,11')
//   if (!check.ok) console.warn(check.reason)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

// tsconfig.json do engine usa module=commonjs, entao __dirname e variavel built-in
// no output compilado. Em testes (ts-jest/Jest), __dirname e populado para o .ts file.
// Nao usar import.meta.url aqui — TS bloqueia em CommonJS (TS1343).
const CORPUS_ROOT = __dirname

// ---------- Types ----------

export interface LegalText {
  norma: string
  artigo: string
  texto: string
  urlFonte: string
  syncEm: string
  fonte: string
  usadoPor: string[]
  arquivo: string // caminho relativo ao corpus root, ex: 'lei-14133-2021/art-75.md'
}

export interface ParsedReference {
  raw: string
  normaId: string | null    // ex: 'lei-14133-2021'
  artigo: string | null     // ex: '75'
  paragrafo: string | null  // ex: '1' (do "§1º")
  inciso: string | null     // ex: 'II'
  tipo: 'lei' | 'decreto' | 'sumula' | 'cf' | 'unknown'
}

export interface CitationCheck {
  ok: boolean
  references: Array<{ ref: ParsedReference; match: LegalText | null }>
  unresolved: ParsedReference[]
  bypassMarker: string | null // string sugerida para incluir [legal-verified: ...]
}

// ---------- Manifesto / catalogo ----------

let _manifest: any | null = null
function manifest() {
  if (_manifest) return _manifest
  _manifest = JSON.parse(readFileSync(join(CORPUS_ROOT, 'sync-manifest.json'), 'utf8'))
  return _manifest
}

// ---------- Lookup ----------

/**
 * Busca texto legal por referencia textual. Retorna null se nao encontrado.
 *
 * Aceita formas comuns:
 *   "Lei 14.133/2021, Art. 75, II"
 *   "Lei 14.133/2021 Art. 75"
 *   "Art. 75 da Lei 14.133/2021"
 *   "STF Sumula Vinculante 13"
 *   "CF/88 Art. 37"
 *   "Decreto 12.807/2025"
 */
export function lookup(referencia: string): LegalText | null {
  const parsed = parseReference(referencia)
  if (!parsed.normaId) return null
  return loadByRef(parsed)
}

/**
 * Valida uma string que potencialmente contem multiplas citacoes juridicas.
 * Retorna ok=true se todas as referencias detectadas estao cobertas pela base local.
 */
export function validateCitation(claim: string): CitationCheck {
  const refs = extractReferences(claim)
  const results = refs.map((ref) => ({ ref, match: loadByRef(ref) }))
  const unresolved = results.filter((r) => !r.match).map((r) => r.ref)
  const matchedFiles = results.filter((r) => r.match).map((r) => r.match!.arquivo)
  const bypassMarker = unresolved.length === 0 && matchedFiles.length > 0
    ? `[legal-verified: legal-corpus/${matchedFiles.join(', legal-corpus/')}]`
    : null
  return {
    ok: refs.length > 0 && unresolved.length === 0,
    references: results,
    unresolved,
    bypassMarker,
  }
}

/** Lista todas as normas disponiveis no corpus. */
export function listNormas(): Array<{ id: string; norma: string; artigos: string[] }> {
  const m = manifest()
  return m.sources.map((s: any) => {
    const dir = join(CORPUS_ROOT, s.id)
    let arts: string[] = []
    if (existsSync(dir)) {
      arts = readdirSync(dir)
        .filter((f) => /^art-.+\.md$/.test(f))
        .map((f) => f.replace(/^art-/, '').replace(/\.md$/, ''))
    }
    return { id: s.id, norma: s.norma, artigos: arts }
  })
}

// ---------- Parser de referencia ----------

const NORMA_PATTERNS: Array<{ re: RegExp; tipo: ParsedReference['tipo']; toId: (m: RegExpMatchArray) => string }> = [
  { re: /\bLei\s+(?:Complementar\s+)?n?º?\s*(\d[\d.]*)\/?\s*(\d{2,4})/i,
    tipo: 'lei',
    toId: (m) => `lei-${m[1].replace(/\./g, '')}-${normalizeYear(m[2])}` },
  { re: /\bDecreto(?:\s+Federal)?\s+n?º?\s*(\d[\d.]*)\/?\s*(\d{2,4})/i,
    tipo: 'decreto',
    toId: (m) => `decreto-${m[1].replace(/\./g, '')}-${normalizeYear(m[2])}` },
  { re: /\bS[úu]mula\s+Vinculante\s+(\d+)/i,
    tipo: 'sumula',
    toId: (m) => `stf-sv-${m[1]}` },
  { re: /\b(CF(?:\/88)?|Constitui[çc][ãa]o\s+Federal)\b/i,
    tipo: 'cf',
    toId: () => 'cf-1988' },
]

const ARTIGO_RE = /\bArt\.?\s*(\d+)/i
const PARAG_RE  = /§\s*(\d+)/
const INCISO_RE = /\binciso\s+([IVXLCDM]+)|,\s*([IVXLCDM]+)\b/i

function normalizeYear(y: string): string {
  // "97" → "1997", "21" → "2021"; "2021" passa direto
  if (y.length === 4) return y
  const n = Number(y)
  return (n >= 50 ? 1900 + n : 2000 + n).toString()
}

export function parseReference(s: string): ParsedReference {
  const parsed: ParsedReference = {
    raw: s, normaId: null, artigo: null, paragrafo: null, inciso: null, tipo: 'unknown',
  }
  for (const pat of NORMA_PATTERNS) {
    const m = s.match(pat.re)
    if (m) {
      parsed.normaId = pat.toId(m)
      parsed.tipo = pat.tipo
      break
    }
  }
  const ma = s.match(ARTIGO_RE)
  if (ma) parsed.artigo = ma[1]
  const mp = s.match(PARAG_RE)
  if (mp) parsed.paragrafo = mp[1]
  const mi = s.match(INCISO_RE)
  if (mi) parsed.inciso = mi[1] || mi[2]
  return parsed
}

/**
 * Quebra um texto livre em referencias juridicas distintas. Cada elemento e
 * uma "citacao" identificavel (norma + artigo). Util para validateCitation.
 */
export function extractReferences(text: string): ParsedReference[] {
  // Estrategia: encontra cada ocorrencia de norma e busca artigo/paragrafo proximos.
  const refs: ParsedReference[] = []
  for (const pat of NORMA_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags.includes('g') ? pat.re.flags : pat.re.flags + 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      // Janela de 80 chars apos a norma para capturar Art. NN, inciso, §
      const window = text.slice(m.index, m.index + 200)
      const parsed = parseReference(window)
      if (parsed.normaId) refs.push(parsed)
    }
  }
  // Tambem referencias soltas CF Art. NN sem repetir 'CF/88'
  return dedupRefs(refs)
}

function dedupRefs(refs: ParsedReference[]): ParsedReference[] {
  const seen = new Set<string>()
  const out: ParsedReference[] = []
  for (const r of refs) {
    const k = `${r.normaId}|${r.artigo || ''}|${r.paragrafo || ''}|${r.inciso || ''}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

// ---------- Loader (filesystem) ----------

function loadByRef(ref: ParsedReference): LegalText | null {
  if (!ref.normaId) return null
  const dir = join(CORPUS_ROOT, ref.normaId)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null

  // Decide arquivo: se ha artigo, busca art-NN.md; senao usa full.md
  const filename = ref.artigo ? `art-${ref.artigo}.md` : 'full.md'
  const filepath = join(dir, filename)
  if (!existsSync(filepath)) {
    // Tenta fallback para full.md
    const fallback = join(dir, 'full.md')
    if (!existsSync(fallback)) return null
    return readMd(fallback, `${ref.normaId}/full.md`)
  }
  return readMd(filepath, `${ref.normaId}/${filename}`)
}

function readMd(filepath: string, arquivo: string): LegalText {
  const raw = readFileSync(filepath, 'utf8')
  const front = parseFrontmatter(raw)
  return {
    norma: front.norma || '?',
    artigo: front.artigo || '?',
    texto: stripFrontmatter(raw).trim(),
    urlFonte: front.urlFonte || '',
    syncEm: front.syncEm || '',
    fonte: front.fonte || '',
    usadoPor: parseList(front.usadoPor || ''),
    arquivo,
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

function parseList(s: string): string[] {
  return s.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean)
}
