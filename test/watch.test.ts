// Watch mode: Claude listens to the store in the background (desktop app, no channels).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHttp } from '../plugin/src/http.ts'
import type { Action } from '../plugin/src/types.ts'
import { skillItem } from './helpers.ts'

async function setup(channel: 'connected' | 'unavailable' = 'unavailable') {
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const actions: Action[] = []
  const s = await startHttp({ catalog: { version: 1, items: [skillItem()], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, channelState: () => channel, onAction: (a) => actions.push(a), run: async () => '' })
  const origin = new URL(s.url).origin
  const post = () => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ op: 'install', id: 'pptx' }) })
  const state = async () => (await (await fetch(`${origin}/api/catalog?key=${s.token}`)).json()).channel
  return { s, origin, actions, post, state }
}

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let text = ''
  while (!/\S.*\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  return text.split('\n').find((l) => l.trim())!
}

test('watch url is returned and requires the token', async () => {
  const { s, origin } = await setup()
  assert.equal(s.watchUrl, `${origin}/api/watch?key=${s.token}`)
  assert.equal((await fetch(`${origin}/api/watch`)).status, 401)
  await s.close()
})

test('a connected watcher makes the store connected and receives clicks as lines', async () => {
  const { s, post, state, actions } = await setup()
  assert.equal(await state(), 'unavailable')
  const ctrl = new AbortController()
  const r = await fetch(s.watchUrl, { signal: ctrl.signal })
  assert.match(r.headers.get('content-type')!, /^text\/plain/)
  const reader = r.body!.getReader()
  assert.equal(await state(), 'connected')
  const res = await post()
  assert.equal(res.status, 202)
  assert.deepEqual(await res.json(), { mode: 'watch' })
  assert.equal(await readLine(reader), 'Madar: install pptx')
  assert.equal(actions.length, 0)
  ctrl.abort()
  await s.close()
})

test('when the watcher goes away the store falls back to copy', async () => {
  const { s, post, state } = await setup()
  const ctrl = new AbortController()
  await fetch(s.watchUrl, { signal: ctrl.signal })
  assert.equal(await state(), 'connected')
  ctrl.abort()
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(await state(), 'unavailable')
  assert.deepEqual(await (await post()).json(), { mode: 'copy', text: 'Madar: install pptx' })
  await s.close()
})

test('open_store returns the watch command for Claude to monitor', async () => {
  const { createMadar } = await import('../plugin/src/server.ts')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  const madar = createMadar({ catalog: { version: 1, items: [skillItem()], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, claude: 'claude', run: async () => '' })
  const client = new Client({ name: 't', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const r: any = await client.callTool({ name: 'madar_open_store', arguments: {} })
  const data = JSON.parse(r.content[0].text)
  assert.match(data.watch, /^curl -sN 'http:\/\/127\.0\.0\.1:\d+\/api\/watch\?key=[0-9a-f]{64}' \| grep --line-buffered -v '\^\$'$/)
  await madar.close()
})

test('open_store refreshes the catalog when it is older than an hour', async () => {
  const { createMadar } = await import('../plugin/src/server.ts')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { mcpItem } = await import('./helpers.ts')
  let loads = 0
  let clock = 0
  const madar = createMadar({
    catalog: { version: 1, items: [skillItem()], bundles: [] },
    home: mkdtempSync(join(tmpdir(), 'h-')), uiDir: mkdtempSync(join(tmpdir(), 'ui-')), claude: 'claude', run: async () => '',
    refresh: async () => { loads++; return { catalog: { version: 1, items: [skillItem(), mcpItem({ id: 'fresh-tool' })], bundles: [] }, source: 'remote' } },
    now: () => clock,
  })
  const client = new Client({ name: 't', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const open = async () => JSON.parse(((await client.callTool({ name: 'madar_open_store', arguments: {} })) as any).content[0].text)
  assert.equal((await open()).source, 'remote')
  assert.equal(loads, 1)
  clock = 30 * 60_000
  await open()
  assert.equal(loads, 1)
  clock = 61 * 60_000
  await open()
  assert.equal(loads, 2)
  const steps: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'install', id: 'fresh-tool' } })
  assert.notEqual(steps.isError, true)
  await madar.close()
})

test('a real channel takes precedence over a watcher', async () => {
  const { s, post, actions } = await setup('connected')
  const ctrl = new AbortController()
  await fetch(s.watchUrl, { signal: ctrl.signal })
  assert.deepEqual(await (await post()).json(), { mode: 'channel' })
  assert.equal(actions.length, 1)
  ctrl.abort()
  await s.close()
})
