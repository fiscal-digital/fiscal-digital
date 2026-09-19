import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { USER_AGENT } from '../user_agent'

test('User-Agent carrega a versao atual do package.json da engine', () => {
  // Regra que vira teste: bump de versao sem atualizar o UA quebra aqui.
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8')) as { version: string }
  expect(USER_AGENT).toBe(`FiscalDigital/${pkg.version} (+https://fiscaldigital.org)`)
})

test('User-Agent identifica o projeto e aponta para o site', () => {
  expect(USER_AGENT).toMatch(/^FiscalDigital\/\d+\.\d+\.\d+ \(\+https:\/\/fiscaldigital\.org\)$/)
})
