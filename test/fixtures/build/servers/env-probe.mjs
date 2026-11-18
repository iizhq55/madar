// answers like ok.mjs, but fails if it can see build secrets
import { createInterface } from 'node:readline'
const leaked = process.env.GITHUB_TOKEN || process.env.MADAR_TEST_SECRET
const rl = createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
rl.on('line', (l) => {
  const m = JSON.parse(l)
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'probe', version: '1' } } })
  if (m.method === 'tools/list') send(leaked ? { jsonrpc: '2.0', id: m.id, error: { code: -1, message: 'saw a secret' } } : { jsonrpc: '2.0', id: m.id, result: { tools: [] } })
})
