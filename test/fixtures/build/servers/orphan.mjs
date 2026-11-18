// leaves a detached process behind that still holds our stdout, then exits
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] })
writeFileSync(process.argv[2], String(g.pid))
process.exit(1)
