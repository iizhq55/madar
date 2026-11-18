// The plugin's catalog: live (hourly build) → last good copy → bundled seed.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Catalog } from './types.ts'
import { parseCatalog, loadCatalog } from './catalog.ts'

type Result = { catalog: Catalog; source: 'remote' | 'cache' | 'seed'; rejected: { id: string; reason: string }[] }

export async function loadBestCatalog(opts: { url: string; cacheFile: string; seedFile: string; fetch: typeof fetch; timeoutMs?: number }): Promise<Result> {
  if (/^https:\/\//.test(opts.url)) {
    try {
      const r = await opts.fetch(opts.url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) })
      if (r.ok) {
        const text = await r.text()
        const parsed = parseCatalog(JSON.parse(text))
        if (parsed.catalog.items.length) {
          mkdirSync(dirname(opts.cacheFile), { recursive: true })
          writeFileSync(opts.cacheFile + '.tmp', JSON.stringify(parsed.catalog))
          renameSync(opts.cacheFile + '.tmp', opts.cacheFile)
          return { ...parsed, source: 'remote' }
        }
      }
    } catch {}
  }
  if (existsSync(opts.cacheFile)) {
    try {
      const parsed = parseCatalog(JSON.parse(readFileSync(opts.cacheFile, 'utf8')))
      if (parsed.catalog.items.length) return { ...parsed, source: 'cache' }
    } catch {}
  }
  return { ...loadCatalog(opts.seedFile), source: 'seed' }
}
