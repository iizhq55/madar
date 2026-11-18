import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterItems, sortItems, pickText, buttonState, byline } from '../plugin/ui/logic.js'
import { skillItem, mcpItem, pluginItem } from './helpers.ts'

const items = [
  skillItem(),
  mcpItem({ name: { en: 'Browser Control', ar: 'تحكّم بالمتصفح' }, description: { en: 'Opens websites' } }),
  pluginItem(),
  mcpItem({ id: 'old', checked: false, name: { en: 'Old Thing' } }),
]
const base = { tab: 'all', query: '', installedIds: new Set<string>() }
const ids = (xs: any[]) => xs.map((x) => x.id)

test('everything shows by default, checked or not', () => {
  assert.deepEqual(ids(filterItems(items, base)), ['pptx', 'fs', 'cr', 'old'])
})

test('checked items come first, then the most stars', () => {
  const xs = [mcpItem({ id: 'a', checked: false, stars: 9000 }), mcpItem({ id: 'b', checked: true, stars: 5 }), mcpItem({ id: 'c', checked: true, stars: 50 })]
  assert.deepEqual(ids(sortItems(xs)), ['c', 'b', 'a'])
})

test('tabs filter by type', () => {
  assert.deepEqual(ids(filterItems(items, { ...base, tab: 'mcp' })), ['fs', 'old'])
  assert.deepEqual(ids(filterItems(items, { ...base, tab: 'skill' })), ['pptx'])
  assert.deepEqual(ids(filterItems(items, { ...base, tab: 'plugin' })), ['cr'])
})

test('search matches ar and en name/description case-insensitively', () => {
  assert.deepEqual(ids(filterItems(items, { ...base, query: 'BROWSER' })), ['fs'])
  assert.deepEqual(ids(filterItems(items, { ...base, query: 'المتصفح' })), ['fs'])
  assert.deepEqual(ids(filterItems(items, { ...base, query: 'websites' })), ['fs'])
  assert.deepEqual(ids(filterItems(items, { ...base, query: '  ' })), ['pptx', 'fs', 'cr', 'old'])
})

test('installed tab lists installed only, including unchecked ones', () => {
  assert.deepEqual(ids(filterItems(items, { ...base, tab: 'installed', installedIds: new Set(['cr', 'old']) })), ['cr', 'old'])
})

test('missing ar falls back to en', () => {
  assert.equal(pickText({ en: 'Hello' }, 'ar'), 'Hello')
  assert.equal(pickText({ en: 'Hello', ar: 'هلا' }, 'ar'), 'هلا')
  assert.equal(pickText({ en: 'Hello', ar: 'هلا' }, 'en'), 'Hello')
})

test('button states', () => {
  const s = { pending: new Set(['a']), installedIds: new Set(['b', 'c']), byMadarIds: new Set(['b']) }
  assert.equal(buttonState('a', s), 'busy')
  assert.equal(buttonState('b', s), 'installed')
  assert.equal(buttonState('c', s), 'installed-manual')
  assert.equal(buttonState('d', s), 'install')
})

test('byline: GitHub owner/repo when there is a source, the publisher otherwise', () => {
  assert.equal(byline(mcpItem(), true), 'anthropics/skills')
  assert.equal(byline(mcpItem(), false), 'anthropics')
  const { source, ...rest } = mcpItem()
  assert.equal(byline({ ...rest, publisher: 'com.example' } as any, true), 'com.example')
})

// ---- sharing a setup with a short code: 5 characters per item, read back against the store's catalog ----
import { encodeSetup, decodeSetup } from '../plugin/ui/logic.js'

const catalogIds = ['context7', 'playwright', 'frontend-design', 'skill-creator', 'code-review', 'notion', 'github', 'pptx']

test('a setup code is short and reads back to the same items', () => {
  const ids = ['context7', 'playwright', 'frontend-design', 'skill-creator', 'code-review']
  const code = encodeSetup(ids)
  assert.match(code, /^MADAR-[A-Za-z0-9_-]+$/)
  assert.equal(code.length, 'MADAR-X'.length + 5 * ids.length)
  assert.deepEqual(decodeSetup(code, catalogIds), { ids, missing: 0 })
  assert.deepEqual(decodeSetup(`  ${code}
`, catalogIds), { ids, missing: 0 }, 'spaces around a pasted code are fine')
})

test('items no longer in the store are counted as missing; duplicates once; at most 50', () => {
  const code = encodeSetup(['context7', 'gone-tool', 'context7'])
  assert.deepEqual(decodeSetup(code, catalogIds), { ids: ['context7'], missing: 1 })
  const many = Array.from({ length: 80 }, (_, i) => `tool-${i}`)
  assert.equal(decodeSetup(encodeSetup(many), many).ids.length, 50)
})

test('anything that is not a setup code reads as nothing', () => {
  for (const s of ['', 'hello', 'MADAR-', 'MADAR-!!!!!', 'MADAR-AAAA', 'context7']) assert.deepEqual(decodeSetup(s, catalogIds), { ids: [], missing: 0 }, s)
})

// ---- Ko-fi panel: their donation page in a sealed frame, never their script in our page ----
import { kofiEmbed } from '../plugin/ui/logic.js'

test('Ko-fi links become the embedded donation panel; anything else does not', () => {
  assert.equal(kofiEmbed('https://ko-fi.com/iizhq55'), 'https://ko-fi.com/iizhq55/?hidefeed=true&widget=true&embed=true')
  assert.equal(kofiEmbed('https://ko-fi.com/iizhq55/'), 'https://ko-fi.com/iizhq55/?hidefeed=true&widget=true&embed=true')
  for (const u of ['https://github.com/sponsors/x', 'http://ko-fi.com/x', 'https://ko-fi.com.evil.example/x', null]) assert.equal(kofiEmbed(u), null, String(u))
})
