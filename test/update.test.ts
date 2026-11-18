// "Check for updates" on the store page: compare with the version on GitHub, and Claude updates Madar on a click.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { updateSteps } from '../plugin/src/recipes.ts'
import { channelText } from '../plugin/src/channel.ts'
import { startHttp } from '../plugin/src/http.ts'
import { createMadar } from '../plugin/src/server.ts'
import { newerVersion } from '../plugin/ui/logic.js'

test('version compare', () => {
  assert.equal(newerVersion('0.2.0', '0.1.0'), true)
  assert.equal(newerVersion('0.10.0', '0.9.3'), true)
  assert.equal(newerVersion('1.0.0', '1.0.0'), false)
  assert.equal(newerVersion('0.1.0', '0.2.0'), false)
  assert.equal(newerVersion('garbage', '0.1.0'), false)
})

test('update steps: refresh the Madar marketplace, then update the plugin', () => {
  const cmds = updateSteps({ claude: '/c/u/claude.exe' }).flatMap((s) => s.run ?? [])
  assert.equal(cmds.length, 2)
  assert.match(cmds[0], /plugin marketplace update 'madar'$/)
  assert.match(cmds[1], /plugin update 'madar@madar' --scope user$/)
  assert.match(cmds[0], /CLAUDE_CODE_EXECPATH/)
})

test('update request line follows the page language', () => {
  assert.equal(channelText({ op: 'update', id: '@madar', lang: 'en' }), 'Madar: update @madar')
  assert.equal(channelText({ op: 'update', id: '@madar', lang: 'ar' }), 'مدار: حدّث @madar')
})

async function store(o: { selfRepo?: string; remote?: string | null; fail?: boolean } = {}) {
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const calls: string[] = []
  const fakeFetch = (async (u: any) => {
    calls.push(String(u))
    if (o.fail) throw new Error('offline')
    return o.remote === null ? new Response('nope', { status: 404 }) : new Response(JSON.stringify({ name: 'madar', version: o.remote ?? '0.1.0' }), { status: 200 })
  }) as any
  const s = await startHttp({ catalog: { version: 1, items: [], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, channelState: () => 'unavailable', onAction: () => {}, run: async () => '', selfRepo: o.selfRepo, version: '0.1.0', fetch: fakeFetch })
  const origin = new URL(s.url).origin
  const get = async () => (await fetch(`${origin}/api/update?key=${s.token}`)).json()
  const post = (body: unknown) => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { s, get, post, calls }
}

test('check for updates: a newer version on GitHub is offered', async () => {
  const { s, get, calls } = await store({ selfRepo: 'someone/madar', remote: '0.2.0' })
  assert.deepEqual(await get(), { current: '0.1.0', latest: '0.2.0', available: true })
  assert.equal(calls[0], 'https://raw.githubusercontent.com/someone/madar/HEAD/plugin/.claude-plugin/plugin.json')
  await s.close()
})

test('check for updates: same version, unpublished, or offline → nothing to update', async () => {
  for (const o of [{ selfRepo: 'someone/madar', remote: '0.1.0' }, {}, { selfRepo: 'someone/madar', fail: true }, { selfRepo: 'someone/madar', remote: null }]) {
    const { s, get } = await store(o)
    const r = await get()
    assert.equal(r.available, false, JSON.stringify(o))
    assert.equal(r.current, '0.1.0')
    await s.close()
  }
})

test('the page asks Claude to update Madar; not before Madar is published', async () => {
  const { s, post } = await store({ selfRepo: 'someone/madar' })
  const ctrl = new AbortController()
  const reader = (await fetch(s.watchUrl, { signal: ctrl.signal })).body!.getReader()
  assert.equal((await post({ op: 'update', id: '@madar', lang: 'en' })).status, 202)
  let text = ''
  while (!/\S.*\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  assert.equal(text.trim(), 'Madar: update @madar')
  assert.equal((await post({ op: 'update', id: 'pptx' })).status, 400)
  ctrl.abort()
  await s.close()
  const unpublished = await store()
  assert.equal((await unpublished.post({ op: 'update', id: '@madar' })).status, 404)
  await unpublished.s.close()
})

test('get_steps update @madar returns the update steps and says to reload plugins after', async () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'madar-ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const madar = createMadar({ catalog: { version: 1, items: [], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, claude: '/c/u/claude.exe', run: async () => '', selfRepo: 'someone/madar' })
  const client = new Client({ name: 't', version: '1' }, { capabilities: {} })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const r: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'update', id: '@madar' } })
  assert.ok(!r.isError, r.content?.[0]?.text)
  const data = JSON.parse(r.content[0].text)
  assert.equal(data.item.after, 'reload-plugins')
  assert.equal(data.steps.length, 2)
  const bad: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'update', id: 'pptx' } })
  assert.equal(bad.isError, true)
  await madar.close()
})
