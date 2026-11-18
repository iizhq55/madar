// Where the hourly-built catalog is published. Empty until Madar is published (then: https://<owner>.github.io/madar/catalog.json).
// MADAR_CATALOG_URL overrides it for testing.
export const CATALOG_URL = process.env.MADAR_CATALOG_URL ?? ''

// Madar's own GitHub repo ("owner/name"), for the "⭐ Madar" button on the store page. Empty until Madar is published.
export const MADAR_REPO = process.env.MADAR_REPO ?? ''

/** The id the store page uses for Madar itself ("@" can't appear in catalog ids, so it never clashes). */
export const SELF_ID = '@madar'
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/
export const validRepo = (r: string | undefined) => !!r && REPO.test(r)

// Where shared setups are posted (as GitHub issues) to get short codes like MADAR-482. Empty until published.
export const SETUPS_REPO = process.env.MADAR_SETUPS_REPO ?? ''

/** A long setup code: MADAR-X then 5 characters per item, at most 50 items. */
export const LONG_CODE = /^MADAR-X(?:[A-Za-z0-9_-]{5}){1,50}$/

// ❤ Support Madar (tips / donations). Shown in the store header.
export const SUPPORT_URL = process.env.MADAR_SUPPORT_URL ?? 'https://ko-fi.com/iizhq55'

/** Only known donation sites, over https. */
export const validSupport = (u: string | undefined) => !!u && /^https:\/\/(ko-fi\.com|www\.buymeacoffee\.com|github\.com\/sponsors|opencollective\.com|www\.patreon\.com)\/[A-Za-z0-9_.-]+\/?$/.test(u)
