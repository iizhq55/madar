// Reads a published npm package (the code `npx` actually runs) without installing or running it.
import { gunzipSync } from 'node:zlib'

const MAX_TGZ = 20 * 1024 * 1024
const MAX_FILE = 2 * 1024 * 1024
const CODE = /\.(m?[jt]sx?|cjs|cts|mts|py|sh|json)$/

/** Plain ustar/pax/GNU tar → regular files. */
export function untar(buf: Buffer): { path: string; data: Buffer }[] {
  const out: { path: string; data: Buffer }[] = []
  let off = 0
  let longName: string | null = null
  const str = (b: Buffer) => b.toString('utf8').replace(/\0.*$/s, '')
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512)
    if (h.every((b) => b === 0)) break
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8)
    const type = String.fromCharCode(h[156] || 48)
    const prefix = str(h.subarray(345, 500))
    const name = longName ?? (prefix ? `${prefix}/${str(h.subarray(0, 100))}` : str(h.subarray(0, 100)))
    const data = buf.subarray(off + 512, off + 512 + size)
    off += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))
      longName = m ? m[1] : null
      continue
    }
    if (type === 'L') { longName = str(data); continue }
    longName = null
    if (type === '0' || type === '\0') out.push({ path: name, data })
  }
  return out
}

/**
 * The package's code files as text. Throws when the download fails (try again next run);
 * returns a `problem` when the package itself can't be read fully (a scan that could not look is not a pass).
 */
export async function readNpmPackage(fetch: typeof globalThis.fetch, name: string, version: string): Promise<{ files: { path: string; text: string }[]; problem?: string }> {
  const meta = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/${encodeURIComponent(version)}`)
  if (!meta.ok) throw new Error(`npm ${name}@${version}: ${meta.status}`)
  const tarball = (await meta.json())?.dist?.tarball
  if (typeof tarball !== 'string' || !tarball.startsWith('https://registry.npmjs.org/')) throw new Error(`npm ${name}@${version}: no tarball`)
  const r = await fetch(tarball)
  if (!r.ok) throw new Error(`npm tarball ${r.status}`)
  const gz = Buffer.from(await r.arrayBuffer())
  if (gz.length > MAX_TGZ) return { files: [], problem: 'package too large to read' }
  let entries: { path: string; data: Buffer }[]
  try { entries = untar(gunzipSync(gz, { maxOutputLength: 10 * MAX_TGZ })) } catch { return { files: [], problem: 'package could not be unpacked' } }
  const files = entries.filter((f) => CODE.test(f.path))
  const big = files.find((f) => f.data.length > MAX_FILE)
  if (big) return { files: [], problem: `${big.path} is too large to read` }
  return { files: files.map((f) => ({ path: f.path, text: f.data.toString('utf8') })) }
}
