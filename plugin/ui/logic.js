// Pure helpers for the store page (also imported by tests).

export function pickText(text, lang) {
  return (lang === 'ar' && text.ar) || text.en
}

/** Everything shows; the tab, search box and Installed tab narrow it down. */
export function filterItems(items, { tab, query, installedIds }) {
  const q = query.trim().toLowerCase()
  return items.filter((it) => {
    if (tab === 'installed') {
      if (!installedIds.has(it.id)) return false
    } else {
      if (tab !== 'all' && it.type !== tab) return false
    }
    if (!q) return true
    const hay = [it.name.en, it.name.ar, it.description.en, it.description.ar].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
}

/** Who made it: "owner/repo" (or just the owner) for GitHub projects, the publisher name otherwise. */
export function byline(item, full) {
  if (!item.source) return item.publisher ?? ''
  return full ? `${item.source.owner}/${item.source.repo}` : item.source.owner
}

/** true when version a ("1.2.3") is newer than b. Anything that isn't x.y.z is never newer. */
export function newerVersion(a, b) {
  const p = (v) => (/^\d+\.\d+\.\d+$/.test(String(v)) ? String(v).split('.').map(Number) : null)
  const x = p(a), y = p(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** ⭐ needs a GitHub repo to star. */
export function canStar(item) {
  return !!item.source
}

/** Checked items first, then the most stars. */
export function sortItems(items) {
  return [...items].sort((a, b) => Number(b.checked) - Number(a.checked) || b.stars - a.stars)
}

/** null when the action went through; otherwise which message to show. status 0 = network error. */
export function actionProblem(status) {
  if (status === 200 || status === 202) return null
  if (status === 0 || status === 401 || status === 403) return 'stale'
  if (status === 409) return 'notMine'
  return 'error'
}

export function buttonState(id, { pending, installedIds, byMadarIds }) {
  if (pending.has(id)) return 'busy'
  if (byMadarIds.has(id)) return 'installed'
  if (installedIds.has(id)) return 'installed-manual'
  return 'install'
}

// ---- sharing a setup with a short code ----
// Each item becomes 5 characters: 30 bits of an FNV-1a hash of its id. The code is read back against the store's
// catalog, so it stays short and never carries commands — only which items to offer.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const SETUP_ID = /^[a-z0-9][a-z0-9-]{1,63}$/
const MAX_SETUP = 50

function token(id) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  h = h >>> 2 // 30 bits
  let out = ''
  for (let i = 0; i < 5; i++) { out = B64[h & 63] + out; h >>>= 6 }
  return out
}

/** ["context7", "playwright"] → "MADAR-Xxxxxxyyyyy" (the X marks a long code; short codes are digits only) */
export function encodeSetup(ids) {
  const uniq = [...new Set(ids)].filter((id) => SETUP_ID.test(id)).slice(0, MAX_SETUP)
  return 'MADAR-X' + uniq.map(token).join('')
}

/** "MADAR-482" → 482: a setup posted to GitHub, read back by its number. */
export function parseShortCode(code) {
  const m = /^MADAR-([1-9]\d{0,6})$/i.exec(String(code).trim())
  return m ? Number(m[1]) : null
}

/** A pasted code → the catalog items it names, plus how many are no longer in the store. */
export function decodeSetup(code, catalogIds) {
  const m = /^MADAR-X([A-Za-z0-9_-]+)$/.exec(String(code).trim())
  if (!m || m[1].length % 5) return { ids: [], missing: 0 }
  const byToken = new Map()
  for (const id of catalogIds) {
    const t = token(id)
    byToken.set(t, byToken.has(t) ? null : id) // two ids with one token: ambiguous, offer neither
  }
  const ids = []
  let missing = 0
  for (let i = 0; i < m[1].length && ids.length + missing < MAX_SETUP; i += 5) {
    const id = byToken.get(m[1].slice(i, i + 5))
    if (!id) missing++
    else if (!ids.includes(id)) ids.push(id)
  }
  return { ids, missing }
}

/** Ko-fi's donation panel for an embedded frame (their page stays on their site; their script never runs in ours). */
export function kofiEmbed(url) {
  const m = /^https:\/\/ko-fi\.com\/([A-Za-z0-9_]+)\/?$/.exec(String(url ?? ''))
  return m ? `https://ko-fi.com/${m[1]}/?hidefeed=true&widget=true&embed=true` : null
}
