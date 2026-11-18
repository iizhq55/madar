// Tests for the final-review findings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { installSteps } from '../plugin/src/recipes.ts'
import { validateItem } from '../plugin/src/catalog.ts'
import { startHttp } from '../plugin/src/http.ts'
import { createMadar, findClaude } from '../plugin/src/server.ts'
import { actionProblem } from '../plugin/ui/logic.js'
import type { Action } from '../plugin/src/types.ts'
import { skillItem, mcpItem } from './helpers.ts'

const env = { home: '/c/Users/u', tmp: '/tmp', claude: '/c/u/claude.exe' }
const notion = () =>
  mcpItem({
    id: 'notion',
    requires: [{ env: 'NOTION_TOKEN', label: { en: 'Token' } }],
    recipe: { kind: 'mcp', name: 'notion', transport: 'stdio', command: 'npx', args: ['-y', 'p@1'], env: ['NOTION_TOKEN'] },
  })

// Finding 1: the env value must actually reach the command when the SKILL's form is used.
test('F1: env value reaches claude mcp add via export in the same bash call', () => {
  const cmd = installSteps(notion(), { ...env, claude: 'printf' }).find((s) => s.percent === 80)!.run![0]
  const fake = cmd.replace(' mcp add', ` '%s|' mcp add`)
  const out = execFileSync('bash', ['-c', `unset CLAUDE_CODE_EXECPATH; export NOTION_TOKEN='s3cr'\\''et'; ${fake}`]).toString()
  assert.match(out, /'?notion'?\|-e\|NOTION_TOKEN=s3cr'et\|--\|/)
})

// Live finding: the MCP server's env has no CLAUDE_CODE_EXECPATH, but Claude's Bash does.
test('commands run the CLI from Claude\'s Bash session when it is set', () => {
  const cmd = installSteps(mcpItem(), { ...env, claude: 'printf' }).find((s) => s.percent === 100)!.run![0]
  const run = (pre: string) => execFileSync('bash', ['-c', `${pre}; ${cmd.replace(' mcp get', ` '[%s]' mcp get`)}`]).toString()
  assert.equal(run('unset CLAUDE_CODE_EXECPATH'), '[mcp][get][fs]')
  assert.equal(run(`export CLAUDE_CODE_EXECPATH=echo`), '[%s] mcp get fs\n')
})

test('a fallback CLI path with shell-special characters is not used', () => {
  assert.equal(findClaude(tmpdir(), { CLAUDE_CODE_EXECPATH: 'C:\\a"$(x)\\claude.exe' }), 'claude')
})

// Finding 9: npx needs cmd /c on native Windows.
test('F9: npx is wrapped with cmd /c on win32 only', () => {
  const win = installSteps(mcpItem(), { ...env, platform: 'win32' }).find((s) => s.percent === 80)!.run![0]
  assert.ok(win.endsWith(`-- 'cmd' '/c' 'npx' '-y' '@scope/pkg@1.2.3'`), win)
  // Git Bash rewrites '/c' into 'C:/' unless path conversion is off (seen live: "cmd C:/ npx")
  assert.ok(win.startsWith(`MSYS_NO_PATHCONV=1 `), win)
  const nix = installSteps(mcpItem(), { ...env, platform: 'linux' }).find((s) => s.percent === 80)!.run![0]
  assert.ok(nix.endsWith(`-- 'npx' '-y' '@scope/pkg@1.2.3'`), nix)
})

// Finding 6: never copy over an existing skill.
test('F6: skill install refuses an existing destination before copying', () => {
  const s = installSteps(skillItem(), env)
  assert.ok(s.find((x) => x.percent === 50)!.run!.includes(`test ! -e '/c/Users/u/.claude/skills/pptx'`))
})

// Finding 7: env names must be declared in requires.
test('F7: recipe.env not listed in requires is rejected', () => {
  assert.notEqual(validateItem(mcpItem({ recipe: { kind: 'mcp', name: 'x', transport: 'stdio', command: 'npx', args: ['p@1'], env: ['GITHUB_TOKEN'] } })), null)
  assert.equal(validateItem(notion()), null)
})

// Finding 2: a stuck pending item expires.
test('F2: pending expires so a later click emits again', async () => {
  const actions: Action[] = []
  const uiDir = mkdtempSync(join(tmpdir(), 'ui-'))
  const s = await startHttp({ catalog: { version: 1, items: [skillItem()], bundles: [] }, home: mkdtempSync(join(tmpdir(), 'h-')), uiDir, channelState: () => 'connected', onAction: (a) => actions.push(a), run: async () => '', pendingMs: 400 })
  const origin = new URL(s.url).origin
  const post = () => fetch(`${origin}/api/action?key=${s.token}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ op: 'install', id: 'pptx' }) })
  await post()
  await post()
  assert.equal(actions.length, 1)
  await new Promise((r) => setTimeout(r, 500))
  await post()
  assert.equal(actions.length, 2)
  await s.close()
})

// Finding 4: each instance has its own cookie name.
test('F4: cookie name is per port, so two stores do not clobber each other', async () => {
  const mk = () => startHttp({ catalog: { version: 1, items: [], bundles: [] }, home: tmpdir(), uiDir: tmpdir(), channelState: () => 'connected', onAction: () => {}, run: async () => '' })
  const a = await mk()
  const b = await mk()
  const ca = (await fetch(a.url.replace('/?', '/api/catalog?'))).headers.get('set-cookie')!.split(';')[0]
  const cb = (await fetch(b.url.replace('/?', '/api/catalog?'))).headers.get('set-cookie')!.split(';')[0]
  assert.equal(ca.split('=')[0], `madar_${new URL(a.url).port}`)
  // browser sends both cookies to 127.0.0.1; each server must pick its own
  const both = `${ca}; ${cb}`
  assert.equal((await fetch(new URL(a.url).origin + '/api/catalog', { headers: { cookie: both } })).status, 200)
  assert.equal((await fetch(new URL(b.url).origin + '/api/catalog', { headers: { cookie: both } })).status, 200)
  await a.close()
  await b.close()
})

// Finding 3: every failure maps to a visible message.
test('F3: non-success statuses map to a visible problem', () => {
  assert.equal(actionProblem(202), null)
  assert.equal(actionProblem(200), null)
  assert.equal(actionProblem(401), 'stale')
  assert.equal(actionProblem(403), 'stale')
  assert.equal(actionProblem(409), 'notMine')
  assert.equal(actionProblem(404), 'error')
  assert.equal(actionProblem(500), 'error')
  assert.equal(actionProblem(0), 'stale')
})

// Finding 5: prefer the CLI that is running this session.
test('F5: findClaude prefers CLAUDE_CODE_EXECPATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'))
  const exe = join(dir, 'claude.exe')
  writeFileSync(exe, '')
  assert.equal(findClaude(tmpdir(), { CLAUDE_CODE_EXECPATH: exe }), exe)
  assert.equal(findClaude(mkdtempSync(join(tmpdir(), 'nohome-')), {}), 'claude')
})

// Finding 6: refuse to install what is already installed.
test('F6: get_steps install refuses an item already on the machine', async () => {
  const home = mkdtempSync(join(tmpdir(), 'h-'))
  mkdirSync(join(home, '.claude', 'skills', 'pptx'), { recursive: true })
  writeFileSync(join(home, '.claude', 'skills', 'pptx', 'SKILL.md'), 'x')
  const madar = createMadar({ catalog: { version: 1, items: [skillItem()], bundles: [] }, home, uiDir: tmpdir(), claude: 'claude', run: async () => '' })
  const client = new Client({ name: 't', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([madar.server.connect(a), client.connect(b)])
  const r: any = await client.callTool({ name: 'madar_get_steps', arguments: { op: 'install', id: 'pptx' } })
  assert.equal(r.isError, true)
  await madar.close()
})

// Finding 8: the entry file always starts the server (no argv/url comparison).
test('F8: plugin entry answers initialize over stdio', async () => {
  const p = spawn(process.execPath, ['plugin/src/main.ts'], { stdio: ['pipe', 'pipe', 'inherit'] })
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n')
  const line = await new Promise<string>((ok) => p.stdout.once('data', (d) => ok(String(d))))
  p.kill()
  assert.match(line, /"claude\/channel"/)
})
