import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
import type { Catalog, Action } from './types.ts'
import { getItem } from './catalog.ts'
import { SELF_ID, validRepo, LONG_CODE, validSupport } from './config.ts'
import { newerVersion } from '../ui/logic.js'
import { readLedger } from './ledger.ts'
import { listInstalled } from './installed.ts'
import { channelText } from './channel.ts'

type Done = 'ok' | 'fail' | 'needs-step'
export type HttpOpts = {
  catalog: Catalog
  /** Madar's own repo, for its ⭐ button and the update check. */
  selfRepo?: string
  /** The running Madar version (plugin.json). */
  version?: string
  /** Where shared setups are posted, for short codes. */
  setupsRepo?: string
  /** ❤ Support link (Ko-fi, GitHub Sponsors…). */
  supportUrl?: string
  /** For the update check (tests pass a fake). */
  fetch?: typeof fetch
  home: string
  uiDir: string
  channelState: () => 'connected' | 'unavailable'
  onAction: (a: Action) => void
  run: (cmd: string) => Promise<string>
  lang?: 'ar' | 'en'
  /** A click is ignored while the same item is pending; pending expires after this long without a `done`. */
  pendingMs?: number
}
export type HttpHandle = {
  url: string
  token: string
  /** Stream of `مدار: ثبّت <id>` lines for a background watcher (Claude's Monitor) when channels are unavailable. */
  watchUrl: string
  progress: (id: string, percent: number, message: string, done?: Done) => void
  close: () => Promise<void>
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

export function systemLang(): 'ar' | 'en' {
  return Intl.DateTimeFormat().resolvedOptions().locale.startsWith('ar') ? 'ar' : 'en'
}

export async function startHttp(opts: HttpOpts): Promise<HttpHandle> {
  const token = randomBytes(32).toString('hex')
  const pendingMs = opts.pendingMs ?? 3 * 60_000
  const pending = new Map<string, number>()
  const streams = new Set<ServerResponse>()
  const watchers = new Set<ServerResponse>()
  const uiRoot = resolve(opts.uiDir)
  const state = (): 'connected' | 'unavailable' => (opts.channelState() === 'connected' || watchers.size ? 'connected' : 'unavailable')

  let origin = ''
  let cookieName = 'madar'

  const authed = (req: IncomingMessage, url: URL): boolean => {
    const fromCookie = (req.headers.cookie ?? '')
      .split(/;\s*/)
      .find((c) => c.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1)
    const given = url.searchParams.get('key') ?? fromCookie ?? ''
    const a = Buffer.from(given)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  }
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((ok, fail) => {
      let s = ''
      req.on('data', (c) => {
        s += c
        if (s.length > 4096) {
          fail(new Error('too large'))
          req.destroy()
        }
      })
      req.on('end', () => ok(s))
    })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!authed(req, url)) return json(res, 401, { error: 'unauthorized' })
    if (url.searchParams.has('key')) res.setHeader('set-cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`)

    try {
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        return json(res, 200, { catalog: opts.catalog, channel: state(), lang: opts.lang ?? 'en', self: validRepo(opts.selfRepo) ? opts.selfRepo : null, setups: validRepo(opts.setupsRepo), support: validSupport(opts.supportUrl) ? opts.supportUrl : null })
      }
      if (req.method === 'GET' && url.pathname === '/api/setup') {
        // a short code: read the long code out of that issue (text from GitHub is data; only the code pattern is kept)
        if (!validRepo(opts.setupsRepo)) return json(res, 404, { error: 'no short codes yet' })
        const n = url.searchParams.get('n') ?? ''
        if (!/^[1-9]\d{0,6}$/.test(n)) return json(res, 400, { error: 'n' })
        try {
          const r = await (opts.fetch ?? fetch)(`https://api.github.com/repos/${opts.setupsRepo}/issues/${n}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'madar' }, signal: AbortSignal.timeout(8000) })
          const issue = r.ok ? await r.json() : null
          const code = issue && !issue.pull_request && typeof issue.body === 'string' ? /MADAR-X[A-Za-z0-9_-]+/.exec(issue.body)?.[0] : undefined
          return code && LONG_CODE.test(code) ? json(res, 200, { code }) : json(res, 404, { error: 'not found' })
        } catch {
          return json(res, 502, { error: 'github' })
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/update') {
        const current = opts.version ?? '0.0.0'
        if (!validRepo(opts.selfRepo)) return json(res, 200, { current, latest: null, available: false })
        try {
          const r = await (opts.fetch ?? fetch)(`https://raw.githubusercontent.com/${opts.selfRepo}/HEAD/plugin/.claude-plugin/plugin.json`, { signal: AbortSignal.timeout(5000) })
          const latest = r.ok ? String((await r.json())?.version ?? '') : ''
          return json(res, 200, { current, latest: latest || null, available: newerVersion(latest, current) })
        } catch {
          return json(res, 200, { current, latest: null, available: false })
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/watch') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        res.write('\n')
        watchers.add(res)
        req.on('close', () => watchers.delete(res))
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/installed') {
        return json(res, 200, { installed: await listInstalled(opts.home, opts.catalog, opts.run) })
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        res.write(': ok\n\n')
        streams.add(res)
        req.on('close', () => streams.delete(res))
        return
      }
      if (url.pathname === '/api/action') {
        if (req.method !== 'POST') return json(res, 405, { error: 'method' })
        if (req.headers.origin !== origin) return json(res, 403, { error: 'origin' })
        let body: any
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          return json(res, 400, { error: 'body' })
        }
        const op = body?.op
        const id = body?.id
        if ((op !== 'install' && op !== 'uninstall' && op !== 'star' && op !== 'update' && op !== 'share') || typeof id !== 'string') return json(res, 400, { error: 'op' })
        if (op === 'share' && !LONG_CODE.test(id)) return json(res, 400, { error: 'code' })
        if (op === 'share' && !validRepo(opts.setupsRepo)) return json(res, 404, { error: 'no short codes yet' })
        // only Madar itself is updated from the page
        if (op === 'update' && id !== SELF_ID) return json(res, 400, { error: 'op' })
        const self = ((op === 'star' || op === 'update') && id === SELF_ID && validRepo(opts.selfRepo)) || op === 'share'
        const inLedger = readLedger(opts.home).some((e) => e.id === id)
        // an item Madar installed stays removable after it leaves the catalog
        if (!self && !getItem(opts.catalog, id) && !(op === 'uninstall' && inLedger)) return json(res, 404, { error: 'unknown id' })
        if (op === 'uninstall' && !inLedger) return json(res, 409, { error: 'not installed by madar' })
        if (op === 'star' && !self && !getItem(opts.catalog, id)?.source) return json(res, 409, { error: 'no repo' })
        const lang: 'ar' | 'en' = body?.lang === 'ar' ? 'ar' : 'en'
        const line = (op: 'install' | 'uninstall' | 'star' | 'update' | 'share', id: string) => channelText({ op, id, lang })
        const viaChannel = opts.channelState() === 'connected'
        if (!viaChannel && !watchers.size) return json(res, 200, { mode: 'copy', text: line(op, id) })
        // a star is tracked apart from installs (its progress comes back as "star:<id>")
        const key = op === 'star' ? `star:${id}` : op === 'share' ? 'share' : id
        const since = pending.get(key)
        if (since === undefined || Date.now() - since > pendingMs) {
          pending.set(key, Date.now())
          if (viaChannel) opts.onAction({ op, id, lang })
          else for (const w of watchers) w.write(line(op, id) + '\n')
        }
        return json(res, 202, { mode: viaChannel ? 'channel' : 'watch' })
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
        const file = resolve(join(uiRoot, rel))
        if (!file.startsWith(uiRoot + sep)) return json(res, 404, { error: 'not found' })
        try {
          const data = await readFile(file)
          res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
          return res.end(data)
        } catch {
          return json(res, 404, { error: 'not found' })
        }
      }
      return json(res, 404, { error: 'not found' })
    } catch {
      return json(res, 500, { error: 'server' })
    }
  })

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as { port: number }).port
  origin = `http://127.0.0.1:${port}`
  // cookies are shared across ports on 127.0.0.1, so each store instance needs its own name
  cookieName = `madar_${port}`

  return {
    url: `${origin}/?key=${token}`,
    watchUrl: `${origin}/api/watch?key=${token}`,
    token,
    progress(id, percent, message, done) {
      if (done) pending.delete(id)
      else if (pending.has(id)) pending.set(id, Date.now())
      const payload = JSON.stringify(done ? { id, percent, message, done } : { id, percent, message })
      for (const s of streams) s.write(`data: ${payload}\n\n`)
    },
    close: () =>
      new Promise<void>((ok) => {
        for (const s of [...streams, ...watchers]) s.end()
        server.closeAllConnections()
        server.close(() => ok())
      }),
  }
}
