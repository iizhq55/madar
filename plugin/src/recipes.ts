import type { CatalogItem, Step } from './types.ts'

type Env = { home: string; tmp: string; claude: string; platform?: string }

/** Single-quote for POSIX shell. Values are already pattern-validated; this is defence in depth. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const L = {
  get: { ar: 'أحمّلها', en: 'Downloading' },
  check: { ar: 'أتأكد من الفحص والمتطلبات', en: 'Checking safety and requirements' },
  put: { ar: 'أثبّتها', en: 'Installing' },
  verify: { ar: 'أتأكد إنها تشتغل', en: 'Making sure it works' },
  find: { ar: 'ألقاها', en: 'Finding it' },
  confirm: { ar: 'أتأكد قبل الحذف', en: 'Confirming removal' },
  remove: { ar: 'أشيلها', en: 'Removing' },
  done: { ar: 'أتأكد إنها انشالت', en: 'Making sure it is gone' },
}

function marketplaceName(repo: string): string {
  return repo.split('/')[1]
}

/**
 * The CLI to run: whatever is running Claude's own Bash session (the desktop app ships its own),
 * else the path Madar found. The fallback sits inside double quotes, so shell-special characters are refused.
 */
function cli(fallback: string): string {
  const safe = /^[^"$`\\]+$/.test(fallback) ? fallback : 'claude'
  return `"\${CLAUDE_CODE_EXECPATH:-${safe}}"`
}

export function installSteps(item: CatalogItem, env: Env): Step[] {
  const r = item.recipe
  const C = cli(env.claude)
  if (r.kind === 'skill') {
    const tmp = `${env.tmp}/madar-${r.name}`
    const dest = `${env.home}/.claude/skills/${r.name}`
    return [
      {
        percent: 20,
        label: L.get,
        run: [
          `rm -rf ${q(tmp)}`,
          `git init -q ${q(tmp)}`,
          `git -C ${q(tmp)} fetch -q --depth 1 ${q(`https://github.com/${r.repo}`)} ${q(r.commit)}`,
          `git -C ${q(tmp)} checkout FETCH_HEAD -- ${q(r.path)}`,
        ],
      },
      { percent: 50, label: L.check, run: [`test -f ${q(`${tmp}/${r.path}/SKILL.md`)}`, `test ! -e ${q(dest)}`] },
      { percent: 80, label: L.put, run: [`mkdir -p ${q(`${env.home}/.claude/skills`)}`, `cp -r ${q(`${tmp}/${r.path}`)} ${q(dest)}`] },
      { percent: 100, label: L.verify, run: [`test -f ${q(`${dest}/SKILL.md`)}`, `rm -rf ${q(tmp)}`] },
    ]
  }
  if (r.kind === 'mcp') {
    const add =
      r.transport === 'http'
        ? `${C} mcp add --scope user --transport http ${q(r.name)} ${q(r.url!)}`
        : [
            // Git Bash would rewrite the '/c' below into 'C:/'
            ...(env.platform === 'win32' ? ['MSYS_NO_PATHCONV=1'] : []),
            `${C} mcp add --scope user`,
            q(r.name),
            ...(r.env ?? []).map((e) => `-e ${e}="$${e}"`),
            '--',
            // npx is a .cmd shim on native Windows and must run through cmd /c
            ...(env.platform === 'win32' && r.command === 'npx' ? [q('cmd'), q('/c')] : []),
            q(r.command!),
            ...(r.args ?? []).map(q),
          ].join(' ')
    return [
      { percent: 20, label: L.get },
      { percent: 50, label: L.check },
      { percent: 80, label: L.put, run: [add] },
      { percent: 100, label: L.verify, run: [`${C} mcp get ${q(r.name)}`] },
    ]
  }
  const id = `${r.plugin}@${(r.name ?? marketplaceName(r.marketplace))}`
  return [
    { percent: 20, label: L.get },
    { percent: 50, label: L.check },
    { percent: 80, label: L.put, run: [`${C} plugin marketplace add ${q(r.marketplace)}`, `${C} plugin install ${q(id)} --scope user`] },
    { percent: 100, label: L.verify, run: [`${C} plugin list`] },
  ]
}

/** Post a setup (its long code) as an issue in the setups repo; the issue number is the short code. */
export function shareSteps(setupsRepo: string, code: string): Step[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(setupsRepo)) throw new Error('bad setups repo')
  if (!/^MADAR-X(?:[A-Za-z0-9_-]{5}){1,50}$/.test(code)) throw new Error('bad setup code')
  return [{ percent: 100, label: { ar: 'أنشر أدواتك وأجيب رمز قصير', en: 'Posting your setup for a short code' }, run: [`gh issue create --repo ${q(setupsRepo)} --title ${q('Madar setup')} --body ${q(code)}`] }]
}

/** Update Madar itself: refresh its marketplace, then update the plugin (takes effect after /reload-plugins). */
export function updateSteps(env: { claude: string }): Step[] {
  const C = cli(env.claude)
  return [
    { percent: 50, label: { ar: 'أجيب النسخة الجديدة', en: 'Getting the new version' }, run: [`${C} plugin marketplace update ${q('madar')}`] },
    { percent: 100, label: { ar: 'أحدّث مدار', en: 'Updating Madar' }, run: [`${C} plugin update ${q('madar@madar')} --scope user`] },
  ]
}

/** ⭐ the project on GitHub from the user's own account (GitHub CLI). No leading slash: Git Bash would rewrite it. */
export function starSteps(item: CatalogItem): Step[] {
  if (!item.source) throw new Error(`${item.id} has no GitHub repo to star`)
  const path = q(`user/starred/${item.source.owner}/${item.source.repo}`)
  return [
    { percent: 50, label: { ar: 'أعطيه نجمة في قيت هب', en: 'Starring it on GitHub' }, run: [`gh api --method PUT ${path} --silent`] },
    { percent: 100, label: { ar: 'أتأكد', en: 'Checking' }, run: [`gh api ${path} --silent`] },
  ]
}

export function uninstallSteps(item: CatalogItem, env: Omit<Env, 'tmp'>): Step[] {
  const r = item.recipe
  const C = cli(env.claude)
  let remove: string[]
  let verify: string[]
  if (r.kind === 'skill') {
    const dest = `${env.home}/.claude/skills/${r.name}`
    remove = [`rm -rf ${q(dest)}`]
    verify = [`test ! -e ${q(dest)}`]
  } else if (r.kind === 'mcp') {
    remove = [`${C} mcp remove --scope user ${q(r.name)}`]
    verify = [`${C} mcp list`]
  } else {
    remove = [`${C} plugin uninstall ${q(`${r.plugin}@${(r.name ?? marketplaceName(r.marketplace))}`)}`]
    verify = [`${C} plugin list`]
  }
  return [
    { percent: 20, label: L.find },
    { percent: 50, label: L.confirm },
    { percent: 80, label: L.remove, run: remove },
    { percent: 100, label: L.done, run: verify },
  ]
}
