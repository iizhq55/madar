// I6: removing works even after an item left the catalog. I7: the live catalog is used before the store is opened.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMadar, type MadarOpts } from '../plugin/src/server.ts'
import { readLedger, recordInstall } from '../plugin/src/ledger.ts'
import { startHttp } from '../plugin/src/http.ts'
import { skillItem, mcpItem } from './helpers.ts'
import type { Catalog } from '../plugin/src/types.ts'

async function connect(over: Partial<MadarOpts> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'madar-home-'))
  const uiDir = mkdtempSync(join(tmpdir(), 'madar-ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const catalog: Catalog = { version: 1, items: [skillItem()], bundles: [] }
  const madar = createMadar({ catalog, home, uiDir, claude: '/c/u/claude.exe', run: async () => '', ...over })
  const client = new Client({ name: 't', version: '1' }, { capabilities: {} })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const call = async (name: string, args: any) => {
    const r: any = await client.callTool({ name, arguments: args })
    return { ...r, data: !r.isError && r.content?.[0]?.text ? JSON.parse(r.content[0].text) : undefined }
  }
  return { madar, call, home }
}

const gone = { id: 'old-tool', type: 'mcp' as const, installedAt: '2026-11-01T00:00:00Z', uninstall: [{ percent: 100 as const, label: { ar: 'أشيلها', en: 'Removing' }, run: ["claude mcp remove --scope user 'old-tool'"] }] }

test('an item Madar installed can be removed after it left the catalog', async () => {
  const { madar, call, home } = await connect()
  recordInstall(home, gone)
  const r = await call('madar_get_steps', { op: 'uninstall', id: 'old-tool' })
  assert.ok(!r.isError, r.content?.[0]?.text)
  assert.deepEqual(r.data.steps, gone.uninstall)
  assert.equal(r.data.item.type, 'mcp')
  assert.equal(r.data.item.name.en, 'old-tool')
  const rec = await call('madar_record', { op: 'uninstall', id: 'old-tool' })
  assert.ok(!rec.isError)
  assert.equal(readLedger(home).length, 0)
  await madar.close()
})

test('the store page accepts removing an item that is only in the ledger', async () => {
  const home = mkdtempSync(join(tmpdir(), 'h-'))
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  recordInstall(home, gone)
  const s = await startHttp({ catalog: { version: 1, items: [], bundles: [] }, home, uiDir, channelState: () => 'unavailable', onAction: () => {}, run: async () => '' })
  const origin = new URL(s.url).origin
  const post = (body: unknown) => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post({ op: 'uninstall', id: 'old-tool' })).status, 200)
  assert.equal((await post({ op: 'install', id: 'old-tool' })).status, 404)
  await s.close()
})

test('install steps use the live catalog even before the store was opened', async () => {
  const live: Catalog = { version: 1, items: [skillItem(), mcpItem({ id: 'live-only', recipe: { kind: 'mcp', name: 'live-only', transport: 'http', url: 'https://x.example/mcp' } })], bundles: [] }
  let refreshed = 0
  const { madar, call } = await connect({ refresh: async () => { refreshed++; return { catalog: live, source: 'cache' } } })
  const r = await call('madar_get_steps', { op: 'install', id: 'live-only' })
  assert.ok(!r.isError, r.content?.[0]?.text)
  await call('madar_get_steps', { op: 'install', id: 'live-only' })
  assert.equal(refreshed, 1, 'refreshed once, not on every call')
  await madar.close()
})
