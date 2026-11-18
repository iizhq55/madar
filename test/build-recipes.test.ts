import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fromRegistry, fromMarketplace, fromSkillDir, slug } from '../plugin/src/build/recipes-from.ts'
import { validateItem } from '../plugin/src/catalog.ts'

const meta = (latest = true, status = 'active') => ({ 'io.modelcontextprotocol.registry/official': { status, isLatest: latest } })
const entry = (server: any, latest = true, status = 'active') => ({ server: { name: 'com.example/thing', description: 'Does things.', version: '1.0.0', repository: { url: 'https://github.com/example/thing', source: 'github' }, ...server }, _meta: meta(latest, status) })
const npmPkg = (over: any = {}) => ({ registryType: 'npm', identifier: '@example/thing-mcp', version: '0.1.0', transport: { type: 'stdio' }, ...over })

// fill the fields a build adds later, so the result can go through validateItem
const finish = (p: any) => ({ stars: 0, updatedAt: '2026-11-17', category: 'other', media: [], checked: false, checks: [], after: 'none', ...p.item })

test('slug', () => {
  assert.equal(slug('com.foreverworks/notion'), 'com-foreverworks-notion')
  assert.equal(slug('  My Skill!! '), 'my-skill')
})

test('npm package with exact version → npx -y pkg@ver', () => {
  const r: any = fromRegistry(entry({ packages: [npmPkg()] }))
  assert.deepEqual(r.item.recipe, { kind: 'mcp', name: 'com-example-thing', transport: 'stdio', command: 'npx', args: ['-y', '@example/thing-mcp@0.1.0'] })
  assert.deepEqual(r.item.source, { owner: 'example', repo: 'thing' })
  assert.equal(r.dir, '')
  assert.equal(validateItem(finish(r)), null)
})

test('pypi package → uvx pkg==ver', () => {
  const r: any = fromRegistry(entry({ packages: [{ registryType: 'pypi', identifier: 'mcparmory-notion', version: '1.0.1', transport: { type: 'stdio' } }] }))
  assert.deepEqual(r.item.recipe.args, ['mcparmory-notion==1.0.1'])
  assert.equal(r.item.recipe.command, 'uvx')
})

test('remote streamable-http → http recipe (first plain https url)', () => {
  const r: any = fromRegistry(entry({ remotes: [{ type: 'streamable-http', url: 'https://api.example.dev/mcp' }] }))
  assert.deepEqual(r.item.recipe, { kind: 'mcp', name: 'com-example-thing', transport: 'http', url: 'https://api.example.dev/mcp' })
})

test('version range, latest, unknown transport, templated url → reject', () => {
  for (const e of [
    entry({ packages: [npmPkg({ version: '^1.2.0' })] }),
    entry({ packages: [npmPkg({ version: 'latest' })] }),
    entry({ packages: [npmPkg({ transport: { type: 'sse' } })] }),
    entry({ remotes: [{ type: 'streamable-http', url: 'https://{tenant}.example.dev/mcp' }] }),
  ]) assert.ok('reject' in fromRegistry(e), JSON.stringify(e.server))
})

test('a tool with no GitHub repo is listed by its publisher, unverified, with no source card', () => {
  for (const repository of [undefined, { url: 'https://gitlab.com/a/b' }, { url: '' }]) {
    const r = fromRegistry(entry({ packages: [npmPkg()], repository })) as any
    assert.ok(!('reject' in r), JSON.stringify(repository))
    assert.equal(r.item.source, undefined)
    assert.equal(r.item.publisher, 'com.example')
    assert.match(r.unverified.en, /source code/i)
  }
  assert.ok('reject' in fromRegistry(entry({ packages: [], repository: undefined })), 'still needs a way to install')
})

test('not latest, inactive, oci only → reject', () => {
  assert.ok('reject' in fromRegistry(entry({ packages: [npmPkg()] }, false)))
  assert.ok('reject' in fromRegistry(entry({ packages: [npmPkg()] }, true, 'deprecated')))
  assert.ok('reject' in fromRegistry(entry({ packages: [{ registryType: 'oci', identifier: 'x/y', version: '1.0.0', transport: { type: 'stdio' } }] })))
})

test('required env vars → requires + recipe.env; optional ones are not passed', () => {
  const r: any = fromRegistry(entry({ packages: [npmPkg({ environmentVariables: [
    { name: 'NOTION_TOKEN', description: 'Your integration token', isRequired: true },
    { name: 'LOG_LEVEL', description: 'optional', isRequired: false },
  ] })] }))
  assert.deepEqual(r.item.recipe.env, ['NOTION_TOKEN'])
  assert.deepEqual(r.item.requires, [{ env: 'NOTION_TOKEN', label: { en: 'Your integration token' } }])
  assert.equal(validateItem(finish(r)), null)
})

test('required package/runtime arguments or headers → reject (Madar cannot fill them yet)', () => {
  assert.ok('reject' in fromRegistry(entry({ packages: [npmPkg({ packageArguments: [{ type: 'positional', isRequired: true, valueHint: 'dir' }] })] })))
  assert.ok('reject' in fromRegistry(entry({ remotes: [{ type: 'streamable-http', url: 'https://a.dev/mcp', headers: [{ name: 'Authorization', isRequired: true }] }] })))
})

test('real registry page: every accepted entry is valid, rejections carry reasons', () => {
  const page = JSON.parse(readFileSync('test/fixtures/build/registry-notion.json', 'utf8'))
  let ok = 0
  for (const e of page.servers) {
    const r: any = fromRegistry(e)
    if ('reject' in r) assert.ok(r.reject.length > 3)
    else {
      ok++
      assert.equal(validateItem(finish(r)), null, e.server.name)
    }
  }
  assert.ok(ok >= 5, `accepted ${ok}`)
})

test('marketplace entries → plugin recipes', () => {
  const r: any[] = fromMarketplace('anthropics/claude-plugins-official', {
    name: 'claude-plugins-official',
    plugins: [
      { name: 'code-review', description: 'Automated code review', source: './plugins/code-review' },
      { name: 'Bad Name!', description: 'x', source: './plugins/x' },
    ],
  })
  assert.deepEqual(r[0].item.recipe, { kind: 'plugin', marketplace: 'anthropics/claude-plugins-official', plugin: 'code-review' })
  assert.equal(r[0].item.after, 'reload-plugins')
  assert.equal(r[0].dir, 'plugins/code-review')
  assert.ok('reject' in r[1])
})

test('SKILL.md frontmatter → skill recipe pinned to commit; no name → reject', () => {
  const md = '---\nname: canvas-design\ndescription: >-\n  Makes posters\n  and art.\nlicense: x\n---\n\n# Canvas\n'
  const r: any = fromSkillDir('anthropics/skills', 'a'.repeat(40), 'skills/canvas-design', md)
  assert.deepEqual(r.item.recipe, { kind: 'skill', repo: 'anthropics/skills', commit: 'a'.repeat(40), path: 'skills/canvas-design', name: 'canvas-design' })
  assert.equal(r.item.description.en, 'Makes posters and art.')
  assert.equal(r.item.id, 'canvas-design')
  assert.ok('reject' in fromSkillDir('a/b', 'a'.repeat(40), 'x', '# no frontmatter'))
})
