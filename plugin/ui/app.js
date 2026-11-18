import { filterItems, sortItems, pickText, buttonState, actionProblem, byline, canStar, encodeSetup, decodeSetup, parseShortCode, kofiEmbed } from './logic.js'

const T = {
  ar: {
    brand: 'مدار', heroTitle: 'كل أدوات الذكاء الاصطناعي، في مكان واحد', heroSub: 'شوفها وهي تشتغل، اضغط تثبيت، وخلاص.',
    search: 'ابحث عن أداة أو مهارة… مثلاً "متصفح" أو "تصميم"',
    connected: 'متصل بـ Claude', copyMode: 'نسخ ولصق', langBtn: 'EN',
    all: 'الكل', mcp: 'أدوات', skill: 'مهارات', plugin: 'إضافات', installed: 'المثبّتة عندي',
    shareSetup: 'شارك أدواتك', useCode: 'عندك رمز؟', shareTitle: 'رمز أدواتك', shareHint: 'أرسل الرمز لخويك. يفتح مدار، يضغط «عندك رمز؟» ويلصقه، وتتثبّت له نفس أدواتك.', copyCode: 'انسخ الرمز', codeCopied: 'انسخ الرمز',
    support: '❤ ادعم مدار', supportTip: 'عجبك مدار؟ تقدر تدعمه بأي مبلغ', supportMe: 'ادعمني ☕',
    getShort: 'اعطني رمز قصير', makingShort: 'أجهّز رمز قصير…', shortHint: 'رمز قصير تقدر تحطه في مقطعك أو بايو حسابك. ينشر قائمة أدواتك باسم حسابك في قيت هب.', shortFail: 'ما قدرت أسوي رمز قصير. الرمز الطويل يشتغل عادي', notFound: 'ما لقيت هذا الرمز', lookingUp: 'أدوّر على الرمز…',
    nothingToShare: 'ما عندك أدوات مثبّتة من المتجر للحين', stillChecking: 'لحظة، أشوف وش عندك مثبّت…', codeTitle: 'لصق رمز أدوات', codePlaceholder: 'الصق الرمز هنا… مثلاً MADAR-…', showCode: 'اعرض', badCode: 'هذا مو رمز من مدار', codeHas: 'الرمز فيه', codeMissing: 'أدوات ما عادت موجودة في المتجر', allThere: 'كلها مثبّتة عندك',
    checkUpd: 'تحقق من التحديثات', upToDate: 'عندك آخر نسخة من مدار', updAvail: 'نزلت نسخة جديدة من مدار', youHave: 'عندك', updBtn: 'حدّث الحين', updating: 'جاري تحديث مدار…', updated: 'تم تحديث مدار. اكتب /reload-plugins',
    more: 'عرض المزيد', starMadar: 'نجمة لمدار', starMadarTip: 'عجبك مدار؟ عطه نجمة في قيت هب', star: 'عطها نجمة في قيت هب', starred: 'عطيتها نجمة', starFail: 'ما ضبطت النجمة، شوف رسالة Claude',
    tools: 'أداة', skills: 'مهارة', plugins: 'إضافة', checkedN: 'مفحوصة',
    featured: 'مميّز', bundle: 'مجموعة جاهزة', items: 'عناصر', installAll: 'ثبّت الكل',
    most: 'الأكثر تثبيتاً', results: 'النتائج', installedTitle: 'المثبّتة عندي',
    install: 'تثبيت', busy: 'جاري التثبيت…', done: '✓ مثبّتة', manual: 'مثبّتة يدوياً', remove: 'إزالة', removing: 'جاري الإزالة…',
    checked: '● مفحوصة', unchecked: '● ما انفحصت', needsKey: '● تحتاج مفتاح', noMedia: 'ما فيه صور', video: 'فيديو',
    empty: 'ما لقينا شي. جرّب كلمة ثانية.', copied: 'انسخت لك الطلب، الصقه في المحادثة',
    copyFail: 'ما قدرت أنسخ تلقائياً. انسخ هذا السطر والصقه في المحادثة:',
    afterReload: 'بعد التثبيت اكتب /reload-plugins', afterNew: 'بعد التثبيت افتح محادثة جديدة',
    needs: 'تحتاج:', failed: 'ما ضبط التثبيت، شوف رسالة Claude', notCatalog: 'مو من مدار',
    mcpT: 'أداة', skillT: 'مهارة', pluginT: 'إضافة', close: 'إغلاق',
    stale: 'صفحة المتجر قديمة. قل لـ Claude: افتح المتجر', notMine: 'هذي ما ثبّتها مدار، فما يقدر يشيلها',
    error: 'صار خطأ. جرّب مرة ثانية', loading: 'أحمّل المتجر…',
    stars: 'نجمة', forks: 'نسخة', issues: 'مشكلة مفتوحة', contributors: 'مساهم', updated: 'آخر تحديث', about: 'عن المشروع', safety: 'نتيجة الفحص',
  },
  en: {
    brand: 'Madar', heroTitle: 'Every AI tool, in one place', heroSub: 'Watch it work, click install, done.',
    search: 'Search tools & skills… e.g. "browser" or "design"',
    connected: 'Connected to Claude', copyMode: 'Copy & paste', langBtn: 'ع',
    all: 'All', mcp: 'Tools', skill: 'Skills', plugin: 'Plugins', installed: 'Installed',
    shareSetup: 'Share my setup', useCode: 'Have a code?', shareTitle: 'Your setup code', shareHint: 'Send this code to a friend. In Madar they press "Have a code?", paste it, and get the same tools.', copyCode: 'Copy code', codeCopied: 'Code copied',
    support: '❤ Support', supportTip: 'Like Madar? Support it with a tip', supportMe: 'Support me ☕',
    getShort: 'Get a short code', makingShort: 'Making a short code…', shortHint: 'A short code you can put in a video or your bio. It posts your tool list publicly under your GitHub account.', shortFail: "Couldn't make a short code. The long code still works", notFound: "Couldn't find that code", lookingUp: 'Looking up the code…',
    nothingToShare: "You haven't installed anything from the store yet", stillChecking: 'One moment, checking what you have installed…', codeTitle: 'Paste a setup code', codePlaceholder: 'Paste the code here… e.g. MADAR-…', showCode: 'Show', badCode: "That isn't a Madar code", codeHas: 'This code has', codeMissing: 'tools no longer in the store', allThere: 'You already have all of them',
    checkUpd: 'Check for updates', upToDate: 'You have the latest Madar', updAvail: 'A new version of Madar is out', youHave: 'you have', updBtn: 'Update now', updating: 'Updating Madar…', updated: 'Madar is updated. Type /reload-plugins',
    more: 'Show more', starMadar: 'Star Madar', starMadarTip: 'Like Madar? Give it a star on GitHub', star: 'Star it on GitHub', starred: 'You starred it', starFail: "Couldn't star it — see Claude's message",
    tools: 'tools', skills: 'skills', plugins: 'plugins', checkedN: 'checked',
    featured: 'Featured', bundle: 'Bundle', items: 'items', installAll: 'Install all',
    most: 'Most popular', results: 'Results', installedTitle: 'Installed',
    install: 'Install', busy: 'Installing…', done: '✓ Installed', manual: 'Installed manually', remove: 'Remove', removing: 'Removing…',
    checked: '● Checked', unchecked: '● Not checked', needsKey: '● Needs a key', noMedia: 'No preview', video: 'Video',
    empty: 'Nothing found. Try another word.', copied: 'Copied — paste it into the chat',
    copyFail: "Couldn't copy automatically. Copy this line and paste it into the chat:",
    afterReload: 'After installing, type /reload-plugins', afterNew: 'After installing, open a new conversation',
    needs: 'Needs:', failed: "Install didn't work — see Claude's message", notCatalog: 'Not from Madar',
    mcpT: 'Tool', skillT: 'Skill', pluginT: 'Plugin', close: 'Close',
    stale: 'This store page is out of date. Ask Claude: open the store', notMine: "Madar didn't install this, so it can't remove it",
    error: 'Something went wrong. Try again', loading: 'Loading the store…',
    stars: 'Stars', forks: 'Forks', issues: 'Open issues', contributors: 'Contributors', updated: 'Last update', about: 'About the project', safety: 'Safety checks',
  },
}

/** Cards drawn at a time; "Show more" adds another page (the catalog has thousands). */
const PAGE = 60

const S = {
  lang: 'en', tab: 'all', query: '', shown: PAGE, channel: 'unavailable',
  catalog: { items: [], bundles: [] }, installed: [],
  pending: new Set(), progress: new Map(), notes: new Map(),
  /** ⭐ in flight, and what this browser already starred (remembered between visits). */
  starring: new Set(), starred: new Set(),
}
try { for (const id of JSON.parse(localStorage.getItem('madar-starred') ?? '[]')) S.starred.add(id) } catch {}
const $ = (id) => document.getElementById(id)
const t = (k) => T[S.lang][k]
const tx = (text) => pickText(text, S.lang)

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k))
  return el
}

/* ---------- data ---------- */
async function api(path, opts) {
  try {
    const r = await fetch(path, opts)
    return { status: r.status, body: await r.json().catch(() => ({})) }
  } catch {
    return { status: 0, body: {} }
  }
}
async function loadAll() {
  const { status, body } = await api('/api/catalog')
  if (status !== 200) { toast(t('stale'), true); return false }
  S.catalog = body.catalog
  S.channel = body.channel
  S.self = body.self ?? null
  S.setups = !!body.setups
  S.support = body.support ?? null
  let saved = null
  try { saved = localStorage.getItem('madar-lang') } catch {}
  S.lang = saved === 'ar' || saved === 'en' ? saved : body.lang
  return true
}
async function loadInstalled() {
  try { S.installed = (await api('/api/installed')).body.installed ?? [] } catch { S.installed = [] }
  S.installedLoaded = true
}
const installedIds = () => new Set(S.installed.filter((r) => r.id).map((r) => r.id))
const byMadarIds = () => new Set(S.installed.filter((r) => r.byMadar).map((r) => r.id))

/* ---------- actions ---------- */
function toast(msg, sticky = false) {
  const el = $('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toast.timer)
  if (!sticky) toast.timer = setTimeout(() => el.classList.remove('show'), 3200)
}
async function copyText(text, done = t('copied')) {
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  } catch {
    openSheet(h('div', {},
      h('p', {}, t('copyFail')),
      h('textarea', { class: 'copybox', rows: String(text.split('\n').length), readonly: true, onfocus: (e) => e.target.select() }, text)))
  }
}
async function act(op, ids) {
  closeSheet()
  const copies = []
  for (const id of ids) {
    const { status, body } = await api('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, id, lang: S.lang }) })
    const problem = actionProblem(status)
    if (problem) { toast(t(problem), problem === 'stale'); break }
    if (status === 202 && op === 'update') toast(t('updating'))
    else if (status === 202 && op === 'star') S.starring.add(id)
    else if (status === 202) { S.pending.add(id); S.progress.set(id, { op, percent: 0 }) }
    else if (body.mode === 'copy') copies.push(body.text)
  }
  if (copies.length) await copyText(copies.join('\n'))
  render()
}

function listenProgress() {
  const es = new EventSource('/api/events')
  es.onerror = async () => {
    // the server went away (Claude restarted Madar): say so instead of failing silently
    if ((await api('/api/catalog')).status !== 200) { es.close(); toast(t('stale'), true) }
  }
  es.onmessage = async (e) => {
    const p = JSON.parse(e.data)
    if (typeof p.id === 'string' && p.id.startsWith('star:')) return starProgress(p.id.slice(5), p)
    if (p.id === 'share') {
      // Claude posted the setup: the message is the short code (or why it failed)
      if (p.done && S.shareWait) { const ok = p.done === 'ok' && parseShortCode(p.message); S.shareWait(ok ? { ok: true, code: p.message.trim().toUpperCase() } : { ok: false }); S.shareWait = null }
      return
    }
    if (p.id === SELF_ID) {
      // Madar updating itself
      S.updating = !p.done
      if (p.done) toast(p.done === 'fail' ? t('failed') : p.message || t('updated'), p.done !== 'fail')
      return render()
    }
    const prev = S.progress.get(p.id)
    S.progress.set(p.id, { op: prev?.op ?? 'install', percent: p.percent })
    if (!p.done) S.pending.add(p.id)
    else {
      S.pending.delete(p.id)
      S.progress.delete(p.id)
      if (p.done === 'fail') toast(t('failed'))
      if (p.done === 'needs-step') S.notes.set(p.id, p.message)
      else S.notes.delete(p.id)
      await loadInstalled()
    }
    render()
  }
}

function starProgress(id, p) {
  if (!p.done) S.starring.add(id)
  else {
    S.starring.delete(id)
    if (p.done === 'ok') {
      if (!S.starred.has(id)) {
        S.starred.add(id)
        const it = S.catalog.items.find((i) => i.id === id)
        if (it) { it.stars += 1; if (it.stats) it.stats.stars += 1 }
      }
      try { localStorage.setItem('madar-starred', JSON.stringify([...S.starred])) } catch {}
    } else toast(p.done === 'needs-step' && p.message ? p.message : t('starFail'))
  }
  render()
}

/* ---------- pieces ---------- */
/** Share: the installed store items as a short code a friend can paste into their Madar. */
function shareSetup() {
  if (!S.installedLoaded) return toast(t('stillChecking'))
  const ids = S.catalog.items.filter((i) => installedIds().has(i.id)).map((i) => i.id)
  if (!ids.length) return toast(t('nothingToShare'))
  const code = encodeSetup(ids)
  const box = h('input', { class: 'codebox', readonly: true, value: code, dir: 'ltr', onfocus: (e) => e.target.select() })
  const copy = h('button', { class: 'btn', type: 'button', onclick: () => copyText(box.value, t('codeCopied')) }, t('copyCode'))
  const short = S.setups ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    short.disabled = true
    short.textContent = t('makingShort')
    S.shareWait = (r) => { if (r.ok) { box.value = r.code; box.classList.add('short'); short.remove() } else { short.disabled = false; short.textContent = t('getShort'); toast(t('shortFail')) } }
    const { status } = await api('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'share', id: code, lang: S.lang }) })
    if (status !== 202) S.shareWait({ ok: false })
  } }, t('getShort')) : null
  openSheet(h('div', { class: 'code-sheet' },
    h('h2', {}, t('shareTitle')),
    h('p', { class: 'lead' }, t('shareHint')),
    box,
    h('div', { class: 'row' }, copy, short),
    S.setups ? h('p', { class: 'note' }, t('shortHint')) : null))
}

/** Use a code: show what's in it, then one click installs what this machine doesn't have yet. */
function useCode() {
  const input = h('input', { class: 'codebox', dir: 'ltr', placeholder: t('codePlaceholder'), autocomplete: 'off' })
  const out = h('div', { class: 'code-out' })
  const show = async () => {
    // wait for the installed list, so nothing you already have is offered again
    if (!S.installedLoaded) { out.replaceChildren(h('p', {}, t('stillChecking'))); return setTimeout(show, 800) }
    let code = input.value
    const n = parseShortCode(code)
    if (n) {
      out.replaceChildren(h('p', {}, t('lookingUp')))
      const r = await api(`/api/setup?n=${n}`)
      if (r.status !== 200) return out.replaceChildren(h('p', { class: 'note' }, t('notFound')))
      code = r.body.code
    }
    const { ids, missing } = decodeSetup(code, S.catalog.items.map((i) => i.id))
    if (!ids.length && !missing) return out.replaceChildren(h('p', { class: 'note' }, t('badCode')))
    const items = ids.map((id) => S.catalog.items.find((i) => i.id === id))
    const todo = items.filter((i) => !installedIds().has(i.id) && !S.pending.has(i.id)).map((i) => i.id)
    out.replaceChildren(...[
      h('p', {}, `${t('codeHas')} ${items.length}`),
      h('ul', { class: 'code-list' }, ...items.map((i) => h('li', {}, h('span', { dir: 'auto' }, tx(i.name)), ' ', statusEl(i), installedIds().has(i.id) ? h('span', { class: 'safe' }, ' ' + t('done')) : null))),
      missing ? h('p', { class: 'note' }, `${missing} ${t('codeMissing')}`) : null,
      todo.length ? h('button', { class: 'btn', type: 'button', onclick: () => act('install', todo) }, `${t('installAll')} (${todo.length})`) : h('p', { class: 'safe' }, t('allThere'))].filter(Boolean))
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') show() })
  openSheet(h('div', { class: 'code-sheet' },
    h('h2', {}, t('codeTitle')),
    input,
    h('button', { class: 'btn ghost', type: 'button', onclick: show }, t('showCode')),
    out))
  input.focus()
}

/** Floating "Support me" (Ko-fi style). Opens Ko-fi's own page in a sandboxed frame: it can't reach the store or Claude. */
function renderKofi() {
  const src = kofiEmbed(S.support)
  let fab = document.getElementById('kofi')
  if (!src) return fab?.remove()
  if (!fab) {
    fab = h('div', { id: 'kofi' })
    document.body.append(fab)
  }
  const panel = S.kofiOpen
    ? h('div', { class: 'kofi-panel' },
        h('button', { class: 'kofi-x', type: 'button', 'aria-label': t('close'), onclick: () => { S.kofiOpen = false; renderKofi() } }, '×'),
        h('iframe', { src, title: 'Ko-fi', loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox' }))
    : null
  fab.replaceChildren(...[panel,
    h('button', { class: 'kofi-btn', type: 'button', title: t('supportTip'), onclick: () => { S.kofiOpen = !S.kofiOpen; renderKofi() } }, t('supportMe'))].filter(Boolean))
}

/** ⟳ in the header: ask GitHub whether a newer Madar is out; offer a one-click update. */
async function checkUpdates() {
  const { status, body } = await api('/api/update')
  if (status !== 200) return toast(t('stale'), true)
  const v = (x) => (x ? 'v' + x : '')
  if (!body.available) return toast(`${t('upToDate')} ${v(body.current)}`)
  openSheet(h('div', { class: 'upd-sheet' },
    h('h2', {}, t('updAvail')),
    h('p', { class: 'lead' }, `${v(body.latest)} — ${t('youHave')} ${v(body.current)}`),
    h('button', { class: 'btn', type: 'button', onclick: () => { S.updating = true; act('update', [SELF_ID]) } }, t('updBtn'))))
}
function updBtn() {
  return h('button', { class: 'pill upd', type: 'button', title: t('checkUpd'), 'aria-label': t('checkUpd'), disabled: !!S.updating, onclick: checkUpdates }, S.updating ? '…' : '⟳')
}

/** ⭐ Madar itself, in the header (only once Madar has a public repo). */
const SELF_ID = '@madar'
function selfStar() {
  if (!S.self) return []
  const on = S.starred.has(SELF_ID)
  const busy = S.starring.has(SELF_ID)
  return [h('button', { class: on ? 'star self on' : busy ? 'star self busy' : 'star self', type: 'button', title: t('starMadarTip'), disabled: on || busy,
    onclick: () => act('star', [SELF_ID]) }, on ? '★ ' : busy ? '… ' : '☆ ', t('starMadar'))]
}

/** ⭐ next to Install: Claude stars the project on GitHub from the user's account. */
function starBtn(item) {
  if (!canStar(item)) return null
  if (S.starred.has(item.id)) return h('button', { class: 'star on', type: 'button', disabled: true, title: t('starred'), 'aria-label': t('starred') }, '★')
  if (S.starring.has(item.id)) return h('button', { class: 'star busy', type: 'button', disabled: true, title: t('star') }, '…')
  return h('button', { class: 'star', type: 'button', title: t('star'), 'aria-label': t('star'), onclick: (e) => { e.stopPropagation(); act('star', [item.id]) } }, '☆')
}

/** A project without its own pictures gets its own tile (owner avatar + name), not a generic card. */
function tileEl(item) {
  let avatar = null
  if (item.source) {
    avatar = h('img', { class: 'avatar', src: `https://github.com/${item.source.owner}.png?size=120`, alt: '', loading: 'lazy' })
    avatar.addEventListener('error', () => avatar.remove())
  }
  return h('div', { class: 'tile' },
    avatar,
    h('div', { class: 'tile-name' }, tx(item.name)),
    h('div', { class: 'tile-repo' }, byline(item, true)))
}

function mediaEl(item, { big = false, index = 0 } = {}) {
  const m = item?.media?.[index]
  const box = h('div', { class: 'media' })
  const none = () => box.replaceChildren(tileEl(item))
  if (!m) none()
  else if (m.kind === 'video') {
    const v = h('video', { src: m.url, muted: true, loop: true, playsinline: true, preload: 'metadata', autoplay: big || null, controls: big || null })
    v.muted = true
    v.addEventListener('error', none)
    box.append(v)
    if (!big) box.append(h('div', { class: 'play' }, h('span', {}, '▶')), h('div', { class: 'badge' }, t('video')))
  } else {
    const img = h('img', { src: m.url, alt: '', loading: 'lazy' })
    img.addEventListener('error', none)
    box.append(img)
  }
  if (!big && item) box.addEventListener('click', () => openDetails(item))
  if (!big && (item?.media?.length ?? 0) > 1) box.append(h('div', { class: 'count' }, `🖼 ${item.media.length}`))
  return box
}

/** Gallery for the details sheet: arrows, dots, swipe, arrow keys. */
function galleryEl(item) {
  const n = item.media?.length ?? 0
  if (n <= 1) return h('div', { class: 'gallery' }, mediaEl(item, { big: true }))
  let i = 0
  const stage = h('div', { class: 'stage' })
  const dots = h('div', { class: 'dots' }, item.media.map((_, k) => h('button', { type: 'button', 'aria-label': String(k + 1), onclick: () => go(k) })))
  const go = (k) => {
    i = (k + n) % n
    stage.replaceChildren(mediaEl(item, { big: true, index: i }))
    dots.querySelectorAll('button').forEach((d, k2) => d.classList.toggle('on', k2 === i))
    counter.textContent = `${i + 1} / ${n}`
  }
  const counter = h('div', { class: 'counter' })
  const rtl = () => document.documentElement.dir === 'rtl'
  // "next" sits at the inline end: on the left in Arabic, on the right in English
  const prev = h('button', { class: 'nav prev', type: 'button', 'aria-label': 'previous', onclick: () => go(i - 1) }, '‹')
  const next = h('button', { class: 'nav next', type: 'button', 'aria-label': 'next', onclick: () => go(i + 1) }, '›')
  let x0 = null
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX }, { passive: true })
  stage.addEventListener('touchend', (e) => {
    if (x0 == null) return
    const dx = e.changedTouches[0].clientX - x0
    if (Math.abs(dx) > 40) go(i + ((dx < 0) !== rtl() ? 1 : -1))
    x0 = null
  })
  gallery.keys = (e) => {
    if (e.key === 'ArrowRight') go(i + (rtl() ? -1 : 1))
    if (e.key === 'ArrowLeft') go(i + (rtl() ? 1 : -1))
  }
  const el = h('div', { class: 'gallery' }, stage, prev, next, counter, dots)
  go(0)
  return el
}
const gallery = { keys: null }

function statsEl(item, big = false) {
  const s = item.stats
  if (!s) return null
  const cells = [
    ['★', fmt(s.stars), t('stars')],
    ['⑂', fmt(s.forks), t('forks')],
    ['⊙', fmt(s.issues), t('issues')],
    s.contributors != null ? ['👥', fmt(s.contributors), t('contributors')] : null,
  ].filter(Boolean)
  if (!big) return h('div', { class: 'statrow' }, cells.slice(0, 3).map(([i, v, l]) => h('span', { title: l }, `${i} ${v}`)))
  return h('div', { class: 'statgrid' },
    cells.map(([i, v, l]) => h('div', {}, h('b', {}, `${i} ${v}`), h('small', {}, l))),
    h('div', {}, h('b', {}, s.updatedAt), h('small', {}, t('updated'))))
}

function statusEl(item) {
  if (item.badges?.includes('needs-key')) return h('span', { class: 'key' }, t('needsKey'))
  return item.checked ? h('span', { class: 'safe' }, t('checked')) : h('span', { class: 'old' }, t('unchecked'))
}

function actionBtn(item) {
  const state = buttonState(item.id, { pending: S.pending, installedIds: installedIds(), byMadarIds: byMadarIds() })
  if (state === 'busy') {
    const p = S.progress.get(item.id)
    return h('button', { class: 'btn busy', type: 'button', disabled: true }, p && p.percent ? `${p.percent}/100` : t(p?.op === 'uninstall' ? 'removing' : 'busy'))
  }
  if (state === 'installed') {
    return S.tab === 'installed'
      ? h('button', { class: 'btn remove', type: 'button', onclick: (e) => { e.stopPropagation(); act('uninstall', [item.id]) } }, t('remove'))
      : h('button', { class: 'btn done', type: 'button', disabled: true }, t('done'))
  }
  if (state === 'installed-manual') return h('button', { class: 'btn done', type: 'button', disabled: true }, t('manual'))
  return h('button', { class: item.checked ? 'btn' : 'btn ghost', type: 'button', onclick: (e) => { e.stopPropagation(); act('install', [item.id]) } }, t('install'))
}

function afterNote(item) {
  const n = S.notes.get(item.id)
  if (n) return h('div', { class: 'note' }, n)
  return null
}

function card(item) {
  return h('div', { class: 'card' },
    mediaEl(item),
    h('div', { class: 'body' },
      h('div', { class: 'top' },
        h('div', {}, h('div', { class: 'name', dir: 'auto' }, tx(item.name)), h('div', { class: 'by' }, byline(item, false))),
        h('span', { class: 'type' }, t(item.type + 'T'))),
      h('div', { class: 'desc', dir: 'auto' }, tx(item.description)),
      afterNote(item),
      statsEl(item),
      h('div', { class: 'meta' }, statusEl(item), starBtn(item), actionBtn(item))))
}

function manualCard(row) {
  return h('div', { class: 'card' },
    h('div', { class: 'body' },
      h('div', { class: 'top' }, h('div', { class: 'name' }, row.name), h('span', { class: 'type' }, t(row.type + 'T'))),
      h('div', { class: 'desc' }, t('notCatalog')),
      h('div', { class: 'meta' }, h('button', { class: 'btn done', type: 'button', disabled: true }, t('manual')))))
}

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

function openSheet(content) {
  $('sheet').replaceChildren(h('div', { style: 'display:flex' }, h('button', { class: 'x', type: 'button', 'aria-label': t('close'), onclick: closeSheet }, '✕')), content)
  $('modal').classList.add('show')
}
function closeSheet() { $('modal').classList.remove('show'); $('sheet').replaceChildren(); gallery.keys = null }

function openDetails(item) {
  const after = item.after === 'reload-plugins' ? t('afterReload') : item.after === 'new-session' ? t('afterNew') : null
  const about = item.about ? tx(item.about) : null
  openSheet(h('div', {},
    galleryEl(item),
    h('div', { class: 'head' },
      h('div', {}, h('h2', {}, tx(item.name)), h('div', { class: 'by' }, byline(item, true))),
      h('span', { class: 'type' }, t(item.type + 'T')), starBtn(item), actionBtn(item)),
    h('p', { class: 'lead', dir: 'auto' }, tx(item.description)),
    statsEl(item, true),
    item.requires?.length ? h('p', { class: 'note' }, `${t('needs')} ${item.requires.map((r) => tx(r.label)).join('، ')}`) : null,
    after ? h('p', { class: 'note' }, after) : null,
    about ? h('section', { class: 'about' }, h('h3', {}, t('about')), about.split('\n\n').map((p) => h('p', { dir: 'auto' }, p))) : null,
    h('section', { class: 'about' }, h('h3', {}, t('safety')),
      h('div', { class: 'checks' }, item.checks.map((c) => h('span', { class: c.pass ? 'pass' : 'fail' }, `${c.pass ? '✓' : '✗'} ${c.detail ? tx(c.detail) : c.key}`))))))
}

/* ---------- render ---------- */
function applyLang() {
  document.documentElement.lang = S.lang
  document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr'
  document.title = t('brand')
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t)
  $('q').placeholder = t('search')
  $('lang').textContent = t('langBtn')
}

function render() {
  applyLang()
  const items = S.catalog.items
  const visible = items
  const count = (type) => visible.filter((i) => i.type === type).length

  const conn = $('conn')
  conn.querySelector('.dot').className = S.channel === 'connected' ? 'dot' : 'dot copy'
  conn.querySelector('span').textContent = S.channel === 'connected' ? t('connected') : t('copyMode')
  // Ko-fi gets its floating button (below); other donation sites a link in the header
  $('selfStar').replaceChildren(...[...selfStar(),
    S.support && !kofiEmbed(S.support) ? h('a', { class: 'pill support', href: S.support, target: '_blank', rel: 'noopener noreferrer', title: t('supportTip') }, t('support')) : null,
    updBtn()].filter(Boolean))
  renderKofi()
  $('setupbar').replaceChildren(
    h('button', { class: 'pill', type: 'button', onclick: shareSetup }, '⇪ ', t('shareSetup')),
    h('button', { class: 'pill', type: 'button', onclick: useCode }, '⌨ ', t('useCode')))

  $('stats').replaceChildren(
    h('span', {}, h('b', {}, count('mcp')), t('tools')),
    h('span', {}, h('b', {}, count('skill')), t('skills')),
    h('span', {}, h('b', {}, count('plugin')), t('plugins')),
    h('span', { class: 'safe' }, '✓ ', h('b', {}, visible.filter((i) => i.checked).length), t('checkedN')))

  for (const b of document.querySelectorAll('.tab')) {
    const k = b.dataset.tab
    const n = k === 'all' ? visible.length : k === 'installed' ? S.installed.length : count(k)
    b.replaceChildren(t(k), h('small', {}, n))
    b.classList.toggle('on', S.tab === k)
  }

  const browsing = S.tab === 'all' && !S.query.trim()
  $('featured').hidden = !browsing
  if (browsing) renderFeatured()

  $('secTitle').textContent = S.tab === 'installed' ? t('installedTitle') : browsing ? t('most') : t('results')
  const list = sortItems(filterItems(items, { tab: S.tab, query: S.query, installedIds: installedIds() }))
  const cards = list.slice(0, S.shown).map(card)
  if (S.tab === 'installed') for (const r of S.installed.filter((r) => !r.id)) cards.push(manualCard(r))
  if (list.length > S.shown) cards.push(h('button', { class: 'btn ghost more', type: 'button', onclick: () => { S.shown += PAGE; render() } }, `${t('more')} (${list.length - S.shown})`))
  $('grid').replaceChildren(...(cards.length ? cards : [h('div', { class: 'empty' }, t('empty'))]))
}

function renderFeatured() {
  const items = S.catalog.items.filter((i) => i.checked)
  const top = items.filter((i) => i.type === 'mcp').sort((a, b) => b.stars - a.stars)[0] ?? items[0]
  const bundle = S.catalog.bundles[0]
  const kids = []
  if (top) {
    kids.push(h('div', { class: 'feat' },
      (() => { const m = mediaEl(top); m.append(h('div', { class: 'badge' }, t('featured'))); return m })(),
      h('div', { class: 'info' },
        h('h2', {}, tx(top.name)), h('p', {}, tx(top.description)),
        statsEl(top),
        h('div', { class: 'row' }, h('span', { class: 'meta' }, statusEl(top)), starBtn(top), actionBtn(top)))))
  }
  if (bundle) {
    const members = bundle.items.map((id) => S.catalog.items.find((i) => i.id === id)).filter(Boolean)
    const todo = members.filter((i) => !installedIds().has(i.id) && !S.pending.has(i.id)).map((i) => i.id)
    const m = mediaEl(members[0])
    m.append(h('div', { class: 'badge' }, t('bundle')))
    kids.push(h('div', { class: 'feat' }, m,
      h('div', { class: 'info' },
        h('h2', {}, tx(bundle.name)), h('p', {}, tx(bundle.description)),
        h('div', { class: 'row' }, h('span', { class: 'meta' }, `${members.length} ${t('items')}`),
          todo.length
            ? h('button', { class: 'btn ghost', type: 'button', onclick: () => act('install', todo) }, t('installAll'))
            : h('button', { class: 'btn done', type: 'button', disabled: true }, t('done'))))))
  }
  $('featured').replaceChildren(...kids)
}

/* ---------- stars ---------- */
function stars() {
  const c = $('sky'), x = c.getContext('2d')
  let S2 = []
  const size = () => {
    c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio
    S2 = Array.from({ length: Math.round((innerWidth * innerHeight) / 5200) }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, r: (Math.random() * 1.1 + 0.2) * devicePixelRatio, a: Math.random() * 6, s: Math.random() * 0.012 + 0.003 }))
  }
  const draw = () => {
    x.clearRect(0, 0, c.width, c.height)
    for (const p of S2) { p.a += p.s; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fillStyle = `rgba(225,230,245,${0.25 + 0.55 * Math.abs(Math.sin(p.a))})`; x.fill() }
    requestAnimationFrame(draw)
  }
  addEventListener('resize', size); size(); draw()
}

/* ---------- wire up ---------- */
$('q').addEventListener('input', (e) => { S.query = e.target.value; S.shown = PAGE; render() })
$('lang').addEventListener('click', () => { S.lang = S.lang === 'ar' ? 'en' : 'ar'; try { localStorage.setItem('madar-lang', S.lang) } catch {} render() })
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) { S.tab = b.dataset.tab; S.shown = PAGE; render() } })
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeSheet() })
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); if ($('modal').classList.contains('show') && gallery.keys) gallery.keys(e); if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus() } })

stars()
if (await loadAll()) {
  try { history.replaceState(null, '', location.pathname) } catch {}
  render() // show the catalog right away; installed state fills in after
  loadInstalled().then(render)
  listenProgress()
}
setInterval(() => api('/api/catalog').then(({ body }) => { if (body.channel && body.channel !== S.channel) { S.channel = body.channel; render() } }), 5000)
