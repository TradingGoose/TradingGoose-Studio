import fs from 'node:fs'
import path from 'node:path'
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

export type EntryExportName = 'default' | 'generateMetadata'

type FrameworkEntrySpec = {
  basename: FrameworkEntryBasename
  exportNames: EntryExportName[]
}

type EntryDiscoveryResult = {
  entryExportNamesByFile: Map<string, EntryExportName[]>
  entryFiles: string[]
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

const FRAMEWORK_ENTRY_SPECS: readonly FrameworkEntrySpec[] = [
  { basename: 'page', exportNames: ['default', 'generateMetadata'] },
  { basename: 'layout', exportNames: ['default', 'generateMetadata'] },
  { basename: 'template', exportNames: ['default'] },
  { basename: 'loading', exportNames: ['default'] },
  { basename: 'error', exportNames: ['default'] },
  { basename: 'global-error', exportNames: ['default'] },
  { basename: 'not-found', exportNames: ['default'] },
]

const FRAMEWORK_ENTRY_SPEC_BY_BASENAME = new Map(
  FRAMEWORK_ENTRY_SPECS.map((spec) => [spec.basename, spec])
)

const FRAMEWORK_ENTRY_BASENAMES = new Set<FrameworkEntryBasename>(
  FRAMEWORK_ENTRY_SPECS.map((spec) => spec.basename)
)

const ROUTE_SIBLING_ENTRY_BASENAMES = new Set<FrameworkEntryBasename>(
  FRAMEWORK_ENTRY_SPECS.map((spec) => spec.basename)
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

export function toRelativeProjectPath(projectRoot: string, filePath: string) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/')
}

export function walkProjectSourceFiles(projectRoot: string, startDirectory = projectRoot): string[] {
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
  entryExportNamesByFile.set(filePath, exportNames)
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
  const localeRoot = getLocalizedAppRoot(projectRoot)
  const appSourceFiles = walkProjectSourceFiles(projectRoot, appRoot)
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
    allModeEntries: null,
    appRoot,
    appSourceFiles,
    knownRoutePaths: new Set(pageFilePathByRoute.keys()),
    localizedPageFiles,
    localeRoot,
    pageFilePathByRoute,
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

function collectNonLocalizedRouteBoundaryEntries(context: EntryDiscoveryContext, routePath: string) {
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

function collectExactNonLocalizedRouteOwnedRoots(context: EntryDiscoveryContext, routePath: string) {
  const routeOwnedRoots = new Set<string>()

  for (const filePath of context.appSourceFiles) {
    if (isPathInsideDirectory(filePath, context.localeRoot)) {
      continue
    }

    let directoryPath = path.dirname(filePath)
    while (directoryPath !== context.appRoot && isPathInsideDirectory(directoryPath, context.appRoot)) {
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

function toEntryDiscoveryResult(entryExportNamesByFile: Map<string, EntryExportName[]>): EntryDiscoveryResult {
  return {
    entryExportNamesByFile,
    entryFiles: [...entryExportNamesByFile.keys()].sort(),
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

export function resolveRouteEntries(input: EntryDiscoveryInput, routePath: string): RouteResolution {
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
