// Short share codes (MADAR-482): the setup is posted as a GitHub issue in Madar's setups repo, from the sharer's account.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { shareSteps } from '../plugin/src/recipes.ts'
import { channelText } from '../plugin/src/channel.ts'
import { startHttp } from '../plugin/src/http.ts'
import { createMadar } from '../plugin/src/server.ts'
import { encodeSetup, parseShortCode } from '../plugin/ui/logic.js'

const LONG = encodeSetup(['context7', 'playwright'])

test('long codes are marked so they never look like a short one', () => {
  assert.match(LONG, /^MADAR-X[A-Za-z0-9_-]{10}$/)
})

test('short codes: MADAR- and up to 7 digits, any case, spaces around are fine', () => {
  assert.equal(parseShortCode('MADAR-482'), 482)
  assert.equal(parseShortCode('  madar-482 \n'), 482)
  for (const s of [LONG, 'MADAR-', 'MADAR-0', 'MADAR-12345678', 'MADAR-48a', '482']) assert.equal(parseShortCode(s), null, s)
})

test('share steps post the long code as an issue in the setups repo with the GitHub CLI', () => {
  const cmds = shareSteps('someone/madar-setups', LONG).flatMap((s) => s.run ?? [])
  assert.deepEqual(cmds, [`gh issue create --repo 'someone/madar-setups' --title 'Madar setup' --body '${LONG}'`])
  assert.throws(() => shareSteps('someone/madar-setups', "MADAR-X'; rm -rf ~"))
})

test('share request line follows the page language', () => {
  assert.equal(channelText({ op: 'share', id: LONG, lang: 'en' }), `Madar: share ${LONG}`)
  assert.equal(channelText({ op: 'share', id: LONG, lang: 'ar' }), `مدار: شارك ${LONG}`)
})

async function store(o: { setupsRepo?: string; issue?: any; status?: number } = {}) {
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const calls: string[] = []
  const fakeFetch = (async (u: any) => {
    calls.push(String(u))
    return new Response(JSON.stringify(o.issue ?? {}), { status: o.status ?? 200 })
  }) as any
  const s = await startHttp({ catalog: { version: 1, items: [], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, channelState: () => 'unavailable', onAction: () => {}, run: async () => '', setupsRepo: o.setupsRepo, fetch: fakeFetch })
  const origin = new URL(s.url).origin
  const get = (path: string) => fetch(`${origin}${path}${path.includes('?') ? '&' : '?'}key=${s.token}`)
  const post = (body: unknown) => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { s, get, post, calls }
}

test('the page knows whether short codes are available', async () => {
  const on = await store({ setupsRepo: 'someone/madar-setups' })
  assert.equal((await (await on.get('/api/catalog')).json()).setups, true)
  await on.s.close()
  const off = await store()
  assert.equal((await (await off.get('/api/catalog')).json()).setups, false)
  await off.s.close()
})

test('the page asks Claude to post a share; only a well-formed long code', async () => {
  const { s, post } = await store({ setupsRepo: 'someone/madar-setups' })
  const ctrl = new AbortController()
  const reader = (await fetch(s.watchUrl, { signal: ctrl.signal })).body!.getReader()
  assert.equal((await post({ op: 'share', id: LONG })).status, 202)
  let text = ''
  while (!/\S.*\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  assert.equal(text.trim(), `Madar: share ${LONG}`)
  assert.equal((await post({ op: 'share', id: 'MADAR-X; rm' })).status, 400)
  ctrl.abort()
  await s.close()
  const off = await store()
  assert.equal((await off.post({ op: 'share', id: LONG })).status, 404)
  await off.s.close()
})

test('a short code is read back from its issue', async () => {
  const { s, get, calls } = await store({ setupsRepo: 'someone/madar-setups', issue: { number: 482, body: `${LONG}\n\nshared from Madar`, title: 'Madar setup' } })
  assert.deepEqual(await (await get('/api/setup?n=482')).json(), { code: LONG })
  assert.equal(calls[0], 'https://api.github.com/repos/someone/madar-setups/issues/482')
  assert.equal((await get('/api/setup?n=abc')).status, 400)
  await s.close()
})

test('a short code that is a pull request, has no setup, or is missing reads as not found', async () => {
  for (const o of [{ issue: { number: 1, body: LONG, pull_request: {} } }, { issue: { number: 1, body: 'hello' } }, { status: 404 }]) {
    const { s, get } = await store({ setupsRepo: 'someone/madar-setups', ...o })
    assert.equal((await get('/api/setup?n=1')).status, 404, JSON.stringify(o))
    await s.close()
  }
})

test('get_steps share returns the post step, its progress id, and refuses a bad code', async () => {
  const uiDir = mkdtempSync(join(tmpdir(), 'madar-ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const madar = createMadar({ catalog: { version: 1, items: [], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, claude: '/c/u/claude.exe', run: async () => '', setupsRepo: 'someone/madar-setups' })
  const client = new Client({ name: 't', version: '1' }, { capabilities: {} })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const r: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'share', id: LONG } })
  assert.ok(!r.isError, r.content?.[0]?.text)
  const data = JSON.parse(r.content[0].text)
  assert.equal(data.progressId, 'share')
  assert.equal(data.steps.length, 1)
  const bad: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'share', id: 'nope' } })
  assert.equal(bad.isError, true)
  await madar.close()
})

// ---- ❤ support link (Ko-fi) ----
test('the page gets the support link; only a known donation site over https', async () => {
  const mk = async (supportUrl?: string) => {
    const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
    writeFileSync(join(uiDir, 'index.html'), 'x')
    const s = await startHttp({ catalog: { version: 1, items: [], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, channelState: () => 'unavailable', onAction: () => {}, run: async () => '', supportUrl })
    const body = await (await fetch(`${new URL(s.url).origin}/api/catalog?key=${s.token}`)).json()
    await s.close()
    return body.support
  }
  assert.equal(await mk('https://ko-fi.com/iizhq55'), 'https://ko-fi.com/iizhq55')
  assert.equal(await mk('https://github.com/sponsors/someone'), 'https://github.com/sponsors/someone')
  assert.equal(await mk('http://ko-fi.com/x'), null)
  assert.equal(await mk('https://evil.example/pay'), null)
  assert.equal(await mk(), null)
})

test('Madar ships with the Ko-fi link', async () => {
  const { SUPPORT_URL } = await import('../plugin/src/config.ts')
  assert.equal(SUPPORT_URL, 'https://ko-fi.com/iizhq55')
})
