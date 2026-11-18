import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Catalog, ItemType } from './types.ts'
import { readLedger } from './ledger.ts'

export type InstalledRow = { id?: string; type: ItemType; name: string; byMadar: boolean }

/** Server names from `claude mcp list` lines like `name: command - ✔ Connected`. */
export function parseMcpList(out: string): string[] {
  const names: string[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S+?): .+ - \S/.exec(line)
    if (m) names.push(m[1])
  }
  return names
}

export async function listInstalled(home: string, c: Catalog, run: (cmd: string) => Promise<string>): Promise<InstalledRow[]> {
  const mine = new Set(readLedger(home).map((e) => e.id))
  const rows: InstalledRow[] = []
  const add = (type: ItemType, name: string, id: string | undefined) => rows.push({ id, type, name, byMadar: !!id && mine.has(id) })

  const skillsDir = join(home, '.claude', 'skills')
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir)) {
      if (!existsSync(join(skillsDir, d, 'SKILL.md'))) continue
      add('skill', d, c.items.find((i) => i.recipe.kind === 'skill' && i.recipe.name === d)?.id)
    }
  }

  try {
    for (const n of parseMcpList(await run('mcp list'))) {
      add('mcp', n, c.items.find((i) => i.recipe.kind === 'mcp' && i.recipe.name === n)?.id)
    }
  } catch {}

  try {
    for (const p of JSON.parse(await run('plugin list --json')) as { id: string }[]) {
      const id = c.items.find((i) => {
        const r = i.recipe
        return r.kind === 'plugin' && `${r.plugin}@${r.marketplace.split('/')[1]}` === p.id
      })?.id
      add('plugin', p.id, id)
    }
  } catch {}

  return rows
}
