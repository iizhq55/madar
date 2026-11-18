// The plugin must run from GitHub without node_modules: one bundled file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

test('bundle runs without node_modules', async () => {
  assert.ok(existsSync('plugin/dist/server.mjs'), 'run npm run bundle first')
  const dir = mkdtempSync(join(tmpdir(), 'madar-plugin-'))
  cpSync('plugin', dir, { recursive: true, filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src) })
  assert.equal(existsSync(join(dir, 'node_modules')), false)
  const p = spawn(process.execPath, [join(dir, 'dist', 'server.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], cwd: tmpdir() })
  let err = ''
  p.stderr.on('data', (d) => (err += d))
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n')
  const line = await new Promise<string>((ok) => {
    p.stdout.once('data', (d) => ok(String(d)))
    p.on('exit', () => ok(''))
  })
  p.kill()
  assert.match(line, /"claude\/channel"/, err)
})

test('.mcp.json starts the bundle', async () => {
  const { readFileSync } = await import('node:fs')
  const cfg = JSON.parse(readFileSync('plugin/.mcp.json', 'utf8'))
  assert.deepEqual(cfg.mcpServers.madar.args, ['${CLAUDE_PLUGIN_ROOT}/dist/server.mjs'])
})
