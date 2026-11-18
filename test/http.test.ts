import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHttp } from '../plugin/src/http.ts'
import { recordInstall } from '../plugin/src/ledger.ts'
import type { Action } from '../plugin/src/types.ts'
import { skillItem, mcpItem } from './helpers.ts'

const catalog = { version: 1 as const, items: [skillItem(), mcpItem()], bundles: [] }

async function setup(channel: 'connected' | 'unavailable' = 'connected') {
  const home = mkdtempSync(join(tmpdir(), 'madar-home-'))
  const uiDir = mkdtempSync(join(tmpdir(), 'madar-ui-'))
  writeFileSync(join(uiDir, 'index.html'), '<h1>store</h1>')
  const actions: Action[] = []
  const s = await startHttp({ catalog, home, uiDir, channelState: () => channel, onAction: (a) => actions.push(a), run: async () => '', lang: 'ar' })
  const origin = new URL(s.url).origin
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}/api/action?key=${s.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...headers },
      body: JSON.stringify(body),
    })
  return { s, home, origin, actions, post }
}

test('binds 127.0.0.1 and the url carries the key', async () => {
  const { s } = await setup()
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/\?key=[0-9a-f]{64}$/)
  await s.close()
})

test('no token → 401 on every route', async () => {
  const { s, origin } = await setup()
  for (const p of ['/', '/api/catalog', '/api/installed', '/api/events']) {
    assert.equal((await fetch(origin + p)).status, 401, p)
  }
  assert.equal((await fetch(origin + '/api/action', { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await fetch(`${origin}/api/catalog?key=wrong`)).status, 401)
  await s.close()
})

test('key in url sets a cookie that works afterwards', async () => {
  const { s, origin } = await setup()
  const r = await fetch(s.url)
  assert.equal(r.status, 200)
  const cookie = r.headers.get('set-cookie')!
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Strict/i)
  const r2 = await fetch(origin + '/api/catalog', { headers: { cookie: cookie.split(';')[0] } })
  assert.equal(r2.status, 200)
  const body = await r2.json()
  assert.equal(body.channel, 'connected')
  assert.equal(body.lang, 'ar')
  assert.equal(body.catalog.items.length, 2)
  await s.close()
})

test('wrong Origin header on POST → 403', async () => {
  const { s, post, actions } = await setup()
  assert.equal((await post({ op: 'install', id: 'pptx' }, { origin: 'https://evil.example' })).status, 403)
  assert.equal(actions.length, 0)
  await s.close()
})

test('bad op → 400, unknown id → 404, onAction not called', async () => {
  const { s, post, actions } = await setup()
  assert.equal((await post({ op: 'run', id: 'pptx' })).status, 400)
  assert.equal((await post({ op: 'install', id: 'ghost' })).status, 404)
  assert.equal(actions.length, 0)
  await s.close()
})

test('extra fields are ignored and never forwarded', async () => {
  const { s, post, actions } = await setup()
  assert.equal((await post({ op: 'install', id: 'pptx', cmd: 'rm -rf ~' })).status, 202)
  assert.deepEqual(actions, [{ op: 'install', id: 'pptx', lang: 'en' }])
  await s.close()
})

test('uninstall of id not in ledger → 409; in ledger → 202', async () => {
  const { s, post, home, actions } = await setup()
  assert.equal((await post({ op: 'uninstall', id: 'pptx' })).status, 409)
  recordInstall(home, { id: 'pptx', type: 'skill', installedAt: 'x', uninstall: [] })
  assert.equal((await post({ op: 'uninstall', id: 'pptx' })).status, 202)
  assert.deepEqual(actions, [{ op: 'uninstall', id: 'pptx', lang: 'en' }])
  await s.close()
})

test('double install while pending → onAction once; done clears pending', async () => {
  const { s, post, actions } = await setup()
  assert.equal((await post({ op: 'install', id: 'pptx' })).status, 202)
  assert.equal((await post({ op: 'install', id: 'pptx' })).status, 202)
  assert.equal(actions.length, 1)
  s.progress('pptx', 100, 'ok', 'ok')
  await post({ op: 'install', id: 'pptx' })
  assert.equal(actions.length, 2)
  await s.close()
})

test('channel unavailable → copy mode with exact text', async () => {
  const { s, post, actions } = await setup('unavailable')
  const r = await post({ op: 'install', id: 'pptx' })
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { mode: 'copy', text: 'Madar: install pptx' })
  assert.equal(actions.length, 0)
  await s.close()
})

test('channel unavailable uninstall text', async () => {
  const { s, post, home } = await setup('unavailable')
  recordInstall(home, { id: 'fs', type: 'mcp', installedAt: 'x', uninstall: [] })
  assert.deepEqual(await (await post({ op: 'uninstall', id: 'fs' })).json(), { mode: 'copy', text: 'Madar: remove fs' })
  await s.close()
})

test('progress() pushes an SSE event', async () => {
  const { s, origin } = await setup()
  const ctrl = new AbortController()
  const r = await fetch(`${origin}/api/events?key=${s.token}`, { signal: ctrl.signal })
  assert.equal(r.headers.get('content-type'), 'text/event-stream')
  const reader = r.body!.getReader()
  s.progress('pptx', 50, 'أتأكد من الفحص والمتطلبات')
  let text = ''
  while (!/data: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  const data = JSON.parse(text.split('data: ')[1])
  assert.deepEqual(data, { id: 'pptx', percent: 50, message: 'أتأكد من الفحص والمتطلبات' })
  ctrl.abort()
  await s.close()
})

test('path traversal outside ui dir → 404', async () => {
  const { s, origin } = await setup()
  const r = await fetch(`${origin}/..%2f..%2fpackage.json?key=${s.token}`)
  assert.equal(r.status, 404)
  await s.close()
})
