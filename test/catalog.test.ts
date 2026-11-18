import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateItem, loadCatalog, getItem } from '../plugin/src/catalog.ts'
import { skillItem, mcpItem, pluginItem } from './helpers.ts'

test('an item needs a GitHub source or a publisher name', () => {
  const { source, ...rest } = mcpItem()
  assert.equal(validateItem({ ...rest, publisher: 'com.example' }), null)
  assert.equal(validateItem(rest), 'source')
  assert.equal(validateItem({ ...rest, publisher: 'bad name; rm' }), 'source')
})

test('valid items pass', () => {
  assert.equal(validateItem(skillItem()), null)
  assert.equal(validateItem(mcpItem()), null)
  assert.equal(validateItem(pluginItem()), null)
})

test('rejects shell metacharacters', () => {
  const r = validateItem(mcpItem({ recipe: { kind: 'mcp', name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg; rm -rf ~'] } }))
  assert.ok(r && r.includes('args'), String(r))
})

test('pattern checks', () => {
  const bad = [
    skillItem({ id: 'Bad Id' }),
    skillItem({ recipe: { kind: 'skill', repo: 'a/b/c', commit: 'a'.repeat(40), path: 'x', name: 'x' } }),
    skillItem({ recipe: { kind: 'skill', repo: 'a/b', commit: 'abc123', path: 'x', name: 'x' } }),
    skillItem({ recipe: { kind: 'skill', repo: 'a/b', commit: 'a'.repeat(40), path: '../x', name: 'x' } }),
    skillItem({ recipe: { kind: 'skill', repo: 'a/b', commit: 'a'.repeat(40), path: '/x', name: 'x' } }),
    mcpItem({ recipe: { kind: 'mcp', name: 'r', transport: 'http', url: 'http://example.com/mcp' } }),
    mcpItem({ recipe: { kind: 'mcp', name: 'fs', transport: 'stdio', command: 'npx', args: ['$(whoami)'] } }),
    mcpItem({ recipe: { kind: 'mcp', name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'p@1'], env: ['lower'] } }),
    mcpItem({ recipe: { kind: 'mcp', name: 'fs', transport: 'stdio', command: 'bash', args: ['-c', 'x'] } }),
  ]
  for (const it of bad) assert.notEqual(validateItem(it), null, JSON.stringify(it.recipe) + it.id)
})

test('stats and about are optional but must be well-formed', () => {
  assert.equal(validateItem(skillItem({ stats: { stars: 5, forks: 1, issues: 0, contributors: 2, updatedAt: '2026-11-16' }, about: { en: 'Intro.', ar: 'مقدمة.' } } as any)), null)
  assert.notEqual(validateItem(skillItem({ stats: { stars: '5', forks: 1, issues: 0, updatedAt: '2026-11-16' } } as any)), null)
  assert.notEqual(validateItem(skillItem({ stats: { stars: 5, forks: 1, issues: 0, updatedAt: 'yesterday' } } as any)), null)
  assert.notEqual(validateItem(skillItem({ about: 'plain string' } as any)), null)
  assert.notEqual(validateItem(skillItem({ media: Array.from({ length: 9 }, () => ({ kind: 'image', url: 'https://x.dev/a.png' })) })), null)
  assert.notEqual(validateItem(skillItem({ media: [{ kind: 'audio', url: 'https://x.dev/a.mp3' }] } as any)), null)
})

test('recipe kind must equal type', () => {
  assert.notEqual(validateItem(skillItem({ recipe: mcpItem().recipe })), null)
})

function writeCat(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'madar-'))
  const p = join(dir, 'c.json')
  writeFileSync(p, JSON.stringify(obj))
  return p
}

test('loadCatalog drops bad items, keeps good', () => {
  const p = writeCat({ version: 1, items: [skillItem(), mcpItem(), skillItem({ id: 'Bad Id' })], bundles: [] })
  const { catalog, rejected } = loadCatalog(p)
  assert.equal(catalog.items.length, 2)
  assert.equal(rejected[0].id, 'Bad Id')
  assert.equal(getItem(catalog, 'fs')?.type, 'mcp')
  assert.equal(getItem(catalog, 'nope'), undefined)
})

test('bundle with unknown item id is rejected', () => {
  const p = writeCat({
    version: 1,
    items: [skillItem()],
    bundles: [{ id: 'kit', name: { en: 'Kit' }, description: { en: 'd' }, items: ['pptx', 'ghost'] }],
  })
  const { catalog, rejected } = loadCatalog(p)
  assert.equal(catalog.bundles.length, 0)
  assert.equal(rejected[0].id, 'kit')
})

test('seed MCP tools need no new conversation (seen live: they appear in the same session)', () => {
  const { catalog } = loadCatalog('plugin/catalog/seed.json')
  for (const it of catalog.items.filter((i) => i.type === 'mcp')) assert.equal(it.after, 'none', it.id)
})

test('seed catalog is valid', () => {
  const { rejected } = loadCatalog('plugin/catalog/seed.json')
  assert.deepEqual(rejected, [])
})
