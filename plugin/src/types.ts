export type ItemType = 'mcp' | 'skill' | 'plugin'
export type Text = { en: string; ar?: string }

export type McpRecipe = {
  kind: 'mcp'
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: string[]
}
export type SkillRecipe = { kind: 'skill'; repo: string; commit: string; path: string; name: string }
/** name: the marketplace's own name (from its marketplace.json) when it differs from the repo name. */
export type PluginRecipe = { kind: 'plugin'; marketplace: string; plugin: string; name?: string }
export type Recipe = McpRecipe | SkillRecipe | PluginRecipe

export type Check = { key: 'active' | 'works' | 'static' | 'license' | 'trusted'; pass: boolean; detail?: Text }

export type CatalogItem = {
  id: string
  type: ItemType
  name: Text
  description: Text
  /** The GitHub repo, when there is one. Registry tools without public code have only a publisher. */
  source?: { owner: string; repo: string }
  /** Who published it (the MCP registry namespace, e.g. "com.vendor") when there is no GitHub repo. */
  publisher?: string
  stars: number
  updatedAt: string
  category: string
  /** Numbers like the GitHub card: stars, forks, open issues, contributors. */
  stats?: { stars: number; forks: number; issues: number; contributors?: number; updatedAt: string }
  /** The project's own intro (README / SKILL.md), plain text paragraphs. */
  about?: Text
  media: { kind: 'image' | 'video' | 'gif'; url: string }[]
  checked: boolean
  checks: Check[]
  badges?: 'needs-key'[]
  requires?: { env: string; label: Text }[]
  recipe: Recipe
  after: 'none' | 'reload-plugins' | 'new-session'
}

export type Bundle = { id: string; name: Text; description: Text; items: string[] }
export type Catalog = { version: 1; items: CatalogItem[]; bundles: Bundle[] }

export type Step = { percent: 20 | 50 | 80 | 100; label: { ar: string; en: string }; run?: string[] }
export type Lang = 'ar' | 'en'
/** For "share", id is the long setup code (MADAR-X...). */
export type Action = { op: 'install' | 'uninstall' | 'star' | 'update' | 'share'; id: string; lang?: Lang }
