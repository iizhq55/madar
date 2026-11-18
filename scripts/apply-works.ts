// The publish job: fill in run-check results, re-validate, and leave only what the site should serve.
// node scripts/apply-works.ts <dist dir> <works.json>
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { applyWorks, parseState } from '../plugin/src/build/run.ts'
import { parseCatalog } from '../plugin/src/catalog.ts'

const [dist, resultsFile] = process.argv.slice(2)
const read = (f: string, fallback: string) => (existsSync(f) ? readFileSync(f, 'utf8') : fallback)
const todoFile = join(dist, 'works-todo.json')
let results = {}
try { results = JSON.parse(read(resultsFile, '{}')) } catch { console.error('works results unreadable; tools stay pending') }
const { catalog: parsed, rejected } = parseCatalog(JSON.parse(read(join(dist, 'catalog.json'), '{}')))
const out = applyWorks({ catalog: parsed, state: parseState(read(join(dist, 'state.json'), '{}')), todo: JSON.parse(read(todoFile, '{}')) }, results)
const { catalog } = parseCatalog(out.catalog)
// tools that just passed their run check move up with the other checked items
catalog.items.sort((a, b) => Number(b.checked) - Number(a.checked) || b.stars - a.stars)
writeFileSync(join(dist, 'catalog.json'), JSON.stringify(catalog))
writeFileSync(join(dist, 'state.json'), JSON.stringify(out.state))
rmSync(todoFile, { force: true })
console.log(`${catalog.items.length} items (${catalog.items.filter((i) => i.checked).length} checked)${rejected.length ? `, ${rejected.length} dropped as invalid` : ''}`)
