// minimal stdio MCP server: answers initialize and tools/list
import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
rl.on('line', (l) => {
  const m = JSON.parse(l)
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ok', version: '1' } } })
  if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'hello', inputSchema: { type: 'object' } }] } })
})
