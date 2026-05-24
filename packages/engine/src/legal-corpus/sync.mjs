#!/usr/bin/env node
// sync.mjs — baixa textos legais de fontes oficiais e persiste em legal-corpus/.
//
// Uso:
//   node packages/engine/src/legal-corpus/sync.mjs              # todas as normas
//   node packages/engine/src/legal-corpus/sync.mjs lei-14133-2021
//
// Estrategia:
//   - fonte=planalto: fetch nativo Node (HTTPS funciona com CA bundled).
//   - fonte=stf:      spawn powershell.exe Invoke-WebRequest (usa cert store Windows).
//
// Output por source:
//   <id>/full.txt         texto integral normalizado
//   <id>/art-<NN>.md      texto do artigo + metadata frontmatter (se manifest.artigos)
//   <id>/_index.json      mapa { artigo: arquivo, urlAnchor }
//   _meta.json (root)     timestamps + checksum sha256 por source

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dirname, 'sync-manifest.json')
const META_PATH = join(__dirname, '_meta.json')

async function main() {
  const filterId = process.argv[2] || null
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const meta = existsSync(META_PATH) ? JSON.parse(readFileSync(META_PATH, 'utf8')) : { sources: {} }

  const sources = filterId
    ? manifest.sources.filter((s) => s.id === filterId)
    : manifest.sources

  if (sources.length === 0) {
    console.error(`Nenhuma fonte com id="${filterId}" no manifest.`)
    process.exit(1)
  }

  for (const src of sources) {
    console.log(`\n[${src.id}] ${src.norma}`)
    try {
      const html = await fetchSource(src)
      const text = htmlToText(html)
      const checksum = sha256(text)

      const dir = join(__dirname, src.id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'full.txt'), text)

      const index = { norma: src.norma, url: src.url, fetchedAt: new Date().toISOString(), artigos: {} }

      if (Array.isArray(src.artigos) && src.artigos.length > 0) {
        for (const art of src.artigos) {
          const block = extractArtigo(text, art)
          if (!block) {
            console.warn(`  ! Art. ${art} nao encontrado em ${src.id}`)
            continue
          }
          const fname = `art-${art}.md`
          const front = buildFrontmatter({
            norma: src.norma,
            artigo: `Art. ${art}`,
            urlFonte: src.url,
            urlAnchor: `#art${art}`,
            syncEm: new Date().toISOString(),
            fonte: src.fonte,
            usadoPor: src.usadoPor || [],
          })
          writeFileSync(join(dir, fname), front + '\n' + block.trim() + '\n')
          index.artigos[art] = fname
          console.log(`  + ${fname} (${block.length} chars)`)
        }
      } else {
        const fname = 'full.md'
        const front = buildFrontmatter({
          norma: src.norma,
          artigo: 'integral',
          urlFonte: src.url,
          urlAnchor: '',
          syncEm: new Date().toISOString(),
          fonte: src.fonte,
          usadoPor: src.usadoPor || [],
        })
        writeFileSync(join(dir, fname), front + '\n' + text.trim() + '\n')
        index.artigos['full'] = fname
        console.log(`  + ${fname} (${text.length} chars)`)
      }

      writeFileSync(join(dir, '_index.json'), JSON.stringify(index, null, 2))
      meta.sources[src.id] = {
        url: src.url,
        fetchedAt: index.fetchedAt,
        checksum,
        bytes: text.length,
      }
    } catch (err) {
      console.error(`  ERRO: ${err.message}`)
      meta.sources[src.id] = { error: err.message, attemptedAt: new Date().toISOString() }
    }
  }

  meta.lastRun = new Date().toISOString()
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2))
  console.log(`\n_meta.json atualizado.`)
}

async function fetchSource(src) {
  if (src.fonte === 'stf') return fetchViaPowerShell(src.url)
  return fetchNative(src.url)
}

async function fetchNative(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 fiscal-digital-legal-sync' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return decodeHtml(buf, res.headers.get('content-type') || '')
}

function decodeHtml(buf, contentType) {
  // 1) charset do header
  let charset = (contentType.match(/charset=([\w-]+)/i) || [, null])[1]
  // 2) charset da meta tag (peek em ascii puro — tags HTML sao ASCII-safe)
  if (!charset) {
    const peek = buf.subarray(0, 4096).toString('ascii')
    const m = peek.match(/<meta[^>]+charset=["']?([\w-]+)/i)
                || peek.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)
    if (m) charset = m[1]
  }
  // 3) Heuristica para paginas legadas sem charset (planalto.gov.br):
  //    se contem bytes > 0x7F mas nao parece UTF-8 valido, assume windows-1252.
  if (!charset) {
    charset = detectLegacyCharset(buf)
  }
  charset = (charset || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

function detectLegacyCharset(buf) {
  // Tenta decodificar como UTF-8 strict. Se falhar (bytes inválidos), assume windows-1252.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return 'utf-8'
  } catch {
    return 'windows-1252'
  }
}

function fetchViaPowerShell(url) {
  // Forca UTF-8 no output do PowerShell para preservar acentos no pipe stdout.
  // PS 5.1 corrompe acentos no pipeline stdout; baixa em arquivo binario e o Node decodifica.
  const tmpFile = join(__dirname, '.tmp-stf-fetch.bin')
  const tmpEsc = tmpFile.replace(/\\/g, '\\\\')
  const ps = `try { Invoke-WebRequest -Uri "${url}" -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 5 -OutFile "${tmpEsc}" } catch { Write-Error $_.Exception.Message; exit 1 }`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`PowerShell IWR falhou: ${result.stderr}`)
  const buf = readFileSync(tmpFile)
  try { unlinkSync(tmpFile) } catch {}
  return decodeHtml(buf, '')
}

function htmlToText(html) {
  let t = html
  // Remove script/style/comments
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '')
  t = t.replace(/<style[\s\S]*?<\/style>/gi, '')
  t = t.replace(/<!--[\s\S]*?-->/g, '')
  // Quebra de linha apos block elements
  t = t.replace(/<\/(p|div|tr|li|h[1-6]|br|hr)\s*>/gi, '\n')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  // Remove tags restantes
  t = t.replace(/<[^>]+>/g, '')
  // Decode entidades comuns
  t = decodeEntities(t)
  // Normaliza whitespace
  t = t.replace(/\r\n?/g, '\n')
  t = t.replace(/ /g, ' ')
  t = t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

function decodeEntities(s) {
  const map = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&apos;': "'", '&#39;': "'",
    '&ordm;': 'º', '&ordf;': 'ª', '&deg;': '°',
    '&para;': '¶', '&sect;': '§',
    '&Aacute;': 'A', '&Eacute;': 'E', '&Iacute;': 'I', '&Oacute;': 'O', '&Uacute;': 'U',
    '&aacute;': 'a', '&eacute;': 'e', '&iacute;': 'i', '&oacute;': 'o', '&uacute;': 'u',
    '&Atilde;': 'A', '&atilde;': 'a', '&Otilde;': 'O', '&otilde;': 'o',
    '&Acirc;': 'A', '&acirc;': 'a', '&Ecirc;': 'E', '&ecirc;': 'e', '&Ocirc;': 'O', '&ocirc;': 'o',
    '&Ccedil;': 'C', '&ccedil;': 'c', '&Ntilde;': 'N', '&ntilde;': 'n',
  }
  s = s.replace(/&[a-zA-Z]+;/g, (m) => map[m] ?? m)
  s = s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  s = s.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  return s
}

// Extrai bloco do "Art. NN" ate o proximo "Art. MM" no texto plano normalizado.
// IMPORTANTE: case-sensitive — "Art." (A maiusculo) marca inicio de artigo, "art."
// (minusculo) é referencia inline a outro artigo dentro do texto corrido.
// Tolera ordinal: "Art. 2º" tambem casa para art="2".
function extractArtigo(text, art) {
  // Inicio: Art. NN (com ordinal opcional) seguido de . ou espaço
  const startRe = new RegExp(`(^|\\n)\\s*Art\\.?\\s*${art}[º°]?(?:[\\s.][^\\n]*)?`)
  const m = text.match(startRe)
  if (!m) return null
  const start = m.index + m[1].length
  const rest = text.slice(start)
  // Proximo artigo: maiusculo + numero diferente, com ordinal opcional, seguido de . ou espaço.
  // Letras seguidas (ex: "Art. 2-A") sao subdivisoes — nao considerar novo artigo.
  const nextRe = /\n\s*Art\.?\s*(\d+)[º°]?(?:[\s.][^\n]*)?/g
  let next = -1
  nextRe.lastIndex = 50 // pula primeiros 50 chars para nao matchar o proprio
  let match
  while ((match = nextRe.exec(rest)) !== null) {
    if (match[1] !== String(art)) { // ignora auto-referencia "Art. ${art}"
      // Tambem ignora subdivisões "Art. NN-A" — checa se vem hifen logo depois do numero
      const afterNum = rest.charAt(match.index + match[0].search(/\d+/) + match[1].length)
      if (afterNum === '-') continue // Art. NN-A nao e novo artigo
      next = match.index
      break
    }
  }
  const end = next === -1 ? rest.length : next
  return rest.slice(0, end).trim()
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

function buildFrontmatter({ norma, artigo, urlFonte, urlAnchor, syncEm, fonte, usadoPor }) {
  return [
    '---',
    `norma: ${norma}`,
    `artigo: ${artigo}`,
    `urlFonte: ${urlFonte}${urlAnchor || ''}`,
    `syncEm: ${syncEm}`,
    `fonte: ${fonte}`,
    `usadoPor: [${usadoPor.join(', ')}]`,
    '---',
  ].join('\n')
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
