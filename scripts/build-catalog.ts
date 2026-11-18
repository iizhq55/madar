// Build catalog/dist/catalog.json from real sources. Runs hourly in GitHub Actions (the "plan" job).
// node scripts/build-catalog.ts [--no-checks] [--defer-works] [--prev-url URL] [--limit N] [--sources path] [--out dir] [--max-checks N]
// --defer-works: don't start any tool here; list them in works-todo.json for the isolated job.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalog, loadPrevState, parseState, worksRunner, type Sources, type State } from '../plugin/src/build/run.ts'
import { loadCatalog } from '../plugin/src/catalog.ts'
import { discover, parseDiscovered, type Discovered } from '../plugin/src/build/discover.ts'

const args = process.argv.slice(2)
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const runChecks = !args.includes('--no-checks')
const deferWorks = args.includes('--defer-works')
const sources: Sources = JSON.parse(readFileSync(opt('--sources') ?? 'catalog/sources.json', 'utf8'))
if (opt('--limit')) sources.registry.limit = Number(opt('--limit'))

const DIST = opt('--out') ?? 'catalog/dist'
mkdirSync(DIST, { recursive: true })

// previous state: the published site (only the deploy job can write it). Only a 404 means a first run;
// any other failure stops here, so a hiccup never publishes a half-empty catalog.
let prev: State | null = null
const prevUrl = opt('--prev-url')
if (prevUrl && /^https:\/\//.test(prevUrl)) {
  try {
    prev = await loadPrevState(fetch, prevUrl)
  } catch (e) {
    console.error(`Could not read the previous state, stopping: ${(e as Error).message}`)
    process.exit(1)
  }
  console.log(prev ? `previous state: ${Object.keys(prev).length} items` : 'no previous state (first run), full build')
} else if (existsSync(join(DIST, 'state.json'))) prev = parseState(readFileSync(join(DIST, 'state.json'), 'utf8'))

// more marketplaces and skill repos, found by GitHub topic about once a day and published as discovered.json
const cfg = (sources as any).discover as { topics: { marketplace: string[]; skills: string[] }; minStars: number; maxRepos: number } | undefined
let found: Discovered | null = null
if (cfg) {
  if (prevUrl) {
    try {
      const r = await fetch(prevUrl.replace(/state\.json$/, 'discovered.json'), { signal: AbortSignal.timeout(20_000) })
      if (r.ok) found = parseDiscovered(await r.text())
    } catch {}
  }
  if (!found || Date.now() - Date.parse(found.at) > 24 * 3_600_000) {
    found = await discover({ fetch, token: process.env.GITHUB_TOKEN, ...cfg, known: [...sources.marketplaces, ...sources.skillRepos], now: new Date(), log: (x) => console.log(x) })
  }
  writeFileSync(join(DIST, 'discovered.json'), JSON.stringify(found))
  sources.marketplaces = [...new Set([...sources.marketplaces, ...found.marketplaces])]
  sources.skillRepos = [...new Set([...sources.skillRepos, ...found.skillRepos])]
  console.log(`sources: ${sources.marketplaces.length} marketplaces, ${sources.skillRepos.length} skill repos`)
}

const descriptions: Record<string, { ar?: string; en?: string }> = {}
for (const f of readdirSync('catalog/descriptions')) if (f.endsWith('.json')) descriptions[f.slice(0, -5)] = JSON.parse(readFileSync(join('catalog/descriptions', f), 'utf8'))
const curated = loadCatalog('plugin/catalog/seed.json').catalog.items

const t0 = Date.now()
const r = await buildCatalog({
  sources,
  fetch,
  prev,
  now: new Date(),
  runChecks,
  deferWorks,
  works: worksRunner(process.env),
  curated,
  maxChecks: Number(opt('--max-checks') ?? 150),
  // the run-check job has ~25 minutes and each tool may take 20 s
  maxWorks: Number(opt('--max-works') ?? 60),
  deadline: t0 + 25 * 60_000,
  // each source already in the catalog is re-read every 6 hours, in its own hour
  rotation: { slot: new Date().getUTCHours(), slots: 6 },
  descriptions,
  token: process.env.GITHUB_TOKEN,
  log: (s) => process.stdout.write(s + '\n'),
})
// a sudden drop means something went wrong upstream: keep the site as it is rather than publish a gutted catalog
const before = prev ? Object.keys(prev).length : 0
const after = Object.keys(r.state).length
if (before >= 20 && after < before * 0.7) {
  console.error(`Catalog shrank from ${before} to ${after} items; not publishing this run.`)
  process.exit(1)
}
r.catalog.items.sort((a, b) => Number(b.checked) - Number(a.checked) || b.stars - a.stars)
writeFileSync(join(DIST, 'catalog.json'), JSON.stringify(r.catalog))
writeFileSync(join(DIST, 'rejected.json'), JSON.stringify(r.rejected, null, 2))
writeFileSync(join(DIST, 'state.json'), JSON.stringify(r.state))
if (deferWorks) writeFileSync(join(DIST, 'works-todo.json'), JSON.stringify(r.todo))

const norm = (s: string) => s.replace(/\(.*\)|\d+ |https?:\S+/g, '').trim()
const reasons = new Map<string, number>()
for (const x of r.rejected) reasons.set(norm(x.reason), (reasons.get(norm(x.reason)) ?? 0) + 1)
console.log(`\n${r.catalog.items.length} items (${r.catalog.items.filter((i) => i.checked).length} checked), ${Object.keys(r.todo).length} to run, ${r.deferred.length} left for the next run, ${r.rejected.length} rejected, ${Math.round((Date.now() - t0) / 1000)}s`)
console.log([...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `  ${v} × ${k}`).join('\n'))
process.exit(0)
