// Plugin entry point (see .mcp.json). Always starts the server.
import { main } from './server.ts'

main().catch((e) => {
  console.error('madar failed to start:', e)
  process.exit(1)
})
