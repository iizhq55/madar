import type { CatalogItem } from '../types.ts'

type Media = CatalogItem['media'][number]
export type Stats = { stars: number; forks: number; issues: number; contributors?: number; updatedAt: string }

const MAX_MEDIA = 8
const BADGE = /shields\.io|badgen\.net|badge\.fury|\/badge(\.svg)?|\/workflows\/|codecov\.io|travis-ci|circleci|deepwiki\.com\/badge|star-history\.com|contrib\.rocks|api\.star-history/i
const VIDEO_EXT = /\.(mp4|webm|mov)(\?|$)/i
const ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}$/i

function resolve(url: string, repo: string, ref: string, dir: string): string | null {
  url = url.trim().replace(/^<|>$/g, '')
  if (/^https:\/\//i.test(url)) {
    // GitHub "blob" links to images render via raw
    const blob = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(url)
    return blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}` : url
  }
  if (/^[a-z]+:/i.test(url) || url.startsWith('//') || url.startsWith('#')) return null // http:, data:, mailto:, anchors
  const parts = [...(url.startsWith('/') ? [] : dir.split('/').filter(Boolean)), ...url.split('/')]
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return `https://raw.githubusercontent.com/${repo}/${ref}/${out.join('/')}`
}

function kindOf(url: string): Media['kind'] | null {
  const path = url.split('?')[0].toLowerCase()
  if (path.endsWith('.svg')) return null
  if (VIDEO_EXT.test(url)) return 'video'
  if (path.endsWith('.gif')) return 'gif'
  if (/\.(png|jpe?g|webp|avif)$/.test(path)) return 'image'
  return null
}

/** The project's own images and videos from its README, in order. */
export function extractMedia(readme: string, repo: string, ref: string, dir = ''): Media[] {
  const found: { at: number; url: string; video?: boolean }[] = []
  const push = (at: number, url: string, video = false) => found.push({ at, url, video })
  for (const m of readme.matchAll(/!\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) push(m.index!, m[1])
  for (const m of readme.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) push(m.index!, m[1])
  for (const m of readme.matchAll(/<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) push(m.index!, m[1], true)
  for (const m of readme.matchAll(/^[ \t]*(https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36})[ \t]*$/gim)) push(m.index!, m[1], true)

  const media: Media[] = []
  const seen = new Set<string>()
  for (const f of found.sort((a, b) => a.at - b.at)) {
    if (BADGE.test(f.url)) continue
    const url = resolve(f.url, repo, ref, dir)
    if (!url || seen.has(url)) continue
    // GitHub attachments have no extension: a video when on its own line or in <video>, an image in image syntax
    const kind = ATTACHMENT.test(url) ? (f.video ? 'video' : 'image') : f.video ? (kindOf(url) === 'image' ? 'image' : 'video') : kindOf(url)
    if (!kind) continue
    seen.add(url)
    media.push({ kind, url })
    if (media.length === MAX_MEDIA) break
  }
  return media
}

/** The project's own intro: prose paragraphs before the first section heading, as plain text. */
export function extractAbout(readme: string, max = 1200): string {
  const body = readme.replace(/^---\n[\s\S]*?\n---\n/, '')
  const paras: string[] = []
  let seenTitle = false
  for (const block of body.split(/\n\s*\n/)) {
    const b = block.trim()
    if (!b) continue
    if (/^#\s/.test(b)) {
      if (seenTitle && paras.length) break
      seenTitle = true
      continue
    }
    if (/^#{2,}\s/.test(b)) {
      if (paras.length) break
      continue
    }
    if (/^(```|<|\||[-*+]\s|\d+\.\s|>\s?\[!)/.test(b) || /^https?:\/\/\S+$/.test(b)) continue
    const text = b
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '') // linked badges
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
      .replace(/<[^>]+>/g, '') // html
      .replace(/(\*\*|__|\*|_|`)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 20) continue
    paras.push(text)
  }
  const all = paras.join('\n\n')
  return all.length <= max ? all : all.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

export function parseRepoStats(
  repo: { stargazers_count: number; forks_count: number; open_issues_count: number; pushed_at: string },
  contributorsLink: string | null,
): Stats {
  const last = contributorsLink && /[?&]page=(\d+)>;\s*rel="last"/.exec(contributorsLink)
  const s: Stats = { stars: repo.stargazers_count, forks: repo.forks_count, issues: repo.open_issues_count, updatedAt: repo.pushed_at.slice(0, 10) }
  if (last) s.contributors = Number(last[1])
  return s
}
