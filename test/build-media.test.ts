import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractMedia, extractAbout, parseRepoStats } from '../plugin/src/build/media.ts'

const README = `
<p align="center"><img src="docs/hero.png" width="600"></p>

# Cool MCP

[![npm](https://img.shields.io/npm/v/cool.svg)](https://npmjs.com/cool) [![CI](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](x)

Cool MCP lets your agent **browse the web** like a person. It opens pages, clicks and fills forms.

It works with [Claude](https://claude.ai) and other clients.

![Screenshot](./img/shot1.jpg "first")
![insecure](http://example.com/a.png)
![logo](assets/logo.svg)

https://github.com/user-attachments/assets/0f0e1c2b-aaaa-bbbb-cccc-1234567890ab

<video src="https://example.com/demo.mp4"></video>
![same again](./img/shot1.jpg)

## Install
npm i cool
`

test('README images and videos become absolute https media, badges/svg/http skipped, deduped', () => {
  const m = extractMedia(README, 'o/r', 'main')
  assert.deepEqual(m, [
    { kind: 'image', url: 'https://raw.githubusercontent.com/o/r/main/docs/hero.png' },
    { kind: 'image', url: 'https://raw.githubusercontent.com/o/r/main/img/shot1.jpg' },
    { kind: 'video', url: 'https://github.com/user-attachments/assets/0f0e1c2b-aaaa-bbbb-cccc-1234567890ab' },
    { kind: 'video', url: 'https://example.com/demo.mp4' },
  ])
})

test('media paths inside a sub-folder resolve against that folder', () => {
  const m = extractMedia('![a](shot.png)', 'anthropics/skills', 'abc123', 'skills/canvas-design')
  assert.deepEqual(m, [{ kind: 'image', url: 'https://raw.githubusercontent.com/anthropics/skills/abc123/skills/canvas-design/shot.png' }])
})

test('at most 8 media', () => {
  const md = Array.from({ length: 12 }, (_, i) => `![x](p${i}.png)`).join('\n')
  assert.equal(extractMedia(md, 'o/r', 'main').length, 8)
})

test('user-attachments inside <img> or ![]() are images; on their own line they are videos', () => {
  const id = '6c07003c-8455-4636-b298-d60ffdf46cd8'
  const m = extractMedia(`<img src="https://github.com/user-attachments/assets/${id}" />\n\n![s](https://github.com/user-attachments/assets/${id.replace('6c', '7c')})\n\nhttps://github.com/user-attachments/assets/${id.replace('6c', '8c')}\n`, 'o/r', 'main')
  assert.deepEqual(m.map((x) => x.kind), ['image', 'image', 'video'])
})

test('gif is kind gif', () => {
  assert.equal(extractMedia('![d](demo.gif)', 'o/r', 'main')[0].kind, 'gif')
})

test('about = intro prose as clean paragraphs, no badges/images/markup', () => {
  assert.equal(
    extractAbout(README),
    'Cool MCP lets your agent browse the web like a person. It opens pages, clicks and fills forms.\n\nIt works with Claude and other clients.',
  )
})

test('about skips YAML frontmatter and is capped at 1200 chars', () => {
  const md = `---\nname: x\ndescription: y\n---\n\n# X\n\n${'word '.repeat(400)}`
  const a = extractAbout(md)
  assert.ok(!a.includes('name: x'))
  assert.ok(a.length <= 1200)
  assert.ok(a.endsWith('…'))
})

test('repo stats from GitHub API json + contributors Link header', () => {
  const s = parseRepoStats(
    { stargazers_count: 196279, forks_count: 23100, open_issues_count: 456, pushed_at: '2026-11-16T14:22:50Z' },
    '<https://api.github.com/repositories/1/contributors?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/contributors?per_page=1&page=19>; rel="last"',
  )
  assert.deepEqual(s, { stars: 196279, forks: 23100, issues: 456, contributors: 19, updatedAt: '2026-11-16' })
  assert.equal(parseRepoStats({ stargazers_count: 1, forks_count: 0, open_issues_count: 0, pushed_at: '2026-01-01T00:00:00Z' }, null).contributors, undefined)
})
