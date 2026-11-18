import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listInstalled, parseMcpList } from '../plugin/src/installed.ts'
import { recordInstall } from '../plugin/src/ledger.ts'
import { skillItem, mcpItem, pluginItem } from './helpers.ts'

const fixture = (f: string) => readFileSync(join('test', 'fixtures', f), 'utf8')
const catalog = {
  version: 1 as const,
  bundles: [],
  items: [
    skillItem(),
    mcpItem({ id: 'playwright', recipe: { kind: 'mcp', name: 'playwright', transport: 'stdio', command: 'npx', args: ['-y', 'x@1'] } }),
    pluginItem(),
  ],
}
const run = async (cmd: string) => (cmd.includes('mcp list') ? fixture('mcp-list.txt') : fixture('plugin-list.json'))

function homeWithSkill(name: string) {
  const h = mkdtempSync(join(tmpdir(), 'madar-home-'))
  mkdirSync(join(h, '.claude', 'skills', name), { recursive: true })
  writeFileSync(join(h, '.claude', 'skills', name, 'SKILL.md'), '---\nname: x\n---\n')
  return h
}

test('mcp list parse', () => {
  assert.deepEqual(parseMcpList(fixture('mcp-list.txt')), ['plugin:example-kit:notes', 'playwright', 'context7'])
})

test('manual skill is byMadar false', async () => {
  const rows = await listInstalled(homeWithSkill('pptx'), catalog, run)
  const r = rows.find((x) => x.name === 'pptx')!
  assert.equal(r.id, 'pptx')
  assert.equal(r.byMadar, false)
})

test('madar skill is byMadar true', async () => {
  const h = homeWithSkill('pptx')
  recordInstall(h, { id: 'pptx', type: 'skill', installedAt: 'x', uninstall: [] })
  const rows = await listInstalled(h, catalog, run)
  assert.equal(rows.find((x) => x.name === 'pptx')!.byMadar, true)
})

test('mcp and plugins are matched to catalog ids; unknown ones have no id', async () => {
  const rows = await listInstalled(homeWithSkill('other'), catalog, run)
  assert.equal(rows.find((x) => x.name === 'playwright')!.id, 'playwright')
  assert.equal(rows.find((x) => x.name === 'code-review@claude-plugins-official')!.id, 'cr')
  assert.equal(rows.find((x) => x.name === 'other')!.id, undefined)
  assert.equal(rows.find((x) => x.name === 'example-kit@example-market')!.type, 'plugin')
})

test('a failing CLI call does not break the list', async () => {
  const rows = await listInstalled(homeWithSkill('pptx'), catalog, async () => {
    throw new Error('not logged in')
  })
  assert.deepEqual(rows.map((r) => r.name), ['pptx'])
})
