// Builds the catalog from real sources. Incremental: unchanged versions checked within 7 days are reused.
// Fails closed: a check that could not look at the code never passes, and a result is only kept for the code it was about.
import { createHash } from 'node:crypto'
import type { Catalog, CatalogItem, Check, McpRecipe, Recipe, Text } from '../types.ts'
import { validateItem } from '../catalog.ts'
import { fromRegistry, fromMarketplace, fromSkillDir, slug, type Built, type Rejected } from './recipes-from.ts'
import { extractMedia, extractAbout, parseRepoStats, type Stats } from './media.ts'
import { checkActive, checkLicense, checkTrusted, staticScan, checkWorks, type RepoMeta } from './checks.ts'
import { mergeItem, isChecked } from './merge.ts'
import { readNpmPackage } from './npm.ts'

export type Sources = {
  registry: { url: string; limit: number }
  marketplaces: string[]
  skillRepos: string[]
  trustedOrgs: string[]
  categories: Record<string, string>
  skip?: string[]
  /** Domain namespaces in the MCP registry whose GitHub owner Madar has confirmed by hand, e.g. { "com.example": "example-org" }. */
  namespaceOwners?: Record<string, string>
}
export type StateEntry = { version: string; item: CatalogItem; checkedAt: string; statsAt?: string; withChecks?: boolean; worksPending?: boolean }
export type State = Record<string, StateEntry>
export type WorksResult = { pass: boolean; needsKey: boolean; detail?: Text }
type Fetch = typeof fetch
type Works = (r: McpRecipe, timeoutMs?: number) => Promise<{ check: Check; needsKey: boolean }>
type Entry = { path: string; sha: string }

const DAY_MS = 86_400_000
const WEEK = 7 * DAY_MS
/** A result is never shown as checked for longer than this without a fresh check. */
const MAX_KEEP = 2 * WEEK
const t = (en: string, ar: string): Text => ({ en, ar })
const PENDING: Check = { key: 'works', pass: false, detail: t('Run check pending', 'فحص التشغيل بالانتظار') }
const NOT_YET: Check = { key: 'static', pass: false, detail: t('Not checked yet; checks run within a few hours', 'ما انفحصت للحين، الفحص خلال ساعات') }
const KEY_UNASKED: Check = { key: 'works', pass: false, detail: t('Asks for a key Madar doesn’t know how to ask you for', 'تطلب مفتاح ما يعرف مدار يطلبه منك') }

// ---- what the scan reads ----
/** GitHub scan of a remote (http) server's repo: informational, the code runs on their side. */
const REPO_CODE = /\.(m?[jt]sx?|cjs|py|sh|json)$/
const REPO_SKIP_DIRS = /(^|\/)(node_modules|test|tests|dist|examples?)\//
const MAX_REPO_SCAN = 40
/** Skills and plugins: the folder IS what gets installed, so every file is read or the scan fails. */
const MEDIA = /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf)$/i
const BINARY = /\.(exe|dll|so|dylib|node|bin|jar|class|pyc|wasm|zip|tar|gz|tgz|7z|rar|msi|dmg|appimage)$/i
const DOCS = /(^|\/)(README|CHANGELOG|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)[^/]*$/i
const MAX_DIR_SCAN = 200
const MAX_TEXT = 400_000
const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

/** Starting third-party servers happens only in the throwaway GitHub Actions runner, never on someone's own computer. */
export function worksRunner(env: NodeJS.ProcessEnv): Works {
  if (env.CI === 'true' && env.GITHUB_ACTIONS === 'true') return checkWorks
  return async () => ({ check: { key: 'works', pass: false, detail: t('Run check happens only in the isolated GitHub build', 'فحص التشغيل يصير بس داخل بيئة GitHub المعزولة') }, needsKey: false })
}

/** What a recipe installs, ignoring the pinned version: two items with the same key are the same tool. */
function recipeKey(r: Recipe): string {
  if (r.kind === 'plugin') return `plugin:${r.marketplace}/${r.plugin}`.toLowerCase()
  if (r.kind === 'skill') return `skill:${r.repo}/${r.path}`.toLowerCase()
  if (r.transport === 'http') return `mcp:${r.url}`.toLowerCase()
  const pkg = (r.args ?? []).filter((a) => !a.startsWith('-')).pop() ?? ''
  return `mcp:${r.command}:${pkg.replace(/==.*$/, '').replace(/(.)@[^@/]*$/, '$1')}`.toLowerCase()
}

/** Installs exactly the code that was checked (a commit, an exact package version). Plugins and remote servers don't. */
const pinned = (r: Recipe) => r.kind === 'skill' || (r.kind === 'mcp' && r.transport === 'stdio')

/** "@scope/pkg@1.2.3" → name + version. */
function npmSpec(r: McpRecipe): { name: string; version: string } | null {
  if (r.command !== 'npx') return null
  const m = /^(@?[^@]+)@(\d[^@]*)$/.exec((r.args ?? []).filter((a) => !a.startsWith('-')).pop() ?? '')
  return m ? { name: m[1], version: m[2] } : null
}

/** A folder's identity in a git tree: changes exactly when a file under it changes. */
function dirHash(entries: Entry[], dir: string): string {
  const h = createHash('sha1')
  for (const e of entries.filter((e) => !dir || e.path.startsWith(dir + '/')).sort((a, b) => (a.path < b.path ? -1 : 1))) h.update(`${e.path}\0${e.sha}\n`)
  return h.digest('hex').slice(0, 16)
}

export async function buildCatalog(opts: {
  sources: Sources
  fetch: Fetch
  prev: State | null
  now: Date
  runChecks: boolean
  works?: Works
  /** Don't start servers here: list them in `todo` for the isolated run-check job, and mark them pending. */
  deferWorks?: boolean
  /** At most this many tools go to the run-check job per run (each may take 20 s); the rest wait, pending. */
  maxWorks?: number
  /** Hand-picked items (the plugin's seed): their ids and types never change, and built copies of the same tool are dropped. */
  curated?: CatalogItem[]
  /** At most this many items get a full (re)check per run; the rest keep their previous result where that is safe. */
  maxChecks?: number
  /** Stop starting new checks after this time (ms since epoch). */
  deadline?: number
  /** Many sources, one hourly API budget: a source already in the catalog is re-read only in its own slot (slot = hour). */
  rotation?: { slot: number; slots: number }
  descriptions?: Record<string, { ar?: string; en?: string }>
  token?: string
  log?: (s: string) => void
}): Promise<{ catalog: Catalog; rejected: { id: string; reason: string }[]; state: State; todo: Record<string, McpRecipe>; deferred: string[] }> {
  const { sources, now } = opts
  const works = opts.works ?? worksRunner(process.env)
  const log = opts.log ?? (() => {})
  const today = now.toISOString().slice(0, 10)
  const gh: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'madar-catalog', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }
  const rejected: { id: string; reason: string }[] = []
  const state: State = {}
  const items: CatalogItem[] = [...(opts.curated ?? [])]
  const todo: Record<string, McpRecipe> = {}
  const deferred: string[] = []
  let exhausted = false
  let checksDone = 0
  const budgetLeft = () => !exhausted && checksDone < (opts.maxChecks ?? Infinity) && (!opts.deadline || Date.now() < opts.deadline)
  const queueWorks = (id: string, r: McpRecipe) => {
    if (Object.keys(todo).length < (opts.maxWorks ?? Infinity)) todo[id] = r
  }

  const getJson = async (url: string, headers: Record<string, string> = {}) => {
    const r = await opts.fetch(url, { headers })
    if (url.startsWith('https://api.github.com/') && (r.status === 429 || (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0'))) exhausted = true
    if (!r.ok) throw new Error(`${r.status} ${url}`)
    return { body: await r.json(), link: r.headers.get('link') }
  }
  /** For prose (README): missing is fine. */
  const getText = async (url: string) => {
    const r = await opts.fetch(url)
    return r.ok ? r.text() : null
  }
  /** For code under scan: a file we could not read fails the check. */
  const getCode = async (url: string) => {
    const r = await opts.fetch(url)
    if (!r.ok) throw new Error(`could not read ${url} (${r.status})`)
    return r.text()
  }

  // ---- repo facts, cached per repo ----
  const repos = new Map<string, Promise<{ meta: RepoMeta; stats: Stats; branch: string }>>()
  const repo = (full: string) => {
    if (!repos.has(full))
      repos.set(full, (async () => {
        const { body } = await getJson(`https://api.github.com/repos/${full}`, gh)
        let link: string | null = null
        try { link = (await getJson(`https://api.github.com/repos/${full}/contributors?per_page=1&anon=1`, gh)).link } catch {}
        return {
          meta: { pushedAt: body.pushed_at, createdAt: body.created_at, license: body.license?.spdx_id ?? null, owner: body.owner?.login ?? full.split('/')[0], stars: body.stargazers_count, archived: !!body.archived },
          stats: parseRepoStats(body, link),
          branch: body.default_branch ?? 'main',
        }
      })())
    return repos.get(full)!
  }
  // no catch: a listing GitHub would not give must not look like an empty repo
  const trees = new Map<string, Promise<Entry[]>>()
  const tree = (full: string, ref: string) => {
    const k = `${full}@${ref}`
    if (!trees.has(k)) trees.set(k, getJson(`https://api.github.com/repos/${full}/git/trees/${ref}?recursive=1`, gh).then(({ body }) => {
      if (body.truncated) throw new Error(`tree too large: ${full}`)
      return (body.tree ?? []).filter((x: any) => x.type === 'blob').map((x: any) => ({ path: String(x.path), sha: String(x.sha ?? '') }))
    }))
    return trees.get(k)!
  }

  /**
   * A previous result for code we could not (re)check this run. It stays checked only while it describes
   * what a click installs: same version, or a pinned recipe (which still installs the checked version),
   * and never for longer than two weeks.
   */
  const kept = (prev: StateEntry, sameVersion: boolean): CatalogItem => {
    const old = now.getTime() - Date.parse(prev.checkedAt) >= MAX_KEEP
    if (!old && (sameVersion || pinned(prev.item.recipe))) return prev.item
    const detail = old ? t('Not re-checked for two weeks; waiting for a new check', 'ما انفحصت من أسبوعين، تنتظر فحص جديد') : t('Changed since it was checked; waiting for a new check', 'تغيّرت بعد ما انفحصت، تنتظر فحص جديد')
    const checks = [...prev.item.checks.filter((c) => c.key !== 'static'), { key: 'static' as const, pass: false, detail }]
    return { ...prev.item, checks, checked: false }
  }
  const reuse = (id: string, prev: StateEntry, sameVersion: boolean) => {
    items.push(kept(prev, sameVersion))
    state[id] = prev
  }

  // ---- collect candidates ----
  type Cand = Built & { version: string }
  const cands: Cand[] = []
  const reject = (id: string, r: Rejected) => rejected.push({ id, reason: r.reject })
  const keepPrev = (prefix: string, err: unknown) => {
    for (const [id, s] of Object.entries(opts.prev ?? {})) {
      if (s.version.startsWith(prefix)) {
        reuse(id, s, true)
        if (err) rejected.push({ id, reason: `kept previous: ${(err as Error).message}` })
      }
    }
  }
  /** Not this source's slot, and it is already in the catalog: keep its items as they are (no calls). */
  const resting = (source: string, prefix: string) => {
    const rot = opts.rotation
    if (!rot || rot.slots <= 1) return false
    const slot = parseInt(createHash('sha1').update(source.toLowerCase()).digest('hex').slice(0, 8), 16) % rot.slots
    if (slot === ((rot.slot % rot.slots) + rot.slots) % rot.slots) return false
    if (!Object.values(opts.prev ?? {}).some((s) => s.version.startsWith(prefix))) return false
    keepPrev(prefix, null)
    return true
  }

  try {
    // all pages or nothing: a failure part-way falls back to the previous registry items as a whole
    const found: Cand[] = []
    const rej: [string, Rejected][] = []
    let cursor = ''
    let seen = 0
    while (seen < sources.registry.limit) {
      const { body } = await getJson(`${sources.registry.url}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      for (const e of body.servers ?? []) {
        if (e?._meta?.['io.modelcontextprotocol.registry/official']?.isLatest === false) continue
        seen++
        const r = fromRegistry(e, sources.namespaceOwners)
        if ('reject' in r) rej.push([slug(e?.server?.name ?? '?'), r])
        else {
          const rc = r.item.recipe as McpRecipe
          found.push({ ...r, version: `registry:${rc.transport === 'http' ? rc.url : rc.args!.join(' ')}` })
        }
        if (seen >= sources.registry.limit) break
      }
      cursor = body.metadata?.nextCursor ?? ''
      if (!cursor) break
    }
    cands.push(...found)
    for (const [id, r] of rej) reject(id, r)
  } catch (e) {
    keepPrev('registry:', e)
  }

  for (const mp of sources.marketplaces) {
    if (resting(mp, `plugin:${mp}@`)) continue
    try {
      // one commit for the list and the code it points to
      const head = (await getJson(`https://api.github.com/repos/${mp}/commits/HEAD`, gh)).body.sha as string
      const { body } = await getJson(`https://raw.githubusercontent.com/${mp}/${head}/.claude-plugin/marketplace.json`)
      const built = fromMarketplace(mp, body)
      const local = built.some((r) => !('reject' in r) && !r.ref && !r.unverified)
      const entries = local ? await tree(mp, head) : []
      for (const r of built) {
        if ('reject' in r) reject(mp, r)
        else if (r.ref) cands.push({ ...r, version: `plugin:${mp}@ext:${r.item.source!.owner}/${r.item.source!.repo}@${r.ref}:${r.dir}` })
        else if (r.unverified) cands.push({ ...r, version: `plugin:${mp}@unverified:${r.item.id}` })
        else cands.push({ ...r, ref: head, version: `plugin:${mp}@local:${r.dir}:${dirHash(entries, r.dir)}` })
      }
    } catch (e) {
      keepPrev(`plugin:${mp}@`, e)
    }
  }

  for (const sr of sources.skillRepos) {
    if (resting(sr, `skill:${sr}@`)) continue
    try {
      const { body } = await getJson(`https://api.github.com/repos/${sr}/commits/HEAD`, gh)
      const sha = body.sha as string
      for (const { path: p } of (await tree(sr, sha)).filter((x) => x.path.endsWith('/SKILL.md'))) {
        const dir = p.slice(0, -'/SKILL.md'.length)
        const md = await getText(`https://raw.githubusercontent.com/${sr}/${sha}/${encodePath(p)}`)
        if (!md) continue
        const r = fromSkillDir(sr, sha, dir, md)
        if ('reject' in r) reject(`${sr}/${dir}`, r)
        else cands.push({ ...r, version: `skill:${sr}@${sha}:${dir}`, ref: sha })
      }
    } catch (e) {
      keepPrev(`skill:${sr}@`, e)
    }
  }

  // ---- curated tools win; unique ids: a clash gets the owner as prefix ----
  const curatedKeys = new Set((opts.curated ?? []).map((i) => recipeKey(i.recipe)))
  const taken = new Set(items.map((i) => i.id))
  const keep = cands.filter((c) => !curatedKeys.has(recipeKey(c.item.recipe)))
  for (const c of keep) {
    if (taken.has(c.item.id)) {
      const stem = slug(`${c.item.source?.owner ?? c.item.publisher ?? 'other'}-${c.item.id}`)
      let id = stem
      for (let n = 2; taken.has(id); n++) id = slug(`${stem.slice(0, 60)}-${n}`)
      c.item = { ...c.item, id, recipe: c.item.recipe.kind === 'mcp' ? { ...c.item.recipe, name: id } : c.item.recipe }
    }
    taken.add(c.item.id)
  }

  // ---- the code scan: reads exactly what a click installs ----
  const scan = async (c: Cand, full: string, ref: string): Promise<{ check: Check; startsServers: boolean }> => {
    const r = c.item.recipe
    if (r.kind === 'mcp' && r.transport === 'stdio') {
      const spec = npmSpec(r)
      if (!spec) return { check: { key: 'static', pass: false, detail: t('Python packages can’t be read yet', 'ما نقدر نقرأ حزم بايثون للحين') }, startsServers: false }
      const pkg = await readNpmPackage(opts.fetch, spec.name, spec.version)
      return { check: pkg.problem ? { key: 'static', pass: false, detail: t(pkg.problem, 'ما قدرنا نقرأ الحزمة كاملة') } : staticScan(pkg.files), startsServers: false }
    }
    const entries = await tree(full, ref)
    if (r.kind === 'mcp') {
      const files = entries.map((e) => e.path).filter((p) => (!c.dir || p.startsWith(c.dir + '/')) && REPO_CODE.test(p) && !REPO_SKIP_DIRS.test(p)).slice(0, MAX_REPO_SCAN)
      const texts = (await Promise.all(files.map(async (p) => ({ path: p, text: await getCode(`https://raw.githubusercontent.com/${full}/${ref}/${encodePath(p)}`) })))).filter((f) => f.text.length < MAX_TEXT)
      return { check: staticScan(texts), startsServers: false }
    }
    const mine = entries.map((e) => e.path).filter((p) => !c.dir || p.startsWith(c.dir + '/'))
    const bin = mine.find((p) => BINARY.test(p))
    if (bin) return { check: { key: 'static', pass: false, detail: t(`${bin}: a binary file we can’t read`, `${bin}: ملف ما نقدر نقرأه`) }, startsServers: false }
    const files = mine.filter((p) => !MEDIA.test(p) && !DOCS.test(p))
    if (files.length > MAX_DIR_SCAN) return { check: { key: 'static', pass: false, detail: t('Too many files to read', 'فيها ملفات أكثر من اللي نقدر نقرأه') }, startsServers: false }
    const texts = await Promise.all(files.map(async (p) => ({ path: p, text: await getCode(`https://raw.githubusercontent.com/${full}/${ref}/${encodePath(p)}`) })))
    const big = texts.find((f) => f.text.length >= MAX_TEXT)
    if (big) return { check: { key: 'static', pass: false, detail: t(`${big.path}: too large to read`, `${big.path}: أكبر من اللي نقدر نقرأه`) }, startsServers: false }
    const rel = (p: string) => (c.dir ? p.slice(c.dir.length + 1) : p)
    const startsServers = texts.some((f) => rel(f.path) === '.mcp.json' || (/(^|\/)plugin\.json$/.test(rel(f.path)) && /"mcpServers"/.test(f.text)))
    return { check: staticScan(texts), startsServers }
  }

  // ---- enrich + check ----
  const skip = new Set(sources.skip ?? [])
  for (const c of keep) {
    const id = c.item.id
    if (skip.has(id)) continue
    const prev = opts.prev?.[id]
    const sameVersion = !!prev && prev.version === c.version
    try {
      const base = { desc: opts.descriptions?.[id], category: sources.categories[id] ?? 'other', today }
      if (c.unverified) {
        // ownership or code can't be confirmed: list it with the source's own words only, never checked
        const item = mergeItem(c.item, { ...base, stats: null, checks: [{ key: 'trusted', pass: false, detail: c.unverified }], needsKey: false, media: [], about: '' })
        const bad = validateItem(item)
        if (bad) { rejected.push({ id, reason: `invalid after build: ${bad}` }); continue }
        items.push(item)
        state[id] = { version: c.version, item, checkedAt: now.toISOString(), withChecks: opts.runChecks }
        continue
      }
      const age = prev ? now.getTime() - Date.parse(prev.checkedAt) : Infinity
      // still waiting for its run check: queue it again, nothing to re-scan
      if (prev && sameVersion && prev.worksPending && opts.deferWorks && age < WEEK && prev.item.recipe.kind === 'mcp') {
        queueWorks(id, prev.item.recipe)
        items.push(prev.item)
        state[id] = prev
        continue
      }
      const fresh = !!prev && sameVersion && age < WEEK && (!opts.runChecks || prev.withChecks === true) && !prev.worksPending
      // hourly runs: an unchanged item reuses everything, and refreshes its numbers once a day
      if (fresh && (exhausted || now.getTime() - Date.parse(prev.statsAt ?? prev.checkedAt) < DAY_MS)) { reuse(id, prev, true); continue }
      if (!fresh && !budgetLeft()) {
        if (prev) reuse(id, prev, sameVersion)
        else {
          // list it now with the source's own words; the checks (and numbers) arrive on a later run
          deferred.push(id)
          const item = mergeItem(c.item, { ...base, stats: null, checks: [NOT_YET], needsKey: false, media: [], about: '' })
          if (!validateItem(item)) items.push(item)
        }
        continue
      }
      const full = `${c.item.source!.owner}/${c.item.source!.repo}`
      const info = await repo(full)
      if (fresh) {
        const item = { ...prev.item, stats: info.stats, stars: info.stats.stars, updatedAt: info.stats.updatedAt }
        items.push(item)
        state[id] = { ...prev, item, statsAt: now.toISOString() }
        continue
      }
      checksDone++
      const ref = c.ref ?? info.branch
      const readme = (await getText(`https://raw.githubusercontent.com/${full}/${ref}/${c.dir ? encodePath(c.dir) + '/' : ''}README.md`)) ?? (c.item.type === 'skill' ? await getText(`https://raw.githubusercontent.com/${full}/${ref}/${encodePath(c.dir)}/SKILL.md`) : null)
      const checks: Check[] = [checkActive(info.meta, now), checkLicense(info.meta), checkTrusted(info.meta, sources.trustedOrgs, now, (c.item.recipe as McpRecipe).url)]
      let needsKey = false
      let worksPending = false
      if (opts.runChecks) {
        const s = await scan(c, full, ref)
        checks.push(s.check)
        if (c.item.recipe.kind === 'mcp') {
          if (opts.deferWorks) {
            queueWorks(id, c.item.recipe)
            checks.push(PENDING)
            worksPending = true
          } else {
            const w = await works(c.item.recipe)
            const unaskable = w.needsKey && !c.item.requires?.length
            checks.push(unaskable ? KEY_UNASKED : w.check)
            needsKey = w.needsKey && !unaskable
          }
        } else if (s.startsServers) {
          checks.push({ key: 'works', pass: false, detail: t('Starts its own servers, which haven’t been run yet', 'تشغّل خوادم خاصة فيها ما انفحصت للحين') })
        } else {
          checks.push({ key: 'works', pass: true, detail: c.item.type === 'skill' ? t('Valid SKILL.md', 'ملف المهارة سليم') : t(`Latest version checked on ${today}`, `فُحصت آخر نسخة بتاريخ ${today}`) })
        }
      }
      const item = mergeItem(c.item, { ...base, stats: info.stats, checks, needsKey, media: readme ? extractMedia(readme, full, ref, c.dir) : [], about: readme ? extractAbout(readme) : '' })
      const bad = validateItem(item)
      if (bad) { rejected.push({ id, reason: `invalid after build: ${bad}` }); continue }
      items.push(item)
      state[id] = { version: c.version, item, checkedAt: now.toISOString(), statsAt: now.toISOString(), withChecks: opts.runChecks, ...(worksPending ? { worksPending } : {}) }
      log(`${item.checked ? '✓' : worksPending ? '…' : '·'} ${id}`)
    } catch (e) {
      const msg = (e as Error).message
      if (prev) { reuse(id, prev, sameVersion); rejected.push({ id, reason: `kept previous: ${msg}` }) }
      else if (c.item.type === 'mcp' && msg.startsWith('404 https://api.github.com/repos/')) {
        // its GitHub repo is gone: still listed with the publisher's own words, never checked
        const item = mergeItem(c.item, { desc: opts.descriptions?.[id], category: sources.categories[id] ?? 'other', today, stats: null, checks: [{ key: 'trusted', pass: false, detail: t('Its source code repo is gone', 'مستودع كودها انحذف') }], needsKey: false, media: [], about: '' })
        if (!validateItem(item)) items.push(item)
        rejected.push({ id, reason: 'listed unchecked: repo gone' })
      } else rejected.push({ id, reason: msg })
    }
  }

  // one entry per id, first wins (curated, then kept, then built)
  const seen = new Set<string>()
  const unique = items.filter((i) => !seen.has(i.id) && (seen.add(i.id), true))
  return { catalog: { version: 1, items: unique, bundles: [] }, rejected, state, todo, deferred }
}

const isText = (x: any): x is Text => !!x && typeof x.en === 'string' && x.en.length <= 200 && (x.ar === undefined || (typeof x.ar === 'string' && x.ar.length <= 200))

/**
 * Fills in run-check results from the isolated job. Only ids the build asked about, for the exact recipe it asked about,
 * only well-formed results. Results are data from a job that ran third-party code: they can change one check and the
 * needs-key badge, nothing else.
 */
export function applyWorks<T extends { catalog: Catalog; state: State; todo: Record<string, McpRecipe> }>(build: T, results: Record<string, WorksResult>): T {
  const state: State = { ...build.state }
  const items = build.catalog.items.map((it) => {
    const r = results && Object.hasOwn(results, it.id) ? results[it.id] : undefined
    if (!Object.hasOwn(build.todo, it.id) || JSON.stringify(build.todo[it.id]) !== JSON.stringify(it.recipe)) return it
    if (!r || typeof r.pass !== 'boolean' || typeof r.needsKey !== 'boolean') return it
    const unaskable = r.needsKey && !it.requires?.length
    const detail = isText(r.detail) ? r.detail : r.pass ? t('Starts and lists its tools', 'تشتغل فعلاً') : t('Did not start', 'ما اشتغلت')
    const works: Check = unaskable ? KEY_UNASKED : { key: 'works', pass: r.pass, detail }
    const checks = it.checks.map((c) => (c.key === 'works' ? works : c))
    const badges = new Set(it.badges ?? [])
    if (r.needsKey && !unaskable) badges.add('needs-key')
    const next: CatalogItem = { ...it, checks, checked: isChecked(checks), ...(badges.size ? { badges: [...badges] } : {}) }
    if (state[it.id]) state[it.id] = { ...state[it.id], item: next, worksPending: false }
    return next
  })
  return { ...build, catalog: { ...build.catalog, items }, state }
}

const KIND_OF: Record<string, CatalogItem['type']> = { registry: 'mcp', plugin: 'plugin', skill: 'skill' }

/**
 * The previous run's state, as published next to the catalog. Treated as untrusted:
 * malformed entries and dates in the future are dropped, and `checked` is recomputed from the checks.
 */
export function parseState(raw: string, now: Date = new Date()): State {
  let data: any
  try { data = JSON.parse(raw) } catch { return {} }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: State = {}
  const limit = now.getTime() + 3_600_000
  const date = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && Date.parse(s) <= limit
  for (const [id, s] of Object.entries<any>(data)) {
    if (!s || typeof s.version !== 'string' || !date(s.checkedAt) || (s.statsAt !== undefined && !date(s.statsAt))) continue
    if (!s.item || s.item.id !== id || validateItem(s.item)) continue
    if (KIND_OF[s.version.split(':')[0]] !== s.item.type) continue
    if (!s.item.checks.every((c: any) => c && typeof c.key === 'string' && typeof c.pass === 'boolean')) continue
    out[id] = { ...s, item: { ...s.item, checked: isChecked(s.item.checks) } }
  }
  return out
}

/** Previous state from the published site. Only "not there" (404) means a first run; anything else stops the build. */
export async function loadPrevState(fetch: Fetch, url: string, now: Date = new Date()): Promise<State | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`previous state: ${r.status} ${url}`)
  return parseState(await r.text(), now)
}
