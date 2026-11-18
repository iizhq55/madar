import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMadar, toPosix } from '../plugin/src/server.ts'
import { readLedger } from '../plugin/src/ledger.ts'
import { skillItem, mcpItem } from './helpers.ts'

const catalog = { version: 1 as const, items: [skillItem(), mcpItem()], bundles: [] }

async function connect(channelCapable: boolean) {
  const home = mkdtempSync(join(tmpdir(), 'madar-home-'))
  const uiDir = mkdtempSync(join(tmpdir(), 'madar-ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const madar = createMadar({ catalog, home, uiDir, claude: '/c/u/claude.exe', run: async () => '' })
  const notes: any[] = []
  const client = new Client(
    { name: 't', version: '1' },
    { capabilities: channelCapable ? { experimental: { 'claude/channel': {} } } : {} },
  )
  client.fallbackNotificationHandler = async (n) => {
    notes.push(n)
  }
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const call = async (name: string, args: any) => {
    const r: any = await client.callTool({ name, arguments: args })
    return { ...r, data: !r.isError && r.content?.[0]?.text ? JSON.parse(r.content[0].text) : undefined }
  }
  return { madar, client, notes, call, home }
}

test('server declares the channel capability', async () => {
  const { client, madar } = await connect(true)
  assert.deepEqual(client.getServerCapabilities()?.experimental?.['claude/channel'], {})
  await madar.close()
})

test('tools listed with exact names', async () => {
  const { client, madar } = await connect(true)
  const names = (await client.listTools()).tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['madar_get_steps', 'madar_open_store', 'madar_record', 'madar_report_progress'])
  await madar.close()
})

test('get_steps for unknown id errors', async () => {
  const { call, madar } = await connect(true)
  const r = await call('madar_get_steps', { op: 'install', id: 'ghost' })
  assert.equal(r.isError, true)
  await madar.close()
})

test('get_steps install returns item summary and steps', async () => {
  const { call, madar } = await connect(true)
  const { data } = await call('madar_get_steps', { op: 'install', id: 'pptx' })
  assert.equal(data.item.id, 'pptx')
  assert.equal(data.item.checked, true)
  assert.deepEqual(data.steps.map((s: any) => s.percent), [20, 50, 80, 100])
  await madar.close()
})

test('uninstall steps only for madar-installed ids', async () => {
  const { call, madar } = await connect(true)
  assert.equal((await call('madar_get_steps', { op: 'uninstall', id: 'pptx' })).isError, true)
  await call('madar_record', { op: 'install', id: 'pptx' })
  const { data } = await call('madar_get_steps', { op: 'uninstall', id: 'pptx' })
  assert.ok(data.steps.flatMap((s: any) => s.run ?? []).some((c: string) => c.startsWith('rm -rf')))
  await madar.close()
})

test('record install then uninstall updates the ledger', async () => {
  const { call, madar, home } = await connect(true)
  await call('madar_record', { op: 'install', id: 'fs' })
  assert.deepEqual(readLedger(home).map((e) => e.id), ['fs'])
  await call('madar_record', { op: 'uninstall', id: 'fs' })
  assert.deepEqual(readLedger(home), [])
  await madar.close()
})

test('channel state follows client capability', async () => {
  const yes = await connect(true)
  assert.equal(yes.madar.channelState(), 'connected')
  await yes.madar.close()
  const no = await connect(false)
  assert.equal(no.madar.channelState(), 'unavailable')
  await no.madar.close()
})

test('action via HTTP emits exactly one channel notification with the exact content', async () => {
  const { call, madar, notes } = await connect(true)
  const { data } = await call('madar_open_store', {})
  const origin = new URL(data.url).origin
  const key = new URL(data.url).searchParams.get('key')
  const post = () =>
    fetch(`${origin}/api/action?key=${key}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ op: 'install', id: 'pptx' }) })
  await post()
  await post()
  await new Promise((r) => setTimeout(r, 50))
  const ch = notes.filter((n) => n.method === 'notifications/claude/channel')
  assert.equal(ch.length, 1)
  assert.equal(ch[0].params.content, 'Madar: install pptx')
  assert.deepEqual(ch[0].params.meta, { source: 'madar', op: 'install', id: 'pptx', lang: 'en' })
  await madar.close()
})

test('open_store reuses one http server', async () => {
  const { call, madar } = await connect(true)
  const a = (await call('madar_open_store', {})).data.url
  const b = (await call('madar_open_store', {})).data.url
  assert.equal(a, b)
  await madar.close()
})

test('report_progress reaches SSE', async () => {
  const { call, madar } = await connect(true)
  const { data } = await call('madar_open_store', {})
  const u = new URL(data.url)
  const ctrl = new AbortController()
  const r = await fetch(`${u.origin}/api/events?key=${u.searchParams.get('key')}`, { signal: ctrl.signal })
  const reader = r.body!.getReader()
  await call('madar_report_progress', { id: 'pptx', percent: 80, message: 'أثبّتها' })
  let text = ''
  while (!/data: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  assert.equal(JSON.parse(text.split('data: ')[1]).percent, 80)
  ctrl.abort()
  await madar.close()
})

test('toPosix converts Windows paths for Git Bash', () => {
  assert.equal(toPosix('C:\\Users\\someone\\AppData\\Local\\Temp'), '/c/Users/someone/AppData/Local/Temp')
  assert.equal(toPosix('/home/u'), '/home/u')
})
