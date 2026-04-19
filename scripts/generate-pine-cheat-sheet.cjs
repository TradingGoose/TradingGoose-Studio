const { spawnSync } = require('node:child_process')
const path = require('node:path')

const ROOT = process.cwd()
const scriptPath = path.join(ROOT, 'scripts', 'indicators', 'index.ts')

const result = spawnSync('bun', ['run', scriptPath], {
  cwd: ROOT,
  stdio: 'inherit',
})

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
