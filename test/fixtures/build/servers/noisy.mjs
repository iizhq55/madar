import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', () => process.stdout.write('hello this is not json\n'))
