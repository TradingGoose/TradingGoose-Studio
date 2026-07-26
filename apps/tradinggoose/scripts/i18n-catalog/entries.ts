import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { extractCallableInitializer, getLiteralPropertyName } from './scan/core/ast'
import type { NamedFunctionNode } from './scan/core/types'
import { findBestMatchingRoutePattern, normalizeRoutePath } from './ownership'

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'] as const

type FrameworkEntryBasename =
  | 'page'
  | 'layout'
  | 'template'
  | 'loading'
  | 'error'
  | 'global-error'
  | 'not-found'

export type EntryExportName = string

type FrameworkEntrySpec = {
  basename: FrameworkEntryBasename
  exportNames: EntryExportName[]
}

type EntryDiscoveryResult = {
  entryExportNamesByFile: Map<string, EntryExportName[]>
  entryFiles: string[]
  skipRuntimeImportFiles: string[]
}

export type RouteResolution = EntryDiscoveryResult & {
  pageFilePath: string
  routeOwnedRoots: string[]
  routePath: string
}

export type EntryDiscoveryContext = {
  allModeEntries: EntryDiscoveryResult | null
  appRoot: string
  appSourceFiles: string[]
  knownRoutePaths: Set<string>
  localizedPageFiles: string[]
  localeRoot: string
  pageFilePathByRoute: Map<string, string>
  projectRoot: string
  routeEntriesByRoute: Map<string, RouteResolution>
  routePathByDirectory: Map<string, string | null>
}

type EntryDiscoveryInput = EntryDiscoveryContext | string

export type CanonicalRouteInventory = {
  localizedPageFiles: string[]
  pageFilePathByRoute: Map<string, string>
  routePaths: string[]
}

export type StandaloneAllModeEntrySpec = {
  relativePath: string
}

const FRAMEWORK_ENTRY_SPECS: readonly FrameworkEntrySpec[] = [
  { basename: 'page', exportNames: ['default', 'generateMetadata'] },
  { basename: 'layout', exportNames: ['default', 'generateMetadata'] },
  { basename: 'template', exportNames: ['default'] },
  { basename: 'loading', exportNames: ['default'] },
  { basename: 'error', exportNames: ['default'] },
  { basename: 'global-error', exportNames: ['default'] },
  { basename: 'not-found', exportNames: ['default'] },
]

export const SUPPORTED_FRAMEWORK_ENTRY_BASENAMES = FRAMEWORK_ENTRY_SPECS.map(
  (spec) => spec.basename
) as readonly FrameworkEntryBasename[]

export const STANDALONE_ALL_MODE_ENTRY_SPECS: readonly StandaloneAllModeEntrySpec[] = [
  {
    relativePath: 'components/emails/render-email.ts',
  },
] as const

export const DASHBOARD_ROUTE_PATH = '/workspace/[workspaceId]/dashboard'
export const WIDGET_REGISTRY_RELATIVE_PATH = 'widgets/registry.tsx'

const FRAMEWORK_ENTRY_SPEC_BY_BASENAME = new Map(
  FRAMEWORK_ENTRY_SPECS.map((spec) => [spec.basename, spec])
)

const FRAMEWORK_ENTRY_BASENAMES = new Set<FrameworkEntryBasename>(
  SUPPORTED_FRAMEWORK_ENTRY_BASENAMES
)

const ROUTE_SIBLING_ENTRY_BASENAMES = new Set<FrameworkEntryBasename>(
  SUPPORTED_FRAMEWORK_ENTRY_BASENAMES
)

const ANCESTOR_LOCALIZED_ENTRY_BASENAMES = new Set<FrameworkEntryBasename>([
  'layout',
  'template',
  'loading',
  'error',
  'global-error',
  'not-found',
])

const NON_LOCALIZED_BOUNDARY_ENTRY_BASENAMES = new Set<FrameworkEntryBasename>([
  'template',
  'loading',
  'error',
  'global-error',
  'not-found',
])

function splitProjectPath(relativePath: string) {
  return relativePath.split('/').filter(Boolean)
}

function hasPathPrefix(segments: string[], prefix: string[]) {
  return prefix.every((segment, index) => segments[index] === segment)
}

export function isIgnoredProjectPath(relativePath: string) {
  const segments = splitProjectPath(relativePath)
  return (
    segments.includes('node_modules') ||
    segments.includes('migration') ||
    segments.includes('__tests__') ||
    segments.includes('__mocks__') ||
    hasPathPrefix(segments, ['app', 'api']) ||
    /\.(test|spec|stories)\.[^.]+$/.test(relativePath)
  )
}

function isIgnoredDirectoryPath(relativePath: string) {
  const segments = splitProjectPath(relativePath)
  return (
    segments.includes('node_modules') ||
    segments.includes('.next') ||
    segments.includes('dist') ||
    segments.includes('migration') ||
    segments.includes('__tests__') ||
    segments.includes('__mocks__') ||
    hasPathPrefix(segments, ['app', 'api'])
  )
}

function isSourceFilePath(filePath: string) {
  return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension))
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function createProjectSourceFile(filePath: string) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  )
}

function hasModifier(node: { modifiers?: ts.NodeArray<ts.ModifierLike> }, kind: ts.SyntaxKind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind))
}

type ImportBinding = {
  importedName: string
  resolvedFilePath: string
}

function collectImportBindings(
  projectRoot: string,
  importerFilePath: string,
  sourceFile: ts.SourceFile
) {
  const importBindings = new Map<string, ImportBinding>()

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
      return
    }

    const resolvedFilePath = resolveImportPath(projectRoot, importerFilePath, node.moduleSpecifier.text)
    if (!resolvedFilePath) {
      return
    }

    const importClause = node.importClause
    if (!importClause) {
      return
    }

    if (importClause.name) {
      importBindings.set(importClause.name.text, {
        importedName: 'default',
        resolvedFilePath,
      })
    }

    const namedBindings = importClause.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      return
    }

    for (const element of namedBindings.elements) {
      importBindings.set(element.name.text, {
        importedName: element.propertyName?.text ?? element.name.text,
        resolvedFilePath,
      })
    }
  })

  return importBindings
}

function collectMatchingNamedExports(filePath: string, matchesExportName: (name: string) => boolean) {
  const sourceFile = createProjectSourceFile(filePath)
  const exportNames = new Set<string>()

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      if (matchesExportName(node.name.text)) {
        exportNames.add(node.name.text)
      }
      return
    }

    if (ts.isVariableStatement(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !matchesExportName(declaration.name.text)) {
          continue
        }

        exportNames.add(declaration.name.text)
      }
      return
    }

    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      !node.moduleSpecifier &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        if (matchesExportName(element.name.text)) {
          exportNames.add(element.name.text)
        }
      }
    }
  })

  return [...exportNames].sort()
}

function matchesStandaloneAllModeEntryExportName(name: string) {
  return /^get[A-Z].*Subject$/.test(name) || /^render[A-Z].*Email$/.test(name)
}

export function toRelativeProjectPath(projectRoot: string, filePath: string) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/')
}

function resolveImportPath(
  projectRoot: string,
  importerFilePath: string,
  specifier: string
): string | null {
  let basePath: string | null = null
  if (specifier.startsWith('@/')) {
    basePath = path.join(projectRoot, specifier.slice(2))
  } else if (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  ) {
    basePath = path.resolve(path.dirname(importerFilePath), specifier)
  }

  if (!basePath) {
    return null
  }

  const candidates = [basePath, ...SOURCE_EXTENSIONS.map((extension) => `${basePath}${extension}`)]
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(path.join(basePath, `index${extension}`))
  }

  for (const candidate of candidates) {
    if (!isPathInsideDirectory(candidate, projectRoot)) {
      continue
    }

    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue
    }

    if (!isSourceFilePath(candidate)) {
      return null
    }

    const relativePath = toRelativeProjectPath(projectRoot, candidate)
    if (isIgnoredProjectPath(relativePath)) {
      return null
    }

    return candidate
  }

  return null
}

function unwrapRegistryExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapRegistryExpression(expression.expression)
  }

  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapRegistryExpression(expression.expression)
  }

  return expression
}

export function walkProjectSourceFiles(
  projectRoot: string,
  startDirectory = projectRoot
): string[] {
  const pending = [startDirectory]
  const results: string[] = []

  while (pending.length > 0) {
    const directory = pending.pop()!
    const entries = fs.readdirSync(directory, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = toRelativeProjectPath(projectRoot, absolutePath)

      if (entry.isDirectory()) {
        if (isIgnoredDirectoryPath(relativePath)) {
          continue
        }
        pending.push(absolutePath)
        continue
      }

      if (!entry.isFile() || !isSourceFilePath(absolutePath)) {
        continue
      }

      if (isIgnoredProjectPath(relativePath)) {
        continue
      }

      results.push(absolutePath)
    }
  }

  return results.sort()
}

export function isPathInsideDirectory(targetPath: string, directoryPath: string) {
  const relativePath = path.relative(directoryPath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function isRouteGroupSegment(segment: string) {
  return /^\(.+\)$/.test(segment)
}

function toRoutePath(routeSegments: string[]) {
  return routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`
}

function normalizeAppRouteSegments(routeSegments: string[]) {
  const normalizedSegments = routeSegments.filter((segment) => !isRouteGroupSegment(segment))
  if (normalizedSegments[0] === '[locale]') {
    normalizedSegments.shift()
  }
  return normalizedSegments
}

function getLocalizedAppRoot(projectRoot: string) {
  return path.join(projectRoot, 'app', '[locale]')
}

export function collectCanonicalRouteInventory(
  projectRoot: string,
  appSourceFiles = walkProjectSourceFiles(projectRoot, path.join(projectRoot, 'app'))
): CanonicalRouteInventory {
  const localeRoot = getLocalizedAppRoot(projectRoot)
  const localizedPageFiles = appSourceFiles
    .filter(
      (filePath) =>
        isPathInsideDirectory(filePath, localeRoot) &&
        path.basename(filePath, path.extname(filePath)) === 'page'
    )
    .sort()
  const pageFilePathByRoute = new Map<string, string>()

  for (const filePath of localizedPageFiles) {
    const relativePath = path.relative(localeRoot, filePath).split(path.sep)
    const routePath = toRoutePath(normalizeAppRouteSegments(relativePath.slice(0, -1)))
    pageFilePathByRoute.set(routePath, filePath)
  }

  return {
    localizedPageFiles,
    pageFilePathByRoute,
    routePaths: [...pageFilePathByRoute.keys()].sort(),
  }
}

function isFrameworkEntryBasename(value: string): value is FrameworkEntryBasename {
  return FRAMEWORK_ENTRY_BASENAMES.has(value as FrameworkEntryBasename)
}

function getFrameworkEntrySpec(filePath: string) {
  const basename = path.basename(filePath, path.extname(filePath))
  if (!isFrameworkEntryBasename(basename)) {
    return null
  }

  return FRAMEWORK_ENTRY_SPEC_BY_BASENAME.get(basename) ?? null
}

function addEntryFile(
  entryExportNamesByFile: Map<string, EntryExportName[]>,
  filePath: string,
  exportNames: EntryExportName[]
) {
  const existing = entryExportNamesByFile.get(filePath) ?? []
  entryExportNamesByFile.set(filePath, [...new Set([...existing, ...exportNames])])
}

type WidgetRegistryRootMode = 'all' | 'route'

type WidgetRegistryEntryRoots = {
  entryExportNamesByFile: Map<string, EntryExportName[]>
  skipRuntimeImportFiles: Set<string>
}

type WidgetRenderHeaderRouteRoot = {
  exportName: EntryExportName
  filePath: string
}

function findTopLevelVariableDeclaration(
  sourceFile: ts.SourceFile,
  variableName: string
): ts.VariableDeclaration | null {
  let match: ts.VariableDeclaration | null = null

  ts.forEachChild(sourceFile, (node) => {
    if (match || !ts.isVariableStatement(node)) {
      return
    }

    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === variableName &&
        declaration.initializer
      ) {
        match = declaration
        return
      }
    }
  })

  return match
}

function findObjectLiteralVariableInitializer(
  sourceFile: ts.SourceFile,
  variableName: string
): ts.ObjectLiteralExpression | null {
  const declaration = findTopLevelVariableDeclaration(sourceFile, variableName)
  if (!declaration?.initializer) {
    return null
  }

  const initializer = unwrapRegistryExpression(declaration.initializer)
  return ts.isObjectLiteralExpression(initializer) ? initializer : null
}

function getObjectLiteralPropertyInitializer(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string
): ts.Expression | null {
  for (const property of objectLiteral.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      getLiteralPropertyName(property.name) === propertyName
    ) {
      return unwrapRegistryExpression(property.initializer)
    }

    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
      return property.name
    }
  }

  return null
}

function collectTopLevelCallableDeclarations(sourceFile: ts.SourceFile) {
  const topLevelCallableDeclarations = new Map<string, NamedFunctionNode>()
  const topLevelVariableDeclarations = new Map<string, ts.VariableDeclaration>()

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      topLevelCallableDeclarations.set(node.name.text, node)
    }

    if (!ts.isVariableStatement(node)) {
      return
    }

    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        topLevelVariableDeclarations.set(declaration.name.text, declaration)
      }
    }
  })

  let discoveredTopLevelCallable = true
  while (discoveredTopLevelCallable) {
    discoveredTopLevelCallable = false

    for (const [name, declaration] of topLevelVariableDeclarations.entries()) {
      if (!declaration.initializer) {
        continue
      }

      const functionTarget = extractCallableInitializer(
        declaration.initializer,
        (callableName) => topLevelCallableDeclarations.get(callableName) ?? null
      )
      if (!functionTarget || topLevelCallableDeclarations.get(name) === functionTarget) {
        continue
      }

      topLevelCallableDeclarations.set(name, functionTarget)
      discoveredTopLevelCallable = true
    }
  }

  return topLevelCallableDeclarations
}

function resolveWidgetRenderHeaderRouteRoot(
  projectRoot: string,
  widgetDefinitionFilePath: string,
  widgetExportName: string
): WidgetRenderHeaderRouteRoot | null {
  const sourceFile = createProjectSourceFile(widgetDefinitionFilePath)
  const importBindings = collectImportBindings(projectRoot, widgetDefinitionFilePath, sourceFile)
  const localCallables = collectTopLevelCallableDeclarations(sourceFile)
  const widgetInitializer = findObjectLiteralVariableInitializer(sourceFile, widgetExportName)
  if (!widgetInitializer) {
    return null
  }

  const renderHeaderInitializer = getObjectLiteralPropertyInitializer(widgetInitializer, 'renderHeader')
  if (!renderHeaderInitializer) {
    return null
  }

  if (ts.isIdentifier(renderHeaderInitializer)) {
    const importBinding = importBindings.get(renderHeaderInitializer.text)
    if (importBinding) {
      return {
        exportName: importBinding.importedName,
        filePath: importBinding.resolvedFilePath,
      }
    }

    if (localCallables.has(renderHeaderInitializer.text)) {
      return {
        exportName: `${widgetExportName}.renderHeader`,
        filePath: widgetDefinitionFilePath,
      }
    }

    return null
  }

  const localCallable = extractCallableInitializer(
    renderHeaderInitializer,
    (callableName) => localCallables.get(callableName) ?? null
  )
  if (!localCallable) {
    return null
  }

  return {
    exportName: `${widgetExportName}.renderHeader`,
    filePath: widgetDefinitionFilePath,
  }
}

function collectWidgetRegistryEntryRoots(
  context: EntryDiscoveryContext,
  mode: WidgetRegistryRootMode
): WidgetRegistryEntryRoots {
  const entryExportNamesByFile = new Map<string, EntryExportName[]>()
  const skipRuntimeImportFiles = new Set<string>()
  const registryFilePath = path.join(context.projectRoot, WIDGET_REGISTRY_RELATIVE_PATH)
  if (!fs.existsSync(registryFilePath) || !fs.statSync(registryFilePath).isFile()) {
    return {
      entryExportNamesByFile,
      skipRuntimeImportFiles,
    }
  }

  const sourceFile = createProjectSourceFile(registryFilePath)
  const importedBindings = collectImportBindings(context.projectRoot, registryFilePath, sourceFile)
  const widgetRegistryInitializer = findObjectLiteralVariableInitializer(sourceFile, 'widgetRegistry')
  if (!widgetRegistryInitializer) {
    return {
      entryExportNamesByFile,
      skipRuntimeImportFiles,
    }
  }

  for (const property of widgetRegistryInitializer.properties) {
    const initializer =
      ts.isPropertyAssignment(property)
        ? unwrapRegistryExpression(property.initializer)
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : null
    if (!initializer || !ts.isIdentifier(initializer)) {
      continue
    }

    const importedBinding = importedBindings.get(initializer.text)
    if (!importedBinding) {
      continue
    }

    if (mode === 'all') {
      addEntryFile(entryExportNamesByFile, importedBinding.resolvedFilePath, [
        `${importedBinding.importedName}.component`,
        `${importedBinding.importedName}.renderHeader`,
      ])
      continue
    }

    const headerRoot = resolveWidgetRenderHeaderRouteRoot(
      context.projectRoot,
      importedBinding.resolvedFilePath,
      importedBinding.importedName
    )
    if (!headerRoot) {
      continue
    }

    addEntryFile(entryExportNamesByFile, headerRoot.filePath, [headerRoot.exportName])
    if (headerRoot.filePath === importedBinding.resolvedFilePath) {
      skipRuntimeImportFiles.add(headerRoot.filePath)
    }
  }

  return {
    entryExportNamesByFile,
    skipRuntimeImportFiles,
  }
}

function addWidgetRegistryEntryRoots(
  context: EntryDiscoveryContext,
  entryExportNamesByFile: Map<string, EntryExportName[]>,
  mode: WidgetRegistryRootMode
): Set<string> {
  const { entryExportNamesByFile: widgetEntryRoots, skipRuntimeImportFiles } =
    collectWidgetRegistryEntryRoots(context, mode)
  for (const [filePath, exportNames] of widgetEntryRoots.entries()) {
    addEntryFile(entryExportNamesByFile, filePath, exportNames)
  }

  return skipRuntimeImportFiles
}

function resolveStandaloneAllModeEntryFile(projectRoot: string, relativePath: string) {
  const filePath = path.join(projectRoot, relativePath)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null
  }

  return filePath
}

function resolveStandaloneAllModeEntryExportNames(filePath: string) {
  return collectMatchingNamedExports(filePath, matchesStandaloneAllModeEntryExportName)
}

function collectFrameworkEntriesInDirectory(
  directoryPath: string,
  allowedBasenames: ReadonlySet<FrameworkEntryBasename>,
  entryExportNamesByFile: Map<string, EntryExportName[]>
) {
  for (const basename of allowedBasenames) {
    const spec = FRAMEWORK_ENTRY_SPEC_BY_BASENAME.get(basename)
    if (!spec) {
      continue
    }

    for (const extension of SOURCE_EXTENSIONS) {
      const candidatePath = path.join(directoryPath, `${basename}${extension}`)
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        addEntryFile(entryExportNamesByFile, candidatePath, spec.exportNames)
      }
    }
  }
}

function resolveEntryDiscoveryContext(input: EntryDiscoveryInput) {
  return typeof input === 'string' ? createEntryDiscoveryContext(input) : input
}

export function createEntryDiscoveryContext(projectRoot: string): EntryDiscoveryContext {
  const appRoot = path.join(projectRoot, 'app')
  const appSourceFiles = walkProjectSourceFiles(projectRoot, appRoot)
  const localeRoot = getLocalizedAppRoot(projectRoot)
  const routeInventory = collectCanonicalRouteInventory(projectRoot, appSourceFiles)

  return {
    allModeEntries: null,
    appRoot,
    appSourceFiles,
    knownRoutePaths: new Set(routeInventory.routePaths),
    localizedPageFiles: routeInventory.localizedPageFiles,
    localeRoot,
    pageFilePathByRoute: routeInventory.pageFilePathByRoute,
    projectRoot,
    routeEntriesByRoute: new Map(),
    routePathByDirectory: new Map(),
  }
}

function findLocalizedPageFile(context: EntryDiscoveryContext, routePath: string) {
  const normalizedRoutePath = normalizeRoutePath(routePath)
  const matchedRoutePath =
    context.pageFilePathByRoute.get(normalizedRoutePath) !== undefined
      ? normalizedRoutePath
      : findBestMatchingRoutePattern(normalizedRoutePath, context.pageFilePathByRoute.keys())
  const pageFilePath = matchedRoutePath ? context.pageFilePathByRoute.get(matchedRoutePath) : null
  if (!pageFilePath) {
    throw new Error(`Unable to resolve route "${normalizedRoutePath}" from app/[locale]`)
  }

  return {
    filePath: pageFilePath,
    routePath: matchedRoutePath!,
  }
}

function collectLocalizedRouteEntries(localeRoot: string, pageFilePath: string) {
  const entryExportNamesByFile = new Map<string, EntryExportName[]>()
  let directory = path.dirname(pageFilePath)
  let currentBasenames = ROUTE_SIBLING_ENTRY_BASENAMES

  while (directory.startsWith(localeRoot)) {
    collectFrameworkEntriesInDirectory(directory, currentBasenames, entryExportNamesByFile)

    if (directory === localeRoot) {
      break
    }

    directory = path.dirname(directory)
    currentBasenames = ANCESTOR_LOCALIZED_ENTRY_BASENAMES
  }

  return entryExportNamesByFile
}

export function isRoutePathPrefix(prefix: string, routePath: string) {
  if (prefix === routePath) {
    return true
  }

  if (prefix === '/') {
    return true
  }

  return routePath.startsWith(`${prefix}/`)
}

function getRoutePathForAppDirectory(context: EntryDiscoveryContext, directoryPath: string) {
  if (context.routePathByDirectory.has(directoryPath)) {
    return context.routePathByDirectory.get(directoryPath) ?? null
  }

  let routePath: string | null = null

  if (isPathInsideDirectory(directoryPath, context.appRoot)) {
    const relativePath = path.relative(context.appRoot, directoryPath)
    routePath = !relativePath
      ? '/'
      : toRoutePath(normalizeAppRouteSegments(relativePath.split(path.sep).filter(Boolean)))
  }

  context.routePathByDirectory.set(directoryPath, routePath)
  return routePath
}

export function resolveAppRoutePathForFile(
  input: EntryDiscoveryInput,
  filePath: string
): string | null {
  const context = resolveEntryDiscoveryContext(input)
  if (!isPathInsideDirectory(filePath, context.appRoot)) {
    return null
  }

  return getRoutePathForAppDirectory(context, path.dirname(filePath))
}

function collectNonLocalizedRouteBoundaryEntries(
  context: EntryDiscoveryContext,
  routePath: string
) {
  const entryExportNamesByFile = new Map<string, EntryExportName[]>()

  for (const filePath of context.appSourceFiles) {
    if (isPathInsideDirectory(filePath, context.localeRoot)) {
      continue
    }

    const spec = getFrameworkEntrySpec(filePath)
    if (!spec || !NON_LOCALIZED_BOUNDARY_ENTRY_BASENAMES.has(spec.basename)) {
      continue
    }

    const directoryPath = path.dirname(filePath)
    const directoryRoutePath = getRoutePathForAppDirectory(context, directoryPath)
    if (!directoryRoutePath || !isRoutePathPrefix(directoryRoutePath, routePath)) {
      continue
    }

    addEntryFile(entryExportNamesByFile, filePath, spec.exportNames)
  }

  return entryExportNamesByFile
}

function collectExactNonLocalizedRouteOwnedRoots(
  context: EntryDiscoveryContext,
  routePath: string
) {
  const routeOwnedRoots = new Set<string>()

  for (const filePath of context.appSourceFiles) {
    if (isPathInsideDirectory(filePath, context.localeRoot)) {
      continue
    }

    let directoryPath = path.dirname(filePath)
    while (
      directoryPath !== context.appRoot &&
      isPathInsideDirectory(directoryPath, context.appRoot)
    ) {
      if (getRoutePathForAppDirectory(context, directoryPath) === routePath) {
        routeOwnedRoots.add(directoryPath)
        break
      }

      const parentDirectoryPath = path.dirname(directoryPath)
      if (parentDirectoryPath === directoryPath) {
        break
      }
      directoryPath = parentDirectoryPath
    }
  }

  return [...routeOwnedRoots].sort()
}

function toEntryDiscoveryResult(
  entryExportNamesByFile: Map<string, EntryExportName[]>,
  skipRuntimeImportFiles: Iterable<string> = []
): EntryDiscoveryResult {
  return {
    entryExportNamesByFile,
    entryFiles: [...entryExportNamesByFile.keys()].sort(),
    skipRuntimeImportFiles: [...new Set(skipRuntimeImportFiles)].sort(),
  }
}

export function discoverAllModeEntries(input: EntryDiscoveryInput): EntryDiscoveryResult {
  const context = resolveEntryDiscoveryContext(input)
  if (context.allModeEntries) {
    return context.allModeEntries
  }

  const entryExportNamesByFile = new Map<string, EntryExportName[]>()

  for (const filePath of context.appSourceFiles) {
    const spec = getFrameworkEntrySpec(filePath)
    if (!spec) {
      continue
    }

    addEntryFile(entryExportNamesByFile, filePath, spec.exportNames)
  }

  for (const spec of STANDALONE_ALL_MODE_ENTRY_SPECS) {
    const filePath = resolveStandaloneAllModeEntryFile(context.projectRoot, spec.relativePath)
    if (!filePath) {
      continue
    }

    const exportNames = resolveStandaloneAllModeEntryExportNames(filePath)
    if (exportNames.length === 0) {
      continue
    }

    addEntryFile(entryExportNamesByFile, filePath, exportNames)
  }

  addWidgetRegistryEntryRoots(context, entryExportNamesByFile, 'all')

  const result = toEntryDiscoveryResult(entryExportNamesByFile)
  context.allModeEntries = result
  return result
}

export function resolveOwningRoutePathForFile(
  input: EntryDiscoveryInput,
  filePath: string
): string | null {
  const context = resolveEntryDiscoveryContext(input)
  if (!isPathInsideDirectory(filePath, context.appRoot)) {
    return null
  }

  let directoryPath = path.dirname(filePath)
  while (isPathInsideDirectory(directoryPath, context.appRoot)) {
    const routePath = getRoutePathForAppDirectory(context, directoryPath)
    if (routePath && context.knownRoutePaths.has(routePath)) {
      return routePath
    }

    if (directoryPath === context.appRoot) {
      break
    }

    const parentDirectoryPath = path.dirname(directoryPath)
    if (parentDirectoryPath === directoryPath) {
      break
    }
    directoryPath = parentDirectoryPath
  }

  return null
}

export function resolveRouteEntries(
  input: EntryDiscoveryInput,
  routePath: string
): RouteResolution {
  const context = resolveEntryDiscoveryContext(input)
  const normalizedRoutePath = normalizeRoutePath(routePath)
  const { filePath: pageFilePath, routePath: matchedRoutePath } = findLocalizedPageFile(
    context,
    normalizedRoutePath
  )
  const cached = context.routeEntriesByRoute.get(matchedRoutePath)
  if (cached) {
    return cached
  }

  const localizedEntries = collectLocalizedRouteEntries(context.localeRoot, pageFilePath)
  const nonLocalizedEntries = collectNonLocalizedRouteBoundaryEntries(context, matchedRoutePath)

  const entryExportNamesByFile = new Map<string, EntryExportName[]>(localizedEntries)
  for (const [filePath, exportNames] of nonLocalizedEntries.entries()) {
    addEntryFile(entryExportNamesByFile, filePath, exportNames)
  }

  if (matchedRoutePath === DASHBOARD_ROUTE_PATH) {
    const widgetRuntimeImportSkips = addWidgetRegistryEntryRoots(context, entryExportNamesByFile, 'route')
    const result = {
      pageFilePath,
      routePath: matchedRoutePath,
      routeOwnedRoots: [
        path.dirname(pageFilePath),
        ...collectExactNonLocalizedRouteOwnedRoots(context, matchedRoutePath),
      ].sort(),
      ...toEntryDiscoveryResult(entryExportNamesByFile, widgetRuntimeImportSkips),
    }

    context.routeEntriesByRoute.set(matchedRoutePath, result)
    return result
  }

  const result = {
    pageFilePath,
    routePath: matchedRoutePath,
    routeOwnedRoots: [
      path.dirname(pageFilePath),
      ...collectExactNonLocalizedRouteOwnedRoots(context, matchedRoutePath),
    ].sort(),
    ...toEntryDiscoveryResult(entryExportNamesByFile),
  }

  context.routeEntriesByRoute.set(matchedRoutePath, result)
  return result
}
