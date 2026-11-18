import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBestCatalog } from '../plugin/src/remote-catalog.ts'
import { skillItem, mcpItem } from './helpers.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'madar-rc-'))
const seedFile = (d: string) => {
  const f = join(d, 'seed.json')
  writeFileSync(f, JSON.stringify({ version: 1, items: [skillItem({ id: 'seeded' })], bundles: [] }))
  return f
}
const remote = (body: unknown, status = 200) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as any
const URL_ = 'https://example.github.io/madar/catalog.json'

test('remote ok → remote, cache written', async () => {
  const d = dir()
  const r = await loadBestCatalog({ url: URL_, cacheFile: join(d, 'cache.json'), seedFile: seedFile(d), fetch: remote({ version: 1, items: [skillItem(), mcpItem()], bundles: [] }) })
  assert.equal(r.source, 'remote')
  assert.equal(r.catalog.items.length, 2)
  assert.ok(existsSync(join(d, 'cache.json')))
})

test('remote timeout → cache', async () => {
  const d = dir()
  writeFileSync(join(d, 'cache.json'), JSON.stringify({ version: 1, items: [mcpItem({ id: 'cached' })], bundles: [] }))
  const hang = (async (_u: any, o: any) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('timeout'))))) as any
  const t0 = Date.now()
  const r = await loadBestCatalog({ url: URL_, cacheFile: join(d, 'cache.json'), seedFile: seedFile(d), fetch: hang, timeoutMs: 200 })
  assert.equal(r.source, 'cache')
  assert.equal(r.catalog.items[0].id, 'cached')
  assert.ok(Date.now() - t0 < 2000)
})

test('remote invalid JSON or HTTP error → cache, cache untouched', async () => {
  const d = dir()
  const cache = JSON.stringify({ version: 1, items: [mcpItem({ id: 'cached' })], bundles: [] })
  writeFileSync(join(d, 'cache.json'), cache)
  for (const f of [remote('{oops'), remote('down', 503)]) {
    const r = await loadBestCatalog({ url: URL_, cacheFile: join(d, 'cache.json'), seedFile: seedFile(d), fetch: f })
    assert.equal(r.source, 'cache')
  }
  assert.equal(readFileSync(join(d, 'cache.json'), 'utf8'), cache)
})

test('no remote, no cache → seed', async () => {
  const d = dir()
  const r = await loadBestCatalog({ url: URL_, cacheFile: join(d, 'none.json'), seedFile: seedFile(d), fetch: remote('x', 500) })
  assert.equal(r.source, 'seed')
  assert.equal(r.catalog.items[0].id, 'seeded')
})

test('remote items failing validation are dropped, the rest kept', async () => {
  const d = dir()
  const r = await loadBestCatalog({ url: URL_, cacheFile: join(d, 'c.json'), seedFile: seedFile(d), fetch: remote({ version: 1, items: [skillItem(), skillItem({ id: 'Bad Id' })], bundles: [] }) })
  assert.equal(r.source, 'remote')
  assert.equal(r.catalog.items.length, 1)
  assert.equal(r.rejected[0].id, 'Bad Id')
})

test('an empty remote catalog is not trusted over the cache', async () => {
  const d = dir()
  writeFileSync(join(d, 'cache.json'), JSON.stringify({ version: 1, items: [mcpItem({ id: 'cached' })], bundles: [] }))
  const r = await loadBestCatalog({ url: URL_, cacheFile: join(d, 'cache.json'), seedFile: seedFile(d), fetch: remote({ version: 1, items: [], bundles: [] }) })
  assert.equal(r.source, 'cache')
})

test('remote url must be https; an empty url means "not published yet" → cache or seed', async () => {
  const d = dir()
  let called = false
  const spy = (async () => { called = true; return new Response('{}') }) as any
  for (const url of ['http://example.com/c.json', '']) {
    const r = await loadBestCatalog({ url, cacheFile: join(d, 'none.json'), seedFile: seedFile(d), fetch: spy })
    assert.equal(r.source, 'seed')
  }
  assert.equal(called, false)
})
