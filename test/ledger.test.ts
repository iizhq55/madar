import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLedger, recordInstall, removeEntry } from '../plugin/src/ledger.ts'

const home = () => mkdtempSync(join(tmpdir(), 'madar-home-'))

test('missing ledger returns []', () => {
  assert.deepEqual(readLedger(home()), [])
})

test('corrupt ledger returns []', () => {
  const h = home()
  mkdirSync(join(h, '.claude', 'madar'), { recursive: true })
  writeFileSync(join(h, '.claude', 'madar', 'ledger.json'), '{not json')
  assert.deepEqual(readLedger(h), [])
})

test('recordInstall then readLedger roundtrip, removeEntry removes', () => {
  const h = home()
  const e = { id: 'pptx', type: 'skill' as const, installedAt: '2026-11-17T00:00:00Z', uninstall: [] }
  recordInstall(h, e)
  recordInstall(h, { ...e, id: 'fs', type: 'mcp' })
  assert.deepEqual(readLedger(h).map((x) => x.id), ['pptx', 'fs'])
  recordInstall(h, e) // re-install replaces, no duplicate
  assert.equal(readLedger(h).length, 2)
  removeEntry(h, 'pptx')
  assert.deepEqual(readLedger(h).map((x) => x.id), ['fs'])
})
