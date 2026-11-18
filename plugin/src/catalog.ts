import { readFileSync } from 'node:fs'
import type { Catalog, CatalogItem, Bundle } from './types.ts'

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SHA = /^[0-9a-f]{40}$/
const ARG = /^[A-Za-z0-9@._/:=+-]+$/
const ENV = /^[A-Z][A-Z0-9_]*$/
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const COMMANDS = new Set(['npx', 'uvx', 'node', 'python', 'docker'])
const TYPES = new Set(['mcp', 'skill', 'plugin'])
const AFTER = new Set(['none', 'reload-plugins', 'new-session'])
const MEDIA_KINDS = new Set(['image', 'video', 'gif'])

function safePath(p: unknown): boolean {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.split('/').includes('..') && ARG.test(p)
}

function isText(t: any): boolean {
  return t && typeof t.en === 'string' && (t.ar === undefined || typeof t.ar === 'string')
}

/** Returns a reason the item is invalid, or null when valid. */
export function validateItem(x: unknown): string | null {
  const it = x as any
  if (!it || typeof it !== 'object') return 'not an object'
  if (typeof it.id !== 'string' || !ID.test(it.id)) return 'id'
  if (!TYPES.has(it.type)) return 'type'
  if (!isText(it.name) || !isText(it.description)) return 'name/description'
  if (it.source !== undefined && (!it.source || !NAME.test(it.source.owner ?? '') || !NAME.test(it.source.repo ?? ''))) return 'source'
  if (it.publisher !== undefined && !(typeof it.publisher === 'string' && NAME.test(it.publisher))) return 'source'
  if (it.source === undefined && it.publisher === undefined) return 'source'
  if (typeof it.checked !== 'boolean' || !Array.isArray(it.checks)) return 'checks'
  if (!Array.isArray(it.media) || it.media.length > 8 || it.media.some((m: any) => !MEDIA_KINDS.has(m?.kind) || typeof m?.url !== 'string' || !m.url.startsWith('https://'))) return 'media'
  if (it.stats !== undefined) {
    const s = it.stats
    const n = (v: unknown) => Number.isInteger(v) && (v as number) >= 0
    if (!s || !n(s.stars) || !n(s.forks) || !n(s.issues) || (s.contributors !== undefined && !n(s.contributors)) || !/^\d{4}-\d{2}-\d{2}$/.test(s.updatedAt ?? '')) return 'stats'
  }
  if (it.about !== undefined && !isText(it.about)) return 'about'
  if (!AFTER.has(it.after)) return 'after'
  if (it.requires && (!Array.isArray(it.requires) || it.requires.some((r: any) => !ENV.test(r?.env ?? '') || !isText(r.label)))) return 'requires'
  const r = it.recipe
  if (!r || r.kind !== it.type) return 'recipe kind'
  if (r.kind === 'skill') {
    if (!REPO.test(r.repo ?? '')) return 'recipe.repo'
    if (!SHA.test(r.commit ?? '')) return 'recipe.commit'
    if (!safePath(r.path)) return 'recipe.path'
    if (!NAME.test(r.name ?? '')) return 'recipe.name'
  } else if (r.kind === 'mcp') {
    if (!NAME.test(r.name ?? '')) return 'recipe.name'
    if (r.transport === 'http') {
      if (typeof r.url !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(r.url)) return 'recipe.url'
    } else if (r.transport === 'stdio') {
      if (!COMMANDS.has(r.command)) return 'recipe.command'
      if (!Array.isArray(r.args) || r.args.some((a: unknown) => typeof a !== 'string' || !ARG.test(a))) return 'recipe.args'
    } else return 'recipe.transport'
    if (r.env !== undefined && (!Array.isArray(r.env) || r.env.some((e: unknown) => typeof e !== 'string' || !ENV.test(e)))) return 'recipe.env'
    // every env var passed to the server must be one the user is asked for
    const asked = new Set((it.requires ?? []).map((x: any) => x.env))
    if ((r.env ?? []).some((e: string) => !asked.has(e))) return 'recipe.env not in requires'
  } else if (r.kind === 'plugin') {
    if (!REPO.test(r.marketplace ?? '')) return 'recipe.marketplace'
    if (!NAME.test(r.plugin ?? '')) return 'recipe.plugin'
    if (r.name !== undefined && !NAME.test(r.name)) return 'recipe.name'
  }
  return null
}

export function loadCatalog(path: string): { catalog: Catalog; rejected: { id: string; reason: string }[] } {
  return parseCatalog(JSON.parse(readFileSync(path, 'utf8')))
}

/** Validate an already-parsed catalog (from a file or the network); bad items are dropped with a reason. */
export function parseCatalog(raw: any): { catalog: Catalog; rejected: { id: string; reason: string }[] } {
  if (!raw || typeof raw !== 'object') return { catalog: { version: 1, items: [], bundles: [] }, rejected: [{ id: '*', reason: 'not an object' }] }
  const rejected: { id: string; reason: string }[] = []
  const items: CatalogItem[] = []
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    const reason = validateItem(it)
    if (reason) rejected.push({ id: String(it?.id), reason })
    else items.push(it)
  }
  const ids = new Set(items.map((i) => i.id))
  const bundles: Bundle[] = []
  for (const b of Array.isArray(raw.bundles) ? raw.bundles : []) {
    const missing = (Array.isArray(b?.items) ? b.items : [null]).filter((i: string) => !ids.has(i))
    if (!ID.test(b?.id ?? '') || !isText(b?.name) || missing.length) rejected.push({ id: String(b?.id), reason: missing.length ? `bundle items: ${missing.join(',')}` : 'bundle' })
    else bundles.push(b)
  }
  return { catalog: { version: 1, items, bundles }, rejected }
}

export function getItem(c: Catalog, id: string): CatalogItem | undefined {
  return c.items.find((i) => i.id === id)
}
