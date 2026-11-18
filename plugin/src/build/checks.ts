// The automated checks behind "مفحوصة" (spec §5.4).
import { spawn, execFile } from 'node:child_process'
import type { Check, McpRecipe } from '../types.ts'

export type RepoMeta = { pushedAt: string; createdAt: string; license: string | null; owner: string; stars: number; archived: boolean }

const DAY = 86_400_000
const t = (en: string, ar: string) => ({ en, ar })

export function checkActive(m: RepoMeta, now: Date): Check {
  if (m.archived) return { key: 'active', pass: false, detail: t('Archived', 'مؤرشفة') }
  const days = Math.floor((now.getTime() - Date.parse(m.pushedAt)) / DAY)
  const pass = days <= 183
  return { key: 'active', pass, detail: t(days <= 1 ? 'Updated in the last day' : `Updated ${days} days ago`, days <= 1 ? 'تحدّثت آخر يوم' : `تحدّثت قبل ${days} يوم`) }
}

export function checkLicense(m: RepoMeta): Check {
  const ok = !!m.license && m.license !== 'NOASSERTION'
  return { key: 'license', pass: ok, detail: ok ? t(m.license!, `رخصة ${m.license}`) : t('No open license', 'ما لها رخصة مفتوحة') }
}

function hostBelongs(url: string, owner: string): boolean {
  const host = new URL(url).hostname.toLowerCase()
  const o = owner.toLowerCase().replace(/[^a-z0-9]/g, '')
  return host.split('.').some((label) => label.replace(/[^a-z0-9]/g, '') === o)
}

export function checkTrusted(m: RepoMeta, trustedOrgs: string[], now: Date, remoteUrl?: string): Check {
  const known = trustedOrgs.map((x) => x.toLowerCase()).includes(m.owner.toLowerCase())
  const popular = m.stars >= 500 && now.getTime() - Date.parse(m.createdAt) >= 90 * DAY
  if (remoteUrl && !hostBelongs(remoteUrl, m.owner) && !known) return { key: 'trusted', pass: false, detail: t('Remote address is not the publisher’s', 'الرابط مو تابع لصاحب المشروع') }
  if (known) return { key: 'trusted', pass: true, detail: t(`Published by ${m.owner}`, `من ${m.owner}`) }
  if (popular) return { key: 'trusted', pass: true, detail: t(`${m.stars} stars, established project`, `مشروع معروف (${m.stars} نجمة)`) }
  return { key: 'trusted', pass: false, detail: t('Not yet well known', 'للحين مو معروف كفاية') }
}

const BAD: [RegExp, string][] = [
  [/\b(curl|wget)\b[^\n|]*\|\s*(ba)?sh\b/, 'downloads and runs a script'],
  [/eval\s*\([^)]*(base64|atob)/i, 'runs hidden (base64) code'],
  [/["'`][A-Za-z0-9+/=]{2048,}["'`]/, 'contains a large hidden blob'],
  [/child_process[\s\S]{0,200}\$\{process\.env\./, 'builds shell commands from secrets'],
]
const SECRET_READ = /\.ssh\/|\.aws\/|\.claude\.json|id_rsa|\.npmrc/
const NETWORK = /\bfetch\s*\(|https?\.request|axios|XMLHttpRequest|net\.connect/

export function staticScan(files: { path: string; text: string }[]): Check {
  if (!files.length) return { key: 'static', pass: false, detail: t('Found no code to read', 'ما لقينا كود نقرأه') }
  for (const f of files) {
    for (const [re, why] of BAD) if (re.test(f.text)) return { key: 'static', pass: false, detail: t(`${f.path}: ${why}`, `${f.path}: فيها كود مشبوه`) }
    if (SECRET_READ.test(f.text) && NETWORK.test(f.text)) return { key: 'static', pass: false, detail: t(`${f.path}: reads secrets and talks to the network`, `${f.path}: تقرأ أسرار وترسل للنت`) }
  }
  const hooks = files.some((f) => /(^|\/)hooks\//.test(f.path) || /"hooks"\s*:/.test(f.text))
  return hooks
    ? { key: 'static', pass: true, detail: t('No malicious patterns; includes hooks that run commands', 'ما فيها كود خبيث، وفيها hooks تشغّل أوامر') }
    : { key: 'static', pass: true, detail: t('No malicious patterns', 'ما فيها كود خبيث') }
}

// a missing key, not any mention of 'token' ("Unexpected token" is a crash)
const KEY_WORDS = /api[_ -]?key|(access|auth|bearer|api)[_ -]?token|unauthori[sz]ed|credential|missing.*(env|key)|environment variable/i
const KEY_VAR = /\b[A-Z][A-Z0-9]*_(KEY|TOKEN|SECRET)\b/
const KEY_HINT = { test: (s: string) => KEY_WORDS.test(s) || KEY_VAR.test(s) }

function killTree(pid: number | undefined) {
  if (!pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
  else {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
}

export async function checkWorks(recipe: McpRecipe, timeoutMs = 20_000): Promise<{ check: Check; needsKey: boolean }> {
  const pass = (en: string, ar: string, needsKey = false) => ({ check: { key: 'works' as const, pass: true, detail: t(en, ar) }, needsKey })
  const fail = (en: string, ar: string) => ({ check: { key: 'works' as const, pass: false, detail: t(en, ar) }, needsKey: false })
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'madar-check', version: '1' } } }

  if (recipe.transport === 'http') {
    try {
      const r = await fetch(recipe.url!, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(init), signal: AbortSignal.timeout(timeoutMs) })
      if (r.status === 401 || r.status === 403) return pass('Answers and asks for sign-in', 'تشتغل وتطلب تسجيل دخول', true)
      const body = await r.text()
      return r.ok && /"result"/.test(body) ? pass('Remote server answers', 'الخادم يرد ويشتغل') : fail(`Remote server answered ${r.status}`, 'الخادم ما رد صح')
    } catch {
      return fail('Remote server did not answer', 'الخادم ما رد')
    }
  }

  // the server under test is third-party code: give it only what it needs to start, never the build's secrets
  const KEEP = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PATHEXT', 'npm_config_cache']
  const env: NodeJS.ProcessEnv = {}
  for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k]
  return new Promise((done) => {
    const child = spawn(recipe.command!, recipe.args ?? [], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, shell: process.platform === 'win32' && recipe.command !== process.execPath })
    let out = ''
    let err = ''
    let stage: 'init' | 'list' = 'init'
    let finished = false
    const finish = (r: { check: Check; needsKey: boolean }) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      killTree(child.pid)
      // something it left behind may still hold the pipes: let go of them so the build can exit
      child.stdout.destroy()
      child.stderr.destroy()
      child.stdin.destroy()
      child.unref()
      done(r)
    }
    const timer = setTimeout(() => finish(fail('Did not answer in time', 'ما ردت بالوقت')), timeoutMs)
    child.on('error', () => finish(fail('Could not start', 'ما قدرت تشتغل')))
    child.stdin.on('error', () => {})
    child.stderr.on('data', (d) => { err += d })
    child.stdout.on('data', (d) => {
      out += d
      let nl: number
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl).trim()
        out = out.slice(nl + 1)
        if (!line) continue
        let msg: any
        try { msg = JSON.parse(line) } catch { return finish(fail('Prints non-protocol output', 'تطبع كلام غير متوقع')) }
        if (msg.error && KEY_HINT.test(JSON.stringify(msg.error))) return finish(pass('Starts and asks for a key', 'تشتغل وتطلب مفتاح', true))
        if (stage === 'init' && msg.id === 1 && msg.result) {
          stage = 'list'
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
        } else if (stage === 'list' && msg.id === 2) {
          return finish(msg.result ? pass('Starts and lists its tools', 'تشتغل فعلاً') : fail('Tool list failed', 'ما قدرت تعرض أدواتها'))
        }
      }
    })
    child.on('exit', () => {
      if (KEY_HINT.test(err + out)) finish(pass('Starts and asks for a key', 'تشتغل وتطلب مفتاح', true))
      else finish(fail('Exited during start-up', 'وقفت وهي تشتغل'))
    })
    child.stdin.write(JSON.stringify(init) + '\n')
  })
}
