import type { CatalogItem, Check, Text } from '../types.ts'
import type { Partial_ } from './recipes-from.ts'
import type { Stats } from './media.ts'

/** Checked only when all five checks ran and passed. */
export const isChecked = (checks: Check[]) => checks.length >= 5 && checks.every((c) => c.pass)

/** stats null: the repo link is not confirmed, so none of its numbers are shown. */
export function mergeItem(
  base: Partial_,
  o: { stats: Stats | null; checks: Check[]; needsKey: boolean; media: CatalogItem['media']; about: string; desc?: { ar?: string; en?: string }; category: string; today?: string },
): CatalogItem {
  const description: Text = { en: o.desc?.en || base.description?.en || base.id, ...(o.desc?.ar ? { ar: o.desc.ar } : {}) }
  const badges = new Set(base.badges ?? [])
  if (o.needsKey) badges.add('needs-key')
  return {
    id: base.id,
    type: base.type!,
    name: base.name ?? { en: base.id },
    description,
    ...(base.source ? { source: base.source } : { publisher: base.publisher }),
    stars: o.stats?.stars ?? 0,
    updatedAt: o.stats?.updatedAt ?? o.today ?? new Date().toISOString().slice(0, 10),
    category: o.category,
    ...(o.stats ? { stats: o.stats } : {}),
    ...(o.about ? { about: { en: o.about } } : {}),
    media: o.media,
    checked: isChecked(o.checks),
    checks: o.checks,
    ...(badges.size ? { badges: [...badges] } : {}),
    ...(base.requires?.length ? { requires: base.requires } : {}),
    recipe: base.recipe,
    after: base.type === 'plugin' ? 'reload-plugins' : 'none',
  }
}
