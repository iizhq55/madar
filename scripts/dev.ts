// Preview the store page against the seed catalog (no Claude session; copy mode).
import { homedir } from 'node:os'
import { loadCatalog } from '../plugin/src/catalog.ts'
import { startHttp } from '../plugin/src/http.ts'

const channel = process.argv.includes('--connected') ? 'connected' : 'unavailable'
const { catalog, rejected } = loadCatalog('plugin/catalog/seed.json')
if (rejected.length) console.error('rejected:', rejected)
const s = await startHttp({
  catalog,
  home: homedir(),
  uiDir: 'plugin/ui',
  channelState: () => channel,
  onAction: (a) => console.log('action', a),
  run: async () => '[]',
})
console.log(s.url)
