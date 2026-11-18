import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installSteps, uninstallSteps } from '../plugin/src/recipes.ts'
import { skillItem, mcpItem, pluginItem, SHA } from './helpers.ts'

const env = { home: '/c/Users/u', tmp: '/tmp', claude: '/c/Users/u/.local/bin/claude.exe' }
// commands use the CLI running Claude's own Bash session, falling back to the path Madar found
const C = `"\${CLAUDE_CODE_EXECPATH:-${env.claude}}"`

test('skill steps', () => {
  const s = installSteps(skillItem(), env)
  const step = (p: number) => s.find((x) => x.percent === p)!
  // shallow fetch of the pinned commit (a blob-filtered partial clone failed to lazy-fetch on Windows)
  assert.deepEqual(step(20).run, [
    `rm -rf '/tmp/madar-pptx'`,
    `git init -q '/tmp/madar-pptx'`,
    `git -C '/tmp/madar-pptx' fetch -q --depth 1 'https://github.com/anthropics/skills' '${SHA}'`,
    `git -C '/tmp/madar-pptx' checkout FETCH_HEAD -- 'skills/pptx'`,
  ])
  assert.deepEqual(step(80).run, [`mkdir -p '/c/Users/u/.claude/skills'`, `cp -r '/tmp/madar-pptx/skills/pptx' '/c/Users/u/.claude/skills/pptx'`])
  assert.ok(step(100).run!.includes(`test -f '/c/Users/u/.claude/skills/pptx/SKILL.md'`))
})

test('skill clone starts from a clean temp dir', () => {
  const s = installSteps(skillItem(), env)
  assert.equal(s[0].run![0], `rm -rf '/tmp/madar-pptx'`)
})

test('mcp stdio steps', () => {
  const s = installSteps(mcpItem(), env)
  assert.deepEqual(s.find((x) => x.percent === 80)!.run, [`${C} mcp add --scope user 'fs' -- 'npx' '-y' '@scope/pkg@1.2.3'`])
  assert.deepEqual(s.find((x) => x.percent === 100)!.run, [`${C} mcp get 'fs'`])
})

test('mcp env vars come from the shell, before --', () => {
  const it = mcpItem({ recipe: { kind: 'mcp', name: 'n', transport: 'stdio', command: 'npx', args: ['-y', 'p@1'], env: ['NOTION_TOKEN'] } })
  const cmd = installSteps(it, env).find((x) => x.percent === 80)!.run![0]
  assert.equal(cmd, `${C} mcp add --scope user 'n' -e NOTION_TOKEN="$NOTION_TOKEN" -- 'npx' '-y' 'p@1'`)
})

test('mcp http steps', () => {
  const it = mcpItem({ recipe: { kind: 'mcp', name: 'r', transport: 'http', url: 'https://x.dev/mcp' } })
  assert.deepEqual(installSteps(it, env).find((x) => x.percent === 80)!.run, [`${C} mcp add --scope user --transport http 'r' 'https://x.dev/mcp'`])
})

test('plugin steps', () => {
  assert.deepEqual(installSteps(pluginItem(), env).find((x) => x.percent === 80)!.run, [
    `${C} plugin marketplace add 'anthropics/claude-plugins-official'`,
    `${C} plugin install 'code-review@claude-plugins-official' --scope user`,
  ])
})

test('uninstall', () => {
  const last = (it: any) => uninstallSteps(it, env).flatMap((s) => s.run ?? [])
  assert.ok(last(skillItem()).includes(`rm -rf '/c/Users/u/.claude/skills/pptx'`))
  assert.ok(last(mcpItem()).includes(`${C} mcp remove --scope user 'fs'`))
  assert.ok(last(pluginItem()).includes(`${C} plugin uninstall 'code-review@claude-plugins-official'`))
})

test('every step label has ar and en, percents in order', () => {
  for (const it of [skillItem(), mcpItem(), pluginItem()]) {
    for (const s of [installSteps(it, env), uninstallSteps(it, env)]) {
      assert.deepEqual(s.map((x) => x.percent), [20, 50, 80, 100])
      for (const x of s) assert.ok(x.label.ar && x.label.en)
    }
  }
})

test('install labels match the spec copy', () => {
  assert.deepEqual(installSteps(skillItem(), env).map((x) => x.label.ar), [
    'أحمّلها',
    'أتأكد من الفحص والمتطلبات',
    'أثبّتها',
    'أتأكد إنها تشتغل',
  ])
})

test('plugin install uses the marketplace name when it differs from the repo name', async () => {
  const { installSteps } = await import('../plugin/src/recipes.ts')
  const { pluginItem } = await import('./helpers.ts')
  const it = pluginItem({ recipe: { kind: 'plugin', marketplace: 'someone/claude-stuff', plugin: 'cr', name: 'stuff-market' } as any })
  const cmds = installSteps(it, { home: '/h', tmp: '/t', claude: '/c/claude', platform: 'linux' }).flatMap((s) => s.run ?? [])
  assert.ok(cmds.some((c) => c.includes("plugin install 'cr@stuff-market'")), cmds.join(' | '))
  assert.ok(cmds.some((c) => c.includes("plugin marketplace add 'someone/claude-stuff'")))
})
