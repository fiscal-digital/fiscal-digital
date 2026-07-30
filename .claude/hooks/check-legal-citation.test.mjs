// Testa que o gate anti-confabulação REALMENTE barra (LRN-20260505-004: gate
// que não barra é gate que mente). Roda no CI — se o hook sumir do repo ou
// parar de bloquear, o PR fica vermelho.
//
//   node --test .claude/hooks/check-legal-citation.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const HOOK = '.claude/hooks/check-legal-citation.js'
const SETTINGS = '.claude/settings.json'

function run(payload) {
  const out = execFileSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' })
  return out.trim() ? JSON.parse(out) : null
}

test('o hook existe no repo (CLAUDE.md o declara — não pode ser fantasma)', () => {
  assert.ok(existsSync(HOOK), `${HOOK} não existe — CLAUDE.md promete enforcement que não roda`)
})

test('está fiado como PreToolUse para Bash e Edit|Write', () => {
  assert.ok(existsSync(SETTINGS), `${SETTINGS} não existe`)
  const s = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  const pre = s.hooks?.PreToolUse ?? []
  const matchers = pre.map((h) => h.matcher)
  assert.ok(matchers.includes('Bash'), 'sem matcher Bash')
  assert.ok(matchers.some((m) => /Edit\|Write|Write\|Edit/.test(m)), 'sem matcher Edit|Write')
  for (const h of pre) {
    assert.ok(h.hooks?.some((x) => x.command?.includes('check-legal-citation')),
      'matcher sem o comando do hook')
  }
})

test('BLOQUEIA lei fora do corpus em docs/ sem bypass', () => {
  const r = run({ tool_name: 'Write', tool_input: {
    file_path: 'docs/teste.md',
    content: 'Conforme a Lei 99.999/2030, Art. 5, o município deve...' } })
  assert.equal(r?.decision, 'block')
  assert.match(r.reason, /Lei 99\.999\/2030/)
})

test('BLOQUEIA body de gh issue/pr com citação não resolvida', () => {
  const r = run({ tool_name: 'Bash', tool_input: {
    command: `gh issue create --title x --body "viola a Lei 99.999/2030, Art. 5"` } })
  assert.equal(r?.decision, 'block')
})

test('LIBERA com bypass explícito', () => {
  assert.equal(run({ tool_name: 'Write', tool_input: {
    file_path: 'docs/teste.md',
    content: '<!-- legal-verified -->\nLei 99.999/2030, Art. 5' } }), null)
  assert.equal(run({ tool_name: 'Bash', tool_input: {
    command: `gh pr create --title x --body "[legal-verified: art-75.md] Lei 99.999/2030"` } }), null)
})

test('LIBERA citação que resolve contra o legal-corpus', () => {
  // Lei 14.133/2021 Art. 75 está sincronizada — o bypass automático deve valer.
  assert.equal(run({ tool_name: 'Write', tool_input: {
    file_path: 'docs/teste.md',
    content: 'Lei 14.133/2021, Art. 75, II — teto de dispensa' } }), null)
})

test('IGNORA arquivos fora do escopo (código não é artefato público)', () => {
  assert.equal(run({ tool_name: 'Write', tool_input: {
    file_path: 'packages/engine/src/x.ts',
    content: 'Lei 99.999/2030, Art. 5' } }), null)
})

test('IGNORA Bash que não é gh issue/pr', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: {
    command: 'echo "Lei 99.999/2030, Art. 5"' } }), null)
})
