// The store is English by default; an install request reaches Claude in the page's language.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHttp } from '../plugin/src/http.ts'
import { channelText } from '../plugin/src/channel.ts'
import { recordInstall } from '../plugin/src/ledger.ts'
import type { Action } from '../plugin/src/types.ts'
import { skillItem } from './helpers.ts'

async function setup(channel: 'connected' | 'unavailable') {
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  writeFileSync(join(uiDir, 'index.html'), 'x')
  const home = mkdtempSync(join(tmpdir(), 'h-'))
  const actions: Action[] = []
  const s = await startHttp({ catalog: { version: 1, items: [skillItem()], bundles: [] }, home, uiDir, channelState: () => channel, onAction: (a) => actions.push(a), run: async () => '' })
  const origin = new URL(s.url).origin
  const post = (body: unknown) => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { s, origin, actions, post, home }
}

test('the store opens in English unless told otherwise', async () => {
  const { s, origin } = await setup('unavailable')
  assert.equal((await (await fetch(`${origin}/api/catalog?key=${s.token}`)).json()).lang, 'en')
  await s.close()
})

test('copy text follows the page language', async () => {
  const { s, post, home } = await setup('unavailable')
  assert.equal((await (await post({ op: 'install', id: 'pptx' })).json()).text, 'Madar: install pptx')
  assert.equal((await (await post({ op: 'install', id: 'pptx', lang: 'en' })).json()).text, 'Madar: install pptx')
  assert.equal((await (await post({ op: 'install', id: 'pptx', lang: 'ar' })).json()).text, 'مدار: ثبّت pptx')
  recordInstall(home, { id: 'pptx', type: 'skill', installedAt: 'x', uninstall: [] })
  assert.equal((await (await post({ op: 'uninstall', id: 'pptx', lang: 'en' })).json()).text, 'Madar: remove pptx')
  assert.equal((await (await post({ op: 'uninstall', id: 'pptx', lang: 'ar' })).json()).text, 'مدار: شيل pptx')
  await s.close()
})

test('an unknown language falls back to English', async () => {
  const { s, post } = await setup('unavailable')
  assert.equal((await (await post({ op: 'install', id: 'pptx', lang: 'fr; rm -rf /' })).json()).text, 'Madar: install pptx')
  await s.close()
})

test('watch lines follow the page language', async () => {
  const { s, post } = await setup('unavailable')
  const ctrl = new AbortController()
  const reader = (await fetch(s.watchUrl, { signal: ctrl.signal })).body!.getReader()
  await post({ op: 'install', id: 'pptx', lang: 'ar' })
  let text = ''
  while (!/\S.*\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value)
  assert.equal(text.trim(), 'مدار: ثبّت pptx')
  ctrl.abort()
  await s.close()
})

test('channel action carries the language; channel text follows it', async () => {
  const { s, post, actions } = await setup('connected')
  await post({ op: 'install', id: 'pptx', lang: 'ar' })
  assert.deepEqual(actions, [{ op: 'install', id: 'pptx', lang: 'ar' }])
  assert.equal(channelText({ op: 'install', id: 'x', lang: 'en' }), 'Madar: install x')
  assert.equal(channelText({ op: 'uninstall', id: 'x', lang: 'ar' }), 'مدار: شيل x')
  await s.close()
})
