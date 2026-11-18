// Finds more plugin marketplaces and skill repos on GitHub by topic. Runs about once a day; the result is published
// next to the catalog (discovered.json) and read back by the hourly runs.

export type Discovered = { at: string; marketplaces: string[]; skillRepos: string[] }

const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/

export async function discover(opts: {
  fetch: typeof fetch
  token?: string
  topics: { marketplace: string[]; skills: string[] }
  minStars: number
  /** At most this many candidate repos are looked at, most stars first. */
  maxRepos: number
  /** Sources already configured by hand. */
  known: string[]
  now: Date
  log?: (s: string) => void
}): Promise<Discovered> {
  const log = opts.log ?? (() => {})
  const gh: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'madar-catalog', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }
  const known = new Set(opts.known.map((r) => r.toLowerCase()))
  const cands = new Map<string, { stars: number; skills: boolean }>()

  const search = async (topic: string, skills: boolean) => {
    for (let page = 1; page <= 3; page++) {
      const q = `topic:${topic} stars:>=${opts.minStars} archived:false fork:false`
      try {
        const r = await opts.fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`, { headers: gh })
        if (!r.ok) { log(`search ${topic}: ${r.status}`); return }
        const items: any[] = (await r.json())?.items ?? []
        for (const it of items) {
          const full = String(it?.full_name ?? '')
          if (!REPO.test(full) || it.archived || it.fork || known.has(full.toLowerCase())) continue
          const c = cands.get(full) ?? { stars: Number(it.stargazers_count) || 0, skills: false }
          c.skills ||= skills
          cands.set(full, c)
        }
        if (items.length < 100) return
      } catch (e) {
        log(`search ${topic}: ${(e as Error).message}`)
        return
      }
    }
  }
  for (const tp of opts.topics.marketplace) await search(tp, false)
  for (const tp of opts.topics.skills) await search(tp, true)

  const marketplaces: string[] = []
  const skillRepos: string[] = []
  const ranked = [...cands].sort((a, b) => b[1].stars - a[1].stars).slice(0, opts.maxRepos)
  for (const [full, c] of ranked) {
    try {
      // a marketplace is a repo with .claude-plugin/marketplace.json (raw files cost no API calls)
      const mp = await opts.fetch(`https://raw.githubusercontent.com/${full}/HEAD/.claude-plugin/marketplace.json`)
      if (mp.ok) {
        const body = await mp.json().catch(() => null)
        if (Array.isArray(body?.plugins) && body.plugins.length) { marketplaces.push(full); continue }
      }
      if (!c.skills) continue
      const tr = await opts.fetch(`https://api.github.com/repos/${full}/git/trees/HEAD?recursive=1`, { headers: gh })
      if (!tr.ok) continue
      const tree: any[] = (await tr.json())?.tree ?? []
      if (tree.some((x) => x?.type === 'blob' && /(^|\/)SKILL\.md$/.test(String(x.path)))) skillRepos.push(full)
    } catch {}
  }
  log(`discovered ${marketplaces.length} marketplaces, ${skillRepos.length} skill repos`)
  return { at: opts.now.toISOString(), marketplaces, skillRepos }
}

/** A discovered list read back from the site; anything malformed counts as missing. */
export function parseDiscovered(raw: string): Discovered | null {
  try {
    const d = JSON.parse(raw)
    if (typeof d?.at !== 'string' || Number.isNaN(Date.parse(d.at))) return null
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((r): r is string => typeof r === 'string' && REPO.test(r)) : [])
    return { at: d.at, marketplaces: list(d.marketplaces), skillRepos: list(d.skillRepos) }
  } catch {
    return null
  }
}
