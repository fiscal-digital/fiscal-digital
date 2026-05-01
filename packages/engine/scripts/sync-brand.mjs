#!/usr/bin/env node
/**
 * sync-brand.mjs — sincroniza brand pack de fiscal-digital-web para engine/src/brand/
 *
 * Estratégia:
 *   1. Sibling repo: copia diretamente de ../../../fiscal-digital-web/brand/
 *   2. Fallback: baixa via `gh api repos/fiscal-digital/fiscal-digital-web/contents/brand/<file>`
 */

import { existsSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FILES = ['glossary.json', 'voice-tone.md', 'colors.json']

// packages/engine/scripts/ → 4 levels up → fiscal-digital/ → ../fiscal-digital-web/brand/
const SIBLING_BRAND = resolve(__dirname, '../../../../fiscal-digital-web/brand')
const DEST_DIR = resolve(__dirname, '../src/brand')

mkdirSync(DEST_DIR, { recursive: true })

if (existsSync(SIBLING_BRAND)) {
  // Strategy 1: copy from local sibling repo
  for (const file of FILES) {
    const src = resolve(SIBLING_BRAND, file)
    const dest = resolve(DEST_DIR, file)
    copyFileSync(src, dest)
  }
  console.log('[sync-brand] copied from local sibling')
} else {
  // Strategy 2: download via gh api
  for (const file of FILES) {
    const dest = resolve(DEST_DIR, file)
    const content = execFileSync(
      'gh',
      [
        'api',
        `repos/fiscal-digital/fiscal-digital-web/contents/brand/${file}`,
        '--jq',
        '.content | @base64d',
      ],
      { encoding: 'utf8' },
    )
    writeFileSync(dest, content, 'utf8')
  }
  console.log('[sync-brand] downloaded via gh api')
}
