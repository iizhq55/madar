import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Catalog } from './types.ts'
import { getItem } from './catalog.ts'
import { installSteps, uninstallSteps, starSteps, updateSteps, shareSteps } from './recipes.ts'
import { readLedger, recordInstall, removeEntry } from './ledger.ts'
import { startHttp, type HttpHandle } from './http.ts'
import { listInstalled } from './installed.ts'
import { loadBestCatalog } from './remote-catalog.ts'
import { CATALOG_URL, MADAR_REPO, SETUPS_REPO, SUPPORT_URL, SELF_ID, LONG_CODE, validRepo } from './config.ts'
import { createChannel, CHANNEL } from './channel.ts'

export type MadarOpts = {
  catalog: Catalog
  home: string
  uiDir: string
  claude: string
  run: (cmd: string) => Promise<string>
  /** Reload the live catalog; called by open_store when the copy is more than an hour old. */
  refresh?: () => Promise<{ catalog: Catalog; source: 'remote' | 'cache' | 'seed' }>
  now?: () => number
  /** Madar's own repo, for its ⭐ button and the update check. */
  selfRepo?: string
  /** The running Madar version (plugin.json). */
  version?: string
  /** Where shared setups are posted, for short codes. */
  setupsRepo?: string
  /** ❤ Support link. */
  supportUrl?: string
}
const REFRESH_MS = 60 * 60_000

/** `C:\Users\x` → `/c/Users/x` so generated commands work in Git Bash. */
export function toPosix(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/')
}

/** The CLI running this session first (desktop app ships its own), then the standard install, then PATH. */
export function findClaude(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const running = env.CLAUDE_CODE_EXECPATH
  if (running && !/["$`]/.test(running) && existsSync(running)) return running
  for (const f of ['claude.exe', 'claude']) {
    const p = join(home, '.local', 'bin', f)
    if (existsSync(p)) return p
  }
  return 'claude'
}

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })
const fail = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] })

export function createMadar(opts: MadarOpts) {
  const server = new McpServer({ name: 'madar', version: '0.1.0' }, { capabilities: { tools: {}, experimental: { [CHANNEL]: {} } } })
  const channel = createChannel(server.server)
  const posixHome = toPosix(opts.home)
  const claude = toPosix(opts.claude)
  let http: Promise<HttpHandle> | undefined
  const now = opts.now ?? Date.now
  let loadedAt: number | null = null
  let source: 'remote' | 'cache' | 'seed' = 'seed'

  const ensureHttp = () =>
    (http ??= startHttp({
      catalog: opts.catalog,
      home: opts.home,
      uiDir: opts.uiDir,
      channelState: () => channel.state(),
      onAction: (a) => channel.emit(a),
      run: opts.run,
      selfRepo: opts.selfRepo,
      version: opts.version,
      setupsRepo: opts.setupsRepo,
      supportUrl: opts.supportUrl,
    }))

  /** Reload the live catalog when the copy is more than an hour old; every tool sees the same items as the page. */
  let refreshing: Promise<void> | undefined
  const ensureFresh = () =>
    (refreshing ??= (async () => {
      const t = now()
      if (opts.refresh && (loadedAt === null || t - loadedAt >= REFRESH_MS)) {
        try {
          const r = await opts.refresh()
          // same object the store page reads, so it sees the new items without a restart
          opts.catalog.items = r.catalog.items
          opts.catalog.bundles = r.catalog.bundles
          source = r.source
        } catch {}
        loadedAt = t
      }
    })().finally(() => { refreshing = undefined }))

  const Op = z.enum(['install', 'uninstall'])

  server.registerTool(
    'madar_open_store',
    { description: 'Start the Madar store page and return its local URL (open it in the browser pane).', inputSchema: { lang: z.enum(['ar', 'en']).optional() } },
    async () => {
      await ensureFresh()
      const h = await ensureHttp()
      // when there is no channel, Claude runs this with its Monitor tool so Install clicks reach it directly
      return ok({ url: h.url, channel: channel.state(), source, items: opts.catalog.items.length, watch: `curl -sN '${h.watchUrl}' | grep --line-buffered -v '^$'` })
    },
  )

  server.registerTool(
    'madar_get_steps',
    { description: 'Get the exact steps (with shell commands) to install, uninstall or star a catalog item. Run only these commands.', inputSchema: { op: z.enum(['install', 'uninstall', 'star', 'update', 'share']), id: z.string() } },
    async ({ op, id }) => {
      if (op === 'share') {
        if (!validRepo(opts.setupsRepo)) return fail('Short codes work once Madar is published.')
        if (!LONG_CODE.test(id)) return fail('That is not a Madar setup code.')
        return ok({ item: { id: 'share', type: 'plugin', name: { en: 'Your setup', ar: 'أدواتك' } }, progressId: 'share', setupsRepo: opts.setupsRepo, steps: shareSteps(opts.setupsRepo!, id) })
      }
      if (op === 'update') {
        if (id !== SELF_ID || !validRepo(opts.selfRepo)) return fail('Only Madar itself can be updated here, once it is published.')
        return ok({ item: { id, type: 'plugin', name: { en: 'Madar', ar: 'مدار' }, after: 'reload-plugins', requires: [], checked: true }, steps: updateSteps({ claude }) })
      }
      await ensureFresh()
      // ⭐ Madar itself
      const [owner, repo] = (opts.selfRepo ?? '').split('/')
      const item = op === 'star' && id === SELF_ID && validRepo(opts.selfRepo)
        ? ({ id, type: 'plugin', name: { en: 'Madar', ar: 'مدار' }, source: { owner, repo } } as any)
        : getItem(opts.catalog, id)
      if (op === 'star') {
        if (!item) return fail(`Unknown item: ${id}`)
        if (!item.source) return fail(`${id} has no GitHub repo, so there is nothing to star.`)
        return ok({ item: { id: item.id, type: item.type, name: item.name }, repoUrl: `https://github.com/${item.source.owner}/${item.source.repo}`, progressId: `star:${id}`, steps: starSteps(item) })
      }
      if (op === 'uninstall') {
        // removal comes from the ledger, so it works even after the item left the catalog
        const entry = readLedger(opts.home).find((e) => e.id === id)
        if (!entry) return fail(`Madar did not install ${id}, so it will not remove it.`)
        const summary = item
          ? { id: item.id, type: item.type, name: item.name, after: item.after, requires: [], checked: item.checked }
          : { id, type: entry.type, name: { en: id }, after: 'none', requires: [], checked: true }
        return ok({ item: summary, steps: entry.uninstall })
      }
      if (!item) return fail(`Unknown item: ${id}`)
      const summary = { id: item.id, type: item.type, name: item.name, after: item.after, requires: item.requires ?? [], checked: item.checked }
      const already = (await listInstalled(opts.home, opts.catalog, opts.run)).some((r) => r.id === id)
      if (already) return fail(`${id} is already installed on this machine, so Madar will not install over it.`)
      return ok({ item: summary, steps: installSteps(item, { home: posixHome, tmp: toPosix(tmpdir()), claude, platform: process.platform }) })
    },
  )

  server.registerTool(
    'madar_report_progress',
    {
      description: 'Show install progress on the store page.',
      inputSchema: { id: z.string(), percent: z.number().min(0).max(100), message: z.string().max(200), done: z.enum(['ok', 'fail', 'needs-step']).optional() },
    },
    async ({ id, percent, message, done }) => {
      ;(await ensureHttp()).progress(id, percent, message, done)
      return ok({})
    },
  )

  server.registerTool(
    'madar_record',
    { description: 'Record that an item was installed or uninstalled by Madar (after the last step succeeded).', inputSchema: { op: Op, id: z.string() } },
    async ({ op, id }) => {
      if (op === 'uninstall') {
        removeEntry(opts.home, id)
        return ok({})
      }
      const item = getItem(opts.catalog, id)
      if (!item) return fail(`Unknown item: ${id}`)
      recordInstall(opts.home, { id, type: item.type, installedAt: new Date().toISOString(), uninstall: uninstallSteps(item, { home: posixHome, claude }) })
      return ok({})
    },
  )

  return {
    server,
    channelState: () => channel.state(),
    async close() {
      if (http) await (await http).close()
      await server.close()
    },
  }
}

export async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const home = homedir()
  const claude = findClaude(home)
  const run = (cmd: string) =>
    new Promise<string>((res, rej) => execFile(claude, cmd.split(' '), { timeout: 60_000, windowsHide: true }, (e, out) => (e ? rej(e) : res(out))))
  const seedFile = join(root, 'catalog', 'seed.json')
  const cacheFile = join(home, '.claude', 'madar', 'catalog.json')
  // start from the last downloaded catalog (or the seed); the first tool call fetches a newer one
  const { catalog } = await loadBestCatalog({ url: '', cacheFile, seedFile, fetch })
  const refresh = () => loadBestCatalog({ url: CATALOG_URL, cacheFile, seedFile, fetch })
  let version = '0.0.0'
  try { version = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? version } catch {}
  const madar = createMadar({ catalog, home, uiDir: join(root, 'ui'), claude, run, refresh, selfRepo: MADAR_REPO, version, setupsRepo: SETUPS_REPO, supportUrl: SUPPORT_URL })
  await madar.server.connect(new StdioServerTransport())
}
