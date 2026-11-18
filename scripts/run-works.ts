// The isolated run-check job: start each new tool once and write plain results. Nothing else.
// node scripts/run-works.ts <works-todo.json> <works.json> [--deadline-sec N]
// Runs only inside GitHub Actions, in a job with no token and no secrets.
// Results are saved after every tool, and it stops starting tools at the deadline, so a slow run still reports.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { checkWorks } from '../plugin/src/build/checks.ts'
import type { McpRecipe } from '../plugin/src/types.ts'
import type { WorksResult } from '../plugin/src/build/run.ts'

const args = process.argv.slice(2)
const [todoFile, outFile] = args
const at = args.indexOf('--deadline-sec')
const deadline = Date.now() + 1000 * (at >= 0 ? Number(args[at + 1]) : 25 * 60)
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
  console.error('run-works starts third-party tools, so it only runs inside GitHub Actions.')
  process.exit(2)
}
const todo: Record<string, McpRecipe> = existsSync(todoFile) ? JSON.parse(readFileSync(todoFile, 'utf8')) : {}
const out: Record<string, WorksResult> = {}
writeFileSync(outFile, '{}')
for (const [id, recipe] of Object.entries(todo)) {
  const left = deadline - Date.now()
  if (left < 2000) { console.log(`deadline reached; ${Object.keys(todo).length - Object.keys(out).length} left for the next run`); break }
  const r = await checkWorks(recipe, Math.min(20_000, left))
  out[id] = { pass: r.check.pass, needsKey: r.needsKey, ...(r.check.detail ? { detail: r.check.detail } : {}) }
  writeFileSync(outFile, JSON.stringify(out, null, 2))
  console.log(`${r.check.pass ? '✓' : '✗'} ${id}${r.needsKey ? ' (needs key)' : ''}`)
}
// a tool may leave a process behind holding our pipes; don't wait for it
process.exit(0)
