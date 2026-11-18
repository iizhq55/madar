import type { CatalogItem } from '../plugin/src/types.ts'

export const SHA = 'a'.repeat(40)

export function skillItem(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'pptx',
    type: 'skill',
    name: { en: 'Slide Maker', ar: 'صانع العروض' },
    description: { en: 'Makes decks.', ar: 'يسوي عروض.' },
    source: { owner: 'anthropics', repo: 'skills' },
    stars: 100,
    updatedAt: '2026-11-01',
    category: 'office',
    media: [],
    checked: true,
    checks: [{ key: 'active', pass: true }],
    recipe: { kind: 'skill', repo: 'anthropics/skills', commit: SHA, path: 'skills/pptx', name: 'pptx' },
    after: 'none',
    ...over,
  }
}

export function mcpItem(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    ...skillItem(),
    id: 'fs',
    type: 'mcp',
    name: { en: 'Files' },
    recipe: { kind: 'mcp', name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@scope/pkg@1.2.3'] },
    after: 'new-session',
    ...over,
  }
}

export function pluginItem(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    ...skillItem(),
    id: 'cr',
    type: 'plugin',
    name: { en: 'Code Review' },
    recipe: { kind: 'plugin', marketplace: 'anthropics/claude-plugins-official', plugin: 'code-review' },
    after: 'reload-plugins',
    ...over,
  }
}
