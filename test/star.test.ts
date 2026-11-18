// ⭐ on the store page: Claude stars the project on GitHub from the user's own account.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { starSteps } from '../plugin/src/recipes.ts'
import { channelText } from '../plugin/src/channel.ts'
import { startHttp } from '../plugin/src/http.ts'
import { createMadar } from '../plugin/src/server.ts'
import { canStar } from '../plugin/ui/logic.js'
import { skillItem, mcpItem } from './helpers.ts'
import type { Catalog } from '../plugin/src/types.ts'

const noRepo = (() => { const { source, ...rest } = mcpItem({ id: 'norepo' }); return { ...rest, publisher: 'com.vendor' } })()

test('star steps: star with the GitHub CLI, then confirm (no leading slash, so Git Bash leaves the path alone)', () => {
  const steps = starSteps(skillItem())
  const cmds = steps.flatMap((s) => s.run ?? [])
  assert.deepEqual(cmds, ["gh api --method PUT 'user/starred/anthropics/skills' --silent", "gh api 'user/starred/anthropics/skills' --silent"])
  assert.equal(steps.at(-1)!.percent, 100)
  assert.throws(() => starSteps(noRepo as any))
})

test('star request line follows the page language', () => {
  assert.equal(channelText({ op: 'star', id: 'pptx', lang: 'en' }), 'Madar: star pptx')
  assert.equal(channelText({ op: 'star', id: 'pptx', lang: 'ar' }), 'مدار: نجّم pptx')
})

test('only items with a GitHub repo can be starred', () => {
  assert.equal(canStar(skillItem()), true)
  assert.equal(canStar(noRepo), false)
})

async function store() {
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const s = await startHttp({ catalog: { version: 1, items: [skillItem(), noRepo as any], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, channelState: () => 'unavailable', onAction: () => {}, run: async () => '' })
  const origin = new URL(s.url).origin
  const post = (body: unknown) => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { s, post }
}

test('the store page sends a star request; an item without a repo is refused', async () => {
  const { s, post } = await store()
  const ctrl = new AbortController()
  const reader = (await fetch(s.watchUrl, { signal: ctrl.signal })).body!.getReader()
  assert.equal((await post({ op: 'star', id: 'pptx', lang: 'en' })).status, 202)
  let text = ''
  while (!/\S.*\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  assert.equal(text.trim(), 'Madar: star pptx')
  assert.equal((await post({ op: 'star', id: 'norepo' })).status, 409)
  // a pending star does not block installing the same item
  assert.equal((await post({ op: 'install', id: 'pptx' })).status, 202)
  ctrl.abort()
  await s.close()
})

test('get_steps star returns the steps and the repo page; no repo → a clear error', async () => {
  const home = mkdtempSync(join(tmpdir(), 'madar-home-'))
  const uiDir = mkdtempSync(join(tmpdir(), 'madar-ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const catalog: Catalog = { version: 1, items: [skillItem(), noRepo as any], bundles: [] }
  const madar = createMadar({ catalog, home, uiDir, claude: '/c/u/claude.exe', run: async () => '' })
  const client = new Client({ name: 't', version: '1' }, { capabilities: {} })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const r: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'star', id: 'pptx' } })
  assert.ok(!r.isError, r.content?.[0]?.text)
  const data = JSON.parse(r.content[0].text)
  assert.equal(data.repoUrl, 'https://github.com/anthropics/skills')
  assert.equal(data.steps.length, 2)
  const bad: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'star', id: 'norepo' } })
  assert.equal(bad.isError, true)
  await madar.close()
})

// ---- ⭐ Madar itself, from the store page (its repo is set when Madar is published) ----

async function selfStore(selfRepo?: string) {
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const s = await startHttp({ catalog: { version: 1, items: [skillItem()], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, channelState: () => 'unavailable', onAction: () => {}, run: async () => '', selfRepo })
  const origin = new URL(s.url).origin
  const post = (body: unknown) => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { s, post, origin }
}

test('the page learns Madar’s own repo and can ask to star it', async () => {
  const { s, post, origin } = await selfStore('someone/madar')
  assert.equal((await (await fetch(`${origin}/api/catalog?key=${s.token}`)).json()).self, 'someone/madar')
  const ctrl = new AbortController()
  const reader = (await fetch(s.watchUrl, { signal: ctrl.signal })).body!.getReader()
  assert.equal((await post({ op: 'star', id: '@madar', lang: 'ar' })).status, 202)
  let text = ''
  while (!/\S.*\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  assert.equal(text.trim(), 'مدار: نجّم @madar')
  ctrl.abort()
  await s.close()
})

test('before Madar is published there is no Madar star', async () => {
  const { s, post, origin } = await selfStore()
  assert.equal((await (await fetch(`${origin}/api/catalog?key=${s.token}`)).json()).self, null)
  assert.equal((await post({ op: 'star', id: '@madar' })).status, 404)
  await s.close()
})

test('get_steps star @madar stars Madar’s own repo', async () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'madar-ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const madar = createMadar({ catalog: { version: 1, items: [], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, claude: '/c/u/claude.exe', run: async () => '', selfRepo: 'someone/madar' })
  const client = new Client({ name: 't', version: '1' }, { capabilities: {} })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const r: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'star', id: '@madar' } })
  assert.ok(!r.isError, r.content?.[0]?.text)
  const data = JSON.parse(r.content[0].text)
  assert.equal(data.repoUrl, 'https://github.com/someone/madar')
  assert.equal(data.progressId, 'star:@madar')
  assert.equal(data.steps[0].run[0], "gh api --method PUT 'user/starred/someone/madar' --silent")
  await madar.close()
})
