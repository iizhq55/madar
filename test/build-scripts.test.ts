// The three hourly jobs: plan (reads sources), works (starts tools, isolated), publish (applies results).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseState } from '../plugin/src/build/run.ts'
import { mcpItem } from './helpers.ts'

const node = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } })
const fixture = (f: string) => ({ kind: 'mcp', name: 'x', transport: 'stdio', command: process.execPath, args: [resolve(`test/fixtures/build/servers/${f}`)] })

test('run-works refuses to start tools outside GitHub Actions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-'))
  writeFileSync(join(dir, 'todo.json'), JSON.stringify({ a: fixture('ok.mjs') }))
  const r = node(['scripts/run-works.ts', join(dir, 'todo.json'), join(dir, 'out.json')])
  assert.notEqual(r.status, 0)
  assert.equal(existsSync(join(dir, 'out.json')), false)
})

test('run-works starts each tool once and writes plain results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-'))
  writeFileSync(join(dir, 'todo.json'), JSON.stringify({ a: fixture('ok.mjs'), b: fixture('needs-key.mjs') }))
  const r = node(['scripts/run-works.ts', join(dir, 'todo.json'), join(dir, 'out.json')], { CI: 'true', GITHUB_ACTIONS: 'true' })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'))
  assert.equal(out.a.pass, true)
  assert.equal(out.a.needsKey, false)
  assert.equal(out.b.needsKey, true)
})

test('apply-works marks tested tools checked and drops the to-do list from what gets published', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'))
  const pending = { key: 'works' as const, pass: false, detail: { en: 'Run check pending' } }
  const checks = [...(['active', 'license', 'trusted', 'static'] as const).map((key) => ({ key, pass: true })), pending]
  const item = mcpItem({ checked: false, checks })
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ version: 1, items: [item], bundles: [] }))
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ fs: { version: 'registry:npx -y @scope/pkg@1.2.3', item, checkedAt: '2026-11-17T00:00:00Z', withChecks: true, worksPending: true } }))
  writeFileSync(join(dir, 'works-todo.json'), JSON.stringify({ fs: item.recipe }))
  writeFileSync(join(dir, 'works.json'), JSON.stringify({ fs: { pass: true, needsKey: false } }))
  const r = node(['scripts/apply-works.ts', dir, join(dir, 'works.json')])
  assert.equal(r.status, 0, r.stderr)
  const cat = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'))
  assert.equal(cat.items[0].checked, true)
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).fs.worksPending, false)
  assert.equal(existsSync(join(dir, 'works-todo.json')), false)
})

test('apply-works without results still publishes (tools stay pending)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'))
  const item = mcpItem({ checked: false })
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ version: 1, items: [item], bundles: [] }))
  writeFileSync(join(dir, 'state.json'), JSON.stringify({}))
  writeFileSync(join(dir, 'works-todo.json'), JSON.stringify({ fs: item.recipe }))
  const r = node(['scripts/apply-works.ts', dir, join(dir, 'missing.json')])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8')).items[0].checked, false)
})

test('previous state from the published site keeps only valid entries', () => {
  const good = { version: 'registry:x', item: mcpItem(), checkedAt: '2026-11-17T00:00:00Z' }
  const s = parseState(JSON.stringify({ fs: good, bad: { version: 'v', item: { id: 'bad' }, checkedAt: 'x' }, other: { ...good, item: mcpItem({ id: 'zz' }) } }))
  assert.deepEqual(Object.keys(s), ['fs'])
  assert.deepEqual(parseState('not json'), {})
  assert.deepEqual(parseState('[1,2]'), {})
})

test('run-works keeps to its deadline and saves what it finished', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-'))
  writeFileSync(join(dir, 'todo.json'), JSON.stringify({ a: fixture('ok.mjs'), b: fixture('hang.mjs'), c: fixture('ok.mjs') }))
  const t0 = Date.now()
  const r = node(['scripts/run-works.ts', join(dir, 'todo.json'), join(dir, 'out.json'), '--deadline-sec', '4'], { CI: 'true', GITHUB_ACTIONS: 'true' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(Date.now() - t0 < 12000, `took ${Date.now() - t0} ms`)
  const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'))
  assert.equal(out.a.pass, true)
  assert.equal(out.c, undefined)
})

test('workflow: the trial job has no permissions, publish verifies the plan and deploys even if the trials failed', () => {
  const y = readFileSync('.github/workflows/catalog.yml', 'utf8')
  const job = (name: string) => y.split(new RegExp(`\\n  ${name}:\\n`))[1].split(/\n  [a-z]+:\n/)[0]
  assert.match(job('works'), /permissions: \{\}/)
  assert.match(job('plan'), /sha256sum/)
  assert.match(job('publish'), /sha256sum -c/)
  assert.ok(job('publish').includes("!cancelled() && needs.plan.result == 'success'"))
  assert.match(job('publish'), /deploy-pages/)
  assert.ok(!y.includes('\n  deploy:\n'), 'no separate deploy job')
  assert.doesNotMatch(job('works'), /pages: write|id-token|contents: (read|write)/)
})
