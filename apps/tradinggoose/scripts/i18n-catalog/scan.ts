import path from 'node:path'
import {
  DASHBOARD_ROUTE_PATH,
  discoverAllModeEntries,
  resolveOwningRoutePathForFile,
  resolveRouteEntries,
  toRelativeProjectPath,
  WIDGET_REGISTRY_RELATIVE_PATH,
} from './entries'
import { getRouteOwnedNamespaces } from './ownership'
import type { CatalogProjectContext, CatalogScanResult, ScanContext } from './scan/core/types'
import { createCatalogProjectContext } from './scan/graph/context'
import { buildAnalysisProjectFiles, collectReachableFiles } from './scan/graph/reachability'
import { dedupeHardcodedCandidates } from './scan/runtime/candidates'
import { scanFile } from './scan/runtime/walker'
import { getFileAnalysis } from './scan/semantics/analysis-cache'
import { buildGlobalFunctionSemantics } from './scan/semantics/function-semantics'
import { populateProjectFileTypeRoots } from './scan/semantics/type-roots'

export type {
  CatalogProjectContext,
  CatalogScanResult,
  CoverageRecord,
  HardcodedCandidate,
  ScanMode,
} from './scan/core/types'
export { createCatalogProjectContext } from './scan/graph/context'

type ContextScanOptions = { mode: 'all' } | { mode: 'route'; routePath: string }

type ScanOptions =
  | ({ mode: 'all' } & { projectRoot: string })
  | { mode: 'route'; projectRoot: string; routePath: string }

export function scanCatalogProjectWithContext(
  context: CatalogProjectContext,
  options: ContextScanOptions
): CatalogScanResult {
  let routeResolution: ReturnType<typeof resolveRouteEntries> | null = null
  const entryDiscovery =
    options.mode === 'route'
      ? ((routeResolution = resolveRouteEntries(
          context.entryDiscoveryContext,
          options.routePath
        )) as ReturnType<typeof resolveRouteEntries>)
      : discoverAllModeEntries(context.entryDiscoveryContext)

  const routePath = routeResolution?.routePath ?? null
  const skipRuntimeImportsFrom = new Set(entryDiscovery.skipRuntimeImportFiles)
  if (routePath === DASHBOARD_ROUTE_PATH) {
    skipRuntimeImportsFrom.add(path.join(context.projectRoot, WIDGET_REGISTRY_RELATIVE_PATH))
  }
  const selectedFiles = collectReachableFiles(entryDiscovery.entryFiles, context, {
    skipRuntimeImportsFrom: skipRuntimeImportsFrom.size > 0 ? skipRuntimeImportsFrom : undefined,
  })
  const analysisProjectFiles = buildAnalysisProjectFiles(context, selectedFiles)
  populateProjectFileTypeRoots(analysisProjectFiles)
  const semanticsByFile = buildGlobalFunctionSemantics(analysisProjectFiles)

  const ownedNamespaces = routePath ? getRouteOwnedNamespaces(routePath) : []
  const scanContext: ScanContext = {
    analysisByFile: new Map(),
    entryDiscoveryContext: context.entryDiscoveryContext,
    projectRoot: context.projectRoot,
    projectFiles: analysisProjectFiles,
    semanticsByFile,
    routePath,
    invocationCache: new Set(),
  }
  const coverage: CatalogScanResult['coverage'] = []
  const hardcodedCandidates: CatalogScanResult['hardcodedCandidates'] = []

  for (const filePath of selectedFiles) {
    const projectFile = analysisProjectFiles.get(filePath)
    if (!projectFile) {
      continue
    }

    const entryExportNames = entryDiscovery.entryExportNamesByFile.get(filePath) ?? []
    const entryActiveRoutePath =
      routePath ?? resolveOwningRoutePathForFile(context.entryDiscoveryContext, filePath)
    const entryInvocations = entryExportNames.map((exportName) => ({
      exportName,
      activeRoutePath: entryActiveRoutePath,
    }))
    const rootScanRoutePaths =
      routePath !== null
        ? [routePath]
        : entryInvocations.length > 0
          ? entryInvocations.map((entryInvocation) => entryInvocation.activeRoutePath)
          : [null]

    const scanResult = scanFile(getFileAnalysis(projectFile, scanContext), scanContext, {
      entryInvocations,
      rootScanRoutePaths,
    })
    coverage.push(...scanResult.coverage)
    hardcodedCandidates.push(...scanResult.hardcodedCandidates)
  }

  return {
    mode: options.mode,
    routePath,
    ownedNamespaces,
    scannedFiles: selectedFiles.map((filePath) =>
      toRelativeProjectPath(context.projectRoot, filePath)
    ),
    coverage,
    hardcodedCandidates: dedupeHardcodedCandidates(hardcodedCandidates),
  }
}

export function scanCatalogProject(options: ScanOptions): CatalogScanResult {
  const context = createCatalogProjectContext(options.projectRoot)
  return scanCatalogProjectWithContext(
    context,
    options.mode === 'route' ? { mode: 'route', routePath: options.routePath } : { mode: 'all' }
  )
}
