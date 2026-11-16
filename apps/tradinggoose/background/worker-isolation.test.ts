/** @vitest-environment node */
import fs from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../..')
const entries = [
  'trigger.config.ts',
  'background/tasks/copilot-execution.ts',
  'lib/copilot/agent/worker.ts',
]
const allowedFiles = new Set(['lib/auth/internal-token.ts'])
const forbiddenPaths = [
  'app',
  'blocks',
  'components',
  'executor',
  'hooks',
  'providers',
  'serializer',
  'stores',
  'widgets',
  'lib/auth',
  'lib/auth.ts',
  'lib/billing',
  'lib/credentials',
  'lib/email',
  'lib/knowledge',
  'lib/oauth',
  'lib/system-services',
  'lib/system-settings',
  'lib/uploads',
  'lib/yjs',
  'lib/copilot/tools/server',
  'lib/copilot/agent/service.ts',
  'lib/copilot/agent/worker-server.ts',
  'lib/copilot/settings.server.ts',
  'lib/copilot/process-contents.ts',
  'lib/copilot/native/business-access.ts',
  'lib/copilot/native/readback.ts',
  'lib/copilot/native/target.ts',
  'lib/copilot/native/workflow-effects.ts',
  'lib/mastra/connections.ts',
  'lib/mastra/providers.ts',
  'lib/mastra/registry.ts',
  'lib/mastra/request.ts',
]
const forbiddenPackages =
  /^(?:(?:@tradinggoose\/db|drizzle-orm|@opencode-ai\/models|next|next-runtime-env|better-auth|react|react-dom|zustand)(?:$|\/)|(?:@next|@better-auth|@react-email|@xyflow)\/)/
const configPath = path.join(root, 'tsconfig.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const resolutionCache = ts.createModuleResolutionCache(root, (file) => file, options)

function runtimeImports(
  file: string,
  contents = fs.readFileSync(file, 'utf8'),
  includeDeferred = true
) {
  const emitted = ts.transpileModule(contents, {
    fileName: file,
    compilerOptions: { ...options, noEmit: false, sourceMap: false, module: ts.ModuleKind.ESNext },
  }).outputText
  const source = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const imports: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      if (!includeDeferred && node.expression.kind === ts.SyntaxKind.ImportKeyword) return
      const specifier = node.arguments[0]
      if (!specifier || !ts.isStringLiteralLike(specifier)) {
        throw new Error(`Nonliteral runtime import in ${path.relative(root, file)}`)
      }
      imports.push(specifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

function runtimeGraphViolations(
  entries: string[],
  forbiddenFile: (relative: string) => boolean,
  packages = forbiddenPackages,
  includeDeferred = true
) {
  const pending = entries.map((entry) => ({ file: path.join(root, entry), chain: [entry] }))
  const seen = new Set<string>()
  const violations = new Set<string>()
  for (const { file, chain } of pending) {
    if (seen.has(file)) continue
    seen.add(file)
    if (!fs.existsSync(file)) {
      violations.add(`${chain.join(' -> ')} (missing runtime entry)`)
      continue
    }
    for (const specifier of runtimeImports(file, undefined, includeDeferred)) {
      const edge = [...chain, specifier]
      if (packages.test(specifier)) {
        violations.add(edge.join(' -> '))
        continue
      }
      const resolved = ts.resolveModuleName(
        specifier,
        file,
        options,
        ts.sys,
        resolutionCache
      ).resolvedModule
      if (!resolved) {
        if (!isBuiltin(specifier)) violations.add(`${edge.join(' -> ')} (unresolved)`)
        continue
      }
      const dependency = fs.realpathSync(resolved.resolvedFileName)
      if (!dependency.startsWith(`${workspace}/`) || dependency.includes('/node_modules/')) continue
      const relative = path.relative(root, dependency)
      const next = [...chain, relative]
      if (forbiddenFile(relative)) {
        violations.add(next.join(' -> '))
      } else if (!dependency.endsWith('.json')) {
        pending.push({ file: dependency, chain: next })
      }
    }
  }
  return [...violations]
}

it('keeps the complete Copilot worker runtime graph independent of Studio business services', () => {
  expect(
    runtimeGraphViolations(
      entries,
      (relative) =>
        !allowedFiles.has(relative) &&
        (relative.startsWith('../../packages/db/') ||
          (relative.startsWith('background/') && !entries.includes(relative)) ||
          forbiddenPaths.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`)))
    ),
    'Runtime imports include deferred tools and real workspace packages'
  ).toEqual([])
})

it('registers every task without eagerly loading application configuration or execution engines', () => {
  const definitions = [
    'trigger.config.ts',
    ...fs
      .readdirSync(path.join(root, 'background/tasks'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `background/tasks/${file}`),
  ]
  expect(
    runtimeGraphViolations(
      definitions,
      (relative) => !definitions.includes(relative) && relative !== 'background/execution-job.ts',
      /^(?:@tradinggoose\/db|drizzle-orm|@mastra\/|@e2b\/|e2b(?:$|\/)|pinets(?:$|\/)|next(?:$|\/)|next-runtime-env(?:$|\/))/,
      false
    )
  ).toEqual([])
})

it('keeps indicator engines deferred until the execution backend is selected', () => {
  expect(
    runtimeGraphViolations(
      ['background/indicator-monitor-execution.ts'],
      (relative) =>
        /^(?:executor|lib\/mastra|lib\/copilot\/(?:agent|tools))(?:$|\/)/.test(relative),
      /^(?:@mastra\/|@e2b\/|e2b(?:$|\/)|pinets(?:$|\/))/,
      false
    )
  ).toEqual([])
})

it('inspects deferred runtime dependencies while erasing type-only imports', () => {
  expect(
    runtimeImports(
      'fixture.ts',
      "import type { Billing } from './ledger'; export { run } from './native'; const load = () => import('./business'); require('./other')"
    )
  ).toEqual(['./native', './business', './other'])
  expect(
    runtimeImports(
      'fixture.ts',
      "import type { Billing } from './ledger'; export { run } from './native'; const load = () => import('./business'); require('./other')",
      false
    )
  ).toEqual(['./native', './other'])
  expect(() => runtimeImports('fixture.ts', 'import(moduleName)')).toThrow(
    'Nonliteral runtime import'
  )
})
