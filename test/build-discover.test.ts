// Finding more plugin marketplaces and skill repos on GitHub, and refreshing many sources within the hourly budget.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discover } from '../plugin/src/build/discover.ts'
import { buildCatalog, type Sources } from '../plugin/src/build/run.ts'

const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } })
const repoHit = (full: string, stars = 50) => ({ full_name: full, stargazers_count: stars, archived: false, fork: false })

function fakeGitHub(calls: string[] = []) {
  return async (input: any) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://api.github.com/search/repositories')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '')
      if (q.includes('topic:claude-code-plugin')) return json({ items: [repoHit('a/market', 300), repoHit('known/plugs', 900)] })
      if (q.includes('topic:claude-skills')) return json({ items: [repoHit('b/skills', 120), repoHit('c/empty', 80), repoHit('a/market', 300)] })
      return json({ items: [] })
    }
    if (url === 'https://raw.githubusercontent.com/a/market/HEAD/.claude-plugin/marketplace.json') return json({ name: 'market', plugins: [{ name: 'p1', source: './p1' }] })
    if (url.includes('/b/skills/git/trees/HEAD')) return json({ tree: [{ path: 'one/SKILL.md', type: 'blob', sha: 'x' }] })
    if (url.includes('/c/empty/git/trees/HEAD')) return json({ tree: [{ path: 'README.md', type: 'blob', sha: 'x' }] })
    return new Response('nope', { status: 404 })
  }
}

const topics = { marketplace: ['claude-code-plugin'], skills: ['claude-skills'] }

test('discovery finds marketplaces and skill repos by GitHub topic, and skips ones already configured', async () => {
  const d = await discover({ fetch: fakeGitHub() as any, topics, minStars: 10, maxRepos: 50, known: ['known/plugs'], now: new Date('2026-11-18T00:00:00Z') })
  assert.deepEqual(d.marketplaces, ['a/market'])
  assert.deepEqual(d.skillRepos, ['b/skills'])
  assert.equal(d.at, '2026-11-18T00:00:00.000Z')
})

test('discovery keeps going when one search fails', async () => {
  const base = fakeGitHub()
  const flaky = async (u: any) => (String(u).includes('topic%3Aclaude-code-plugin') || String(u).includes('topic:claude-code-plugin') ? new Response('busy', { status: 502 }) : base(u))
  const d = await discover({ fetch: flaky as any, topics, minStars: 10, maxRepos: 50, known: [], now: new Date() })
  assert.deepEqual(d.skillRepos, ['b/skills'])
})

// ---- many sources, one hourly budget: each source is re-read in its own slot, the rest keep their items ----
// (one/skills hashes to slot 0 of 2, eight/skills to slot 1)
const SHA = 'b'.repeat(40)
function fakeSources(calls: string[]) {
  return async (input: any) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://registry.example/')) return json({ servers: [], metadata: {} })
    if (url.includes('/commits/HEAD')) return json({ sha: SHA })
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url)) return json({ stargazers_count: 900, forks_count: 1, open_issues_count: 0, pushed_at: '2026-11-10T00:00:00Z', created_at: '2024-01-01T00:00:00Z', license: { spdx_id: 'MIT' }, archived: false, default_branch: 'main', owner: { login: url.split('/')[4] } })
    if (url.includes('/contributors')) return json([])
    if (url.includes('/git/trees/')) return json({ tree: [{ path: 's1/SKILL.md', type: 'blob', sha: 'e' }] })
    if (url.endsWith('/SKILL.md')) return new Response(`---\nname: ${url.split('/')[3]}-skill\ndescription: Does a thing.\n---\n`, { status: 200 })
    return new Response('nope', { status: 404 })
  }
}

test('with rotation, a source outside its slot keeps its items and costs no calls', async () => {
  const sources: Sources = { registry: { url: 'https://registry.example/v0/servers', limit: 10 }, marketplaces: [], skillRepos: ['one/skills', 'eight/skills'], trustedOrgs: ['one', 'eight'], categories: {} }
  const works = async () => ({ check: { key: 'works' as const, pass: true }, needsKey: false })
  const now = new Date('2026-11-18T00:00:00Z')
  const first = await buildCatalog({ sources, fetch: fakeSources([]) as any, prev: null, now, runChecks: true, works })
  assert.equal(first.catalog.items.length, 2)
  const calls: string[] = []
  const r = await buildCatalog({ sources, fetch: fakeSources(calls) as any, prev: first.state, now: new Date(now.getTime() + 3_600_000), runChecks: true, works, rotation: { slot: 0, slots: 2 } })
  const touched = ['one/skills', 'eight/skills'].filter((s) => calls.some((u) => u.includes(`/repos/${s}/commits/HEAD`)))
  assert.equal(touched.length, 1, `one source per slot, got ${touched}`)
  assert.equal(r.catalog.items.length, 2)
  assert.ok(r.catalog.items.every((i) => i.checked))
  assert.ok(!r.rejected.some((x) => x.reason.startsWith('kept previous')), 'a rotated source is not an error')
})

test('a new source is read at once, whatever its slot', async () => {
  const sources: Sources = { registry: { url: 'https://registry.example/v0/servers', limit: 10 }, marketplaces: [], skillRepos: ['one/skills', 'two/skills'], trustedOrgs: [], categories: {} }
  const works = async () => ({ check: { key: 'works' as const, pass: true }, needsKey: false })
  const calls: string[] = []
  const r = await buildCatalog({ sources, fetch: fakeSources(calls) as any, prev: null, now: new Date('2026-11-18T00:00:00Z'), runChecks: true, works, rotation: { slot: 0, slots: 24 } })
  assert.equal(r.catalog.items.length, 2)
})
