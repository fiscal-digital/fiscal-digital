#!/usr/bin/env node
/**
 * copy-assets.mjs — copia ativos de runtime do `src/` para `dist/`.
 *
 * Necessário porque `tsc` só copia `.json` que é `import`ado (glossary.json
 * já entra via resolveJsonModule). Outros ativos lidos com `readFileSync`
 * em runtime ficam fora do output do compilador.
 *
 * Ativos copiados:
 *  - src/legal-corpus/ (recursivo): arquivos .md e .json
 *      lidos por dist/legal-corpus/index.js via __dirname.
 *  - src/fiscais/ : arquivos *.legal.md
 *      documentos de referência por Fiscal; úteis para consumidores que
 *      querem inspecionar base legal (não lidos em runtime hoje).
 *  - src/brand/ : voice-tone.md e colors.json
 *      completam o brand pack (glossary.json já entra via tsc).
 *
 * Idempotente: regravar é OK. Falha cedo se diretório source não existe
 * (build foi pulado).
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SRC_ROOT = resolve(__dirname, '../src')
const DIST_ROOT = resolve(__dirname, '../dist')

if (!existsSync(DIST_ROOT)) {
  console.error(`[copy-assets] FATAL: ${DIST_ROOT} não existe — rode 'npm run build' antes.`)
  process.exit(1)
}

/** Walk dir recursivo retornando arquivos que satisfazem `accept(fullpath)`. */
function walk(dir, accept) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walk(full, accept))
    } else if (accept(full)) {
      out.push(full)
    }
  }
  return out
}

function copyTo(src, srcRoot, destRoot) {
  const rel = relative(srcRoot, src)
  const dest = join(destRoot, rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  return rel
}

let copied = 0

// 1) legal-corpus: .md + .json
const corpus = walk(
  resolve(SRC_ROOT, 'legal-corpus'),
  (p) => /\.(md|json)$/i.test(p),
)
for (const f of corpus) {
  copyTo(f, SRC_ROOT, DIST_ROOT)
  copied += 1
}

// 2) fiscais/*.legal.md
const legalDocs = walk(
  resolve(SRC_ROOT, 'fiscais'),
  (p) => /\.legal\.md$/i.test(p),
)
for (const f of legalDocs) {
  copyTo(f, SRC_ROOT, DIST_ROOT)
  copied += 1
}

// 3) brand: voice-tone.md + colors.json (glossary.json já entra via tsc)
const brandDir = resolve(SRC_ROOT, 'brand')
for (const name of ['voice-tone.md', 'colors.json']) {
  const f = resolve(brandDir, name)
  if (existsSync(f)) {
    copyTo(f, SRC_ROOT, DIST_ROOT)
    copied += 1
  }
}

console.log(`[copy-assets] copiados ${copied} arquivos para dist/`)
