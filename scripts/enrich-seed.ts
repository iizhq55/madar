// Fill stats, the project's own media and its intro text into the seed catalog from GitHub.
// Uses the same functions the hourly catalog build will use. Run: node scripts/enrich-seed.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { extractMedia, extractAbout, parseRepoStats } from '../plugin/src/build/media.ts'
import { validateItem } from '../plugin/src/catalog.ts'

const FILE = 'plugin/catalog/seed.json'
const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'madar-catalog' }
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const repoCache = new Map<string, any>()
async function repoInfo(repo: string) {
  if (!repoCache.has(repo)) {
    const r = await fetch(`https://api.github.com/repos/${repo}`, { headers })
    if (!r.ok) throw new Error(`${repo}: ${r.status}`)
    const json = await r.json()
    const c = await fetch(`https://api.github.com/repos/${repo}/contributors?per_page=1&anon=1`, { headers })
    repoCache.set(repo, { json, stats: parseRepoStats(json, c.headers.get('link')) })
  }
  return repoCache.get(repo)
}
async function raw(repo: string, ref: string, path: string): Promise<string | null> {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`)
  return r.ok ? r.text() : null
}

const seed = JSON.parse(readFileSync(FILE, 'utf8'))
for (const it of seed.items) {
  const repo = `${it.source.owner}/${it.source.repo}`
  try {
    const info = await repoInfo(repo)
    it.stats = info.stats
    it.stars = info.stats.stars
    it.updatedAt = info.stats.updatedAt
    const r = it.recipe
    const ref = r.kind === 'skill' ? r.commit : info.json.default_branch
    const dir = r.kind === 'skill' ? r.path : r.kind === 'plugin' ? `plugins/${r.plugin}` : ''
    const readme = (await raw(repo, ref, `${dir ? dir + '/' : ''}README.md`)) ?? (r.kind === 'skill' ? await raw(repo, ref, `${dir}/SKILL.md`) : null)
    if (readme) {
      it.media = extractMedia(readme, repo, ref, dir)
      const about = extractAbout(readme)
      if (about) it.about = { ...(it.about?.ar ? { ar: it.about.ar } : {}), en: about }
    } else it.media = []
    const bad = validateItem(it)
    console.log(`${it.id.padEnd(18)} ★${it.stats.stars} media:${it.media.length} about:${it.about?.en?.length ?? 0}${bad ? '  INVALID ' + bad : ''}`)
  } catch (e) {
    console.log(`${it.id.padEnd(18)} kept as is: ${(e as Error).message}`)
  }
}
writeFileSync(FILE, JSON.stringify(seed, null, 2) + '\n')
