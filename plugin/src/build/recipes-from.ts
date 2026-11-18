// Structured source data → pinned recipes. Never reads README prose (spec §5.3).
import type { CatalogItem, McpRecipe, PluginRecipe, SkillRecipe, Text } from '../types.ts'

export type Partial_ = Partial<CatalogItem> & { id: string; recipe: CatalogItem['recipe'] }
/** ref: the commit or branch to read code at. unverified: why the code or ownership cannot be confirmed (the item is listed, never checked). */
export type Built = { item: Partial_; dir: string; ref?: string; unverified?: Text }
export type Rejected = { reject: string }

const EXACT = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/
const ARG = /^[A-Za-z0-9@._/:=+-]+$/
const ENV = /^[A-Z][A-Z0-9_]*$/
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')
}

function githubRepo(url: unknown): { owner: string; repo: string } | null {
  const m = typeof url === 'string' ? /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url) : null
  return m ? { owner: m[1], repo: m[2] } : null
}

const short = (s: unknown, n = 160) => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'
}

const SHA40 = /^[0-9a-f]{40}$/
const SUBDIR = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/
const NOT_OWNER: Text = { en: 'Can’t confirm this repository belongs to the publisher', ar: 'ما نقدر نتأكد إن المستودع تابع للناشر' }
const NO_REPO: Text = { en: 'No public source code on GitHub to check', ar: 'ما لها كود منشور في قيت هب نفحصه' }
const NO_CODE: Text = { en: 'Can’t read this plugin’s code to check it', ar: 'ما نقدر نقرأ كود الإضافة عشان نفحصها' }

/**
 * The registry proves who owns a server name (GitHub sign-in for io.github.<owner>, DNS for domains),
 * but not the repository link. The link counts only when the proven owner is the repo's owner.
 */
function linkVerified(name: string, owner: string, namespaceOwners: Record<string, string>): boolean {
  const ns = name.split('/')[0]
  const proven = /^io\.github\.([A-Za-z0-9-]+)$/.exec(ns)?.[1] ?? namespaceOwners[ns]
  return !!proven && proven.toLowerCase() === owner.toLowerCase()
}

export function fromRegistry(entry: any, namespaceOwners: Record<string, string> = {}): Built | Rejected {
  const s = entry?.server
  const off = entry?._meta?.['io.modelcontextprotocol.registry/official']
  if (!s?.name) return { reject: 'no name' }
  if (off && off.isLatest === false) return { reject: 'not the latest version' }
  if (off && off.status && off.status !== 'active') return { reject: `status ${off.status}` }
  // no public GitHub repo: still listed (by its publisher), never checked
  const source = githubRepo(s.repository?.url)
  const publisher = String(s.name).split('/')[0]
  const id = slug(s.name)
  if (id.length < 2) return { reject: 'bad name' }

  let recipe: McpRecipe | null = null
  let requires: CatalogItem['requires'] = []
  let why = 'no supported package or remote'

  for (const p of s.packages ?? []) {
    if (p?.transport?.type !== 'stdio') { why = `transport ${p?.transport?.type}`; continue }
    if (!EXACT.test(p.version ?? '')) { why = `version not pinned (${p.version})`; continue }
    if ([...(p.packageArguments ?? []), ...(p.runtimeArguments ?? [])].some((a: any) => a?.isRequired)) { why = 'needs arguments'; continue }
    let command: string, args: string[]
    if (p.registryType === 'npm') [command, args] = ['npx', ['-y', `${p.identifier}@${p.version}`]]
    else if (p.registryType === 'pypi') [command, args] = ['uvx', [`${p.identifier}==${p.version}`]]
    else { why = `${p.registryType} packages not supported yet`; continue }
    if (!args.every((a) => ARG.test(a))) { why = 'package name has unsupported characters'; continue }
    const req = (p.environmentVariables ?? []).filter((e: any) => e?.isRequired)
    if (req.some((e: any) => !ENV.test(e?.name ?? ''))) { why = 'bad env name'; continue }
    requires = req.map((e: any) => ({ env: e.name, label: { en: short(e.description || e.name, 80) } }))
    recipe = { kind: 'mcp', name: id, transport: 'stdio', command, args, ...(req.length ? { env: req.map((e: any) => e.name) } : {}) }
    break
  }
  if (!recipe) {
    for (const r of s.remotes ?? []) {
      if (r?.type !== 'streamable-http') { why = `remote ${r?.type}`; continue }
      if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(r.url ?? '')) { why = 'remote url is templated or not https'; continue }
      if ((r.headers ?? []).some((h: any) => h?.isRequired)) { why = 'remote needs headers'; continue }
      recipe = { kind: 'mcp', name: id, transport: 'http', url: r.url }
      break
    }
  }
  if (!recipe) return { reject: why }

  const item: Partial_ = {
    id,
    type: 'mcp',
    name: { en: short(s.title || s.name.split('/').pop(), 60) },
    description: { en: short(s.description) || s.name },
    ...(source ? { source } : { publisher }),
    recipe,
    after: 'none',
    ...(requires.length ? { requires, badges: ['needs-key'] as 'needs-key'[] } : {}),
  }
  return {
    item,
    dir: typeof s.repository?.subfolder === 'string' ? s.repository.subfolder.replace(/^\/+|\/+$/g, '') : '',
    ...(!source ? { unverified: NO_REPO } : linkVerified(s.name, source.owner, namespaceOwners) ? {} : { unverified: NOT_OWNER }),
  }
}

/** Where a marketplace plugin's code really lives: in the marketplace repo, or another GitHub repo pinned to a commit. */
function pluginSource(src: any): { source?: { owner: string; repo: string }; dir: string; ref?: string } | null {
  if (typeof src === 'string') {
    const dir = src.replace(/^\.\//, '').replace(/\/+$/, '')
    return dir === '' || SUBDIR.test(dir) ? { dir } : null
  }
  const where = src?.source === 'github' && typeof src.repo === 'string' ? githubRepo(`https://github.com/${src.repo}`) : src?.source === 'url' || src?.source === 'git-subdir' ? githubRepo(src.url) : null
  // only git-subdir installs a subfolder; for other sources scan the whole repo (a superset of what is installed)
  const dir = src?.source === 'git-subdir' && typeof src.path === 'string' ? src.path.replace(/^\.?\/+/, '').replace(/\/+$/, '') : ''
  if (!where || !SHA40.test(src.sha ?? '') || (dir && !SUBDIR.test(dir))) return null
  return { source: where, dir, ref: src.sha }
}

export function fromMarketplace(repo: string, mp: any): (Built | Rejected)[] {
  const [owner, name] = repo.split('/')
  return (mp?.plugins ?? []).map((p: any): Built | Rejected => {
    if (!PLUGIN_NAME.test(p?.name ?? '')) return { reject: `bad plugin name ${p?.name}` }
    const recipe: PluginRecipe = { kind: 'plugin', marketplace: repo, plugin: p.name, ...(typeof mp?.name === 'string' && PLUGIN_NAME.test(mp.name) && mp.name !== name ? { name: mp.name } : {}) }
    const where = pluginSource(p.source)
    const item: Partial_ = { id: p.name, type: 'plugin', name: { en: p.name.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) }, description: { en: short(p.description) || p.name }, source: where?.source ?? { owner, repo: name }, recipe, after: 'reload-plugins' }
    if (!where || where.dir.split('/').some((seg) => seg === '..' || seg === '.')) return { item, dir: '', unverified: NO_CODE }
    return { item, dir: where.dir, ...(where.ref ? { ref: where.ref } : {}) }
  })
}

/** Minimal frontmatter reader: `key: value` and folded/literal blocks (`>-`, `|`). */
function frontmatter(md: string): Record<string, string> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!m) return null
  const out: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let v = kv[2].trim()
    if (/^[>|][-+]?$/.test(v)) {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim())
      v = block.join(' ')
    }
    out[kv[1]] = v.replace(/^["']|["']$/g, '')
  }
  return out
}

export function fromSkillDir(repo: string, commit: string, path: string, skillMd: string): Built | Rejected {
  const fm = frontmatter(skillMd)
  if (!fm?.name) return { reject: 'SKILL.md has no name' }
  const name = slug(fm.name)
  if (!name) return { reject: 'bad skill name' }
  const [owner, r] = repo.split('/')
  const recipe: SkillRecipe = { kind: 'skill', repo, commit, path, name }
  return {
    item: { id: name, type: 'skill', name: { en: fm.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }, description: { en: short(fm.description) || fm.name }, source: { owner, repo: r }, recipe, after: 'none' },
    dir: path,
  }
}
