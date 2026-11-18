import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { ItemType, Step } from './types.ts'

export type LedgerEntry = { id: string; type: ItemType; installedAt: string; uninstall: Step[] }

const file = (home: string) => join(home, '.claude', 'madar', 'ledger.json')

export function readLedger(home: string): LedgerEntry[] {
  try {
    const v = JSON.parse(readFileSync(file(home), 'utf8'))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function write(home: string, entries: LedgerEntry[]): void {
  const f = file(home)
  mkdirSync(join(home, '.claude', 'madar'), { recursive: true })
  writeFileSync(f + '.tmp', JSON.stringify(entries, null, 2))
  renameSync(f + '.tmp', f)
}

export function recordInstall(home: string, e: LedgerEntry): void {
  write(home, [...readLedger(home).filter((x) => x.id !== e.id), e])
}

export function removeEntry(home: string, id: string): void {
  write(home, readLedger(home).filter((x) => x.id !== id))
}
