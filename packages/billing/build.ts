import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = import.meta.dir
const output = resolve(root, 'dist')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
for (const [entrypoint, name] of [
  [resolve(root, 'src/index.ts'), 'index.js'],
  [resolve(root, 'src/money.ts'), 'money.js'],
  [resolve(root, '../db/schema.ts'), 'schema.js'],
]) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: 'node',
    format: 'esm',
    external: ['drizzle-orm', 'drizzle-orm/*'],
    naming: name,
    outdir: output,
  })
  if (!result.success) throw new AggregateError(result.logs, 'Financial artifact build failed')
}
const compiler = Bun.spawn(
  ['bun', 'x', '--no-install', 'tsc', '-p', resolve(root, 'tsconfig.declarations.json')],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' }
)
if ((await compiler.exited) !== 0) throw new Error('Financial declarations failed')
await cp(resolve(output, 'types/billing/src/index.d.ts'), resolve(output, 'index.d.ts'))
await cp(resolve(output, 'types/billing/src/money.d.ts'), resolve(output, 'money.d.ts'))
await cp(resolve(output, 'types/billing/src/members.d.ts'), resolve(output, 'members.d.ts'))
await cp(resolve(output, 'types/billing/src/storage.d.ts'), resolve(output, 'storage.d.ts'))
await Bun.write(resolve(output, 'schema.d.ts'), "export * from './types/db/schema.js'\n")

async function normalizeDeclarations(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await normalizeDeclarations(path)
    else if (entry.name.endsWith('.d.ts')) {
      const source = await readFile(path, 'utf8')
      await writeFile(
        path,
        source.replace(
          /(from ['"])(\.[^'"]+)(['"])/g,
          (_match, prefix, name, suffix) =>
            `${prefix}${/\.[a-z]+$/.test(name) ? name : `${name}.js`}${suffix}`
        )
      )
    }
  }
}
await normalizeDeclarations(output)
await cp(
  fileURLToPath(new URL('./LICENCE.md', import.meta.resolve('bignumber.js'))),
  resolve(output, 'bignumber.LICENSE.md')
)
