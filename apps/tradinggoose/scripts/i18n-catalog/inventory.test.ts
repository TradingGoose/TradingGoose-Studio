import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import enMessages from '../../i18n/messages/en.json'
import { buildCatalogReport } from './catalog'
import {
  collectCanonicalRouteInventory,
  createEntryDiscoveryContext,
  DASHBOARD_ROUTE_PATH,
  discoverAllModeEntries,
  resolveRouteEntries,
  STANDALONE_ALL_MODE_ENTRY_SPECS,
  SUPPORTED_FRAMEWORK_ENTRY_BASENAMES,
} from './entries'
import {
  EXPLICIT_ROUTE_OWNERSHIP_RULES,
  findBestMatchingRoutePattern,
  getRouteOwnedNamespaces,
} from './ownership'
import { scanCatalogProject } from './scan'

const APP_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FRAMEWORK_ENTRY_BASENAME_CANDIDATES = new Set([
  ...SUPPORTED_FRAMEWORK_ENTRY_BASENAMES,
  'default',
])

type CatalogPathIndex = {
  leafPaths: Set<string>
  objectPaths: Set<string>
}

type RealAppDashboardFixture = {
  globalScanResult: ReturnType<typeof scanCatalogProject>
  report: ReturnType<typeof buildCatalogReport>
  routeScanResult: ReturnType<typeof scanCatalogProject>
}

function walkFiles(rootPath: string): string[] {
  const pending = [rootPath]
  const files: string[] = []

  while (pending.length > 0) {
    const currentPath = pending.pop()!
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }

      if (entry.isFile()) {
        files.push(entryPath)
      }
    }
  }

  return files.sort()
}

function buildCatalogPathIndex(
  value: unknown,
  pathParts: string[] = [],
  index: CatalogPathIndex = {
    leafPaths: new Set<string>(),
    objectPaths: new Set<string>(),
  }
): CatalogPathIndex {
  if (typeof value === 'string') {
    index.leafPaths.add(pathParts.join('.'))
    return index
  }

  if (!value || typeof value !== 'object') {
    return index
  }

  if (pathParts.length > 0) {
    index.objectPaths.add(pathParts.join('.'))
  }

  if (Array.isArray(value)) {
    value.forEach((entry, entryIndex) => {
      buildCatalogPathIndex(entry, [...pathParts, String(entryIndex)], index)
    })
    return index
  }

  Object.entries(value).forEach(([key, entry]) => {
    buildCatalogPathIndex(entry, [...pathParts, key], index)
  })
  return index
}

function hasCatalogPath(index: CatalogPathIndex, pathKey: string) {
  return index.leafPaths.has(pathKey) || index.objectPaths.has(pathKey)
}

function hasModifier(node: { modifiers?: ts.NodeArray<ts.ModifierLike> }, kind: ts.SyntaxKind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind))
}

function collectStandaloneRuntimeEntryExports(filePath: string) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const exportNames = new Set<string>()

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      if (/^get[A-Z].*Subject$/.test(node.name.text) || /^render[A-Z].*Email$/.test(node.name.text)) {
        exportNames.add(node.name.text)
      }
      return
    }

    if (ts.isVariableStatement(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue
        }

        if (
          /^get[A-Z].*Subject$/.test(declaration.name.text) ||
          /^render[A-Z].*Email$/.test(declaration.name.text)
        ) {
          exportNames.add(declaration.name.text)
        }
      }
    }
  })

  return [...exportNames].sort()
}

let realAppDashboardFixture: RealAppDashboardFixture | null = null

function getRealAppDashboardFixture(): RealAppDashboardFixture {
  if (realAppDashboardFixture) {
    return realAppDashboardFixture
  }

  const routeScanResult = scanCatalogProject({
    mode: 'route',
    projectRoot: APP_PROJECT_ROOT,
    routePath: DASHBOARD_ROUTE_PATH,
  })
  const globalScanResult = scanCatalogProject({
    mode: 'all',
    projectRoot: APP_PROJECT_ROOT,
  })
  const report = buildCatalogReport({
    includeOrphans: true,
    projectRoot: APP_PROJECT_ROOT,
    scanResult: routeScanResult,
    globalScanResult,
  })

  realAppDashboardFixture = {
    globalScanResult,
    report,
    routeScanResult,
  }

  return realAppDashboardFixture
}

describe('i18n catalog route inventory guardrails', () => {
  it('keeps the real localized route inventory canonical and resolvable', () => {
    const inventory = collectCanonicalRouteInventory(APP_PROJECT_ROOT)
    const context = createEntryDiscoveryContext(APP_PROJECT_ROOT)

    expect(new Set(inventory.routePaths).size).toBe(inventory.routePaths.length)
    expect(inventory.routePaths).toEqual([...inventory.routePaths].sort())

    for (const routePath of inventory.routePaths) {
      const resolved = resolveRouteEntries(context, routePath)
      expect(resolved.routePath).toBe(routePath)
      expect(resolved.pageFilePath).toBe(inventory.pageFilePathByRoute.get(routePath))
    }
  })

  it('does not add unsupported framework entry basenames under app/[locale] without scanner support', () => {
    const localeRoot = path.join(APP_PROJECT_ROOT, 'app', '[locale]')
    const unsupportedEntryFiles = walkFiles(localeRoot)
      .map((filePath) => ({
        basename: path.basename(filePath, path.extname(filePath)),
        relativePath: path.relative(APP_PROJECT_ROOT, filePath).split(path.sep).join('/'),
      }))
      .filter(({ basename }) => FRAMEWORK_ENTRY_BASENAME_CANDIDATES.has(basename))
      .filter(
        ({ basename }) =>
          !SUPPORTED_FRAMEWORK_ENTRY_BASENAMES.includes(
            basename as (typeof SUPPORTED_FRAMEWORK_ENTRY_BASENAMES)[number]
          )
      )
      .map(({ relativePath }) => relativePath)

    expect(unsupportedEntryFiles).toEqual([])
  })

  it('keeps standalone all-mode roots present and discoverable', () => {
    const context = createEntryDiscoveryContext(APP_PROJECT_ROOT)
    const allModeEntries = discoverAllModeEntries(context)
    const allModeRelativeEntryFiles = allModeEntries.entryFiles.map((filePath) =>
      path.relative(APP_PROJECT_ROOT, filePath).split(path.sep).join('/')
    )

    for (const spec of STANDALONE_ALL_MODE_ENTRY_SPECS) {
      const absolutePath = path.join(APP_PROJECT_ROOT, spec.relativePath)
      const expectedExportNames = collectStandaloneRuntimeEntryExports(absolutePath)
      expect(fs.existsSync(absolutePath)).toBe(true)
      expect(fs.statSync(absolutePath).isFile()).toBe(true)
      expect(allModeRelativeEntryFiles).toContain(spec.relativePath)
      expect(expectedExportNames).not.toContain('renderOrphanPreview')
      expect(allModeEntries.entryExportNamesByFile.get(absolutePath)).toEqual(expectedExportNames)
    }
  })

  it(
    'keeps dashboard widget selector and quick-order header copy covered in the real app scan',
    () => {
      const { report } = getRealAppDashboardFixture()
      const usedHeaderKey = report.usedKeys.find((pathKey) =>
        pathKey.startsWith('workspace.widgets.quickOrder.header.')
      )

      if (!usedHeaderKey) {
        throw new Error('Expected at least one quick-order header key to be marked as used')
      }

      expect(report.usedKeys).toEqual(
        expect.arrayContaining([
          'workspace.widgets.customToolList.createMenu.create',
          'workspace.widgets.mcpEditor.selectServer',
          'workspace.widgets.selector.selectWidget',
          'workspace.widgets.selector.widgetSelectionUnavailable',
          usedHeaderKey,
        ])
      )
      expect(report.usedKeys).not.toContain('workspace.widgets.quickOrder.body.submitOrder')
      expect(report.missingKeys).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pathKey: 'workspace.widgets.workflowLabels.pages.toLowerCase',
          }),
          expect.objectContaining({
            pathKey: 'workspace.widgets.workflowLabels.issues.toLowerCase',
          }),
        ])
      )
      expect(report.orphanedKeys).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pathKey: 'workspace.widgets.customToolList.createMenu.create' }),
          expect.objectContaining({ pathKey: 'workspace.widgets.mcpEditor.selectServer' }),
          expect.objectContaining({ pathKey: 'workspace.widgets.selector.selectWidget' }),
          expect.objectContaining({
            pathKey: 'workspace.widgets.selector.widgetSelectionUnavailable',
          }),
          expect.objectContaining({ pathKey: usedHeaderKey }),
          expect.objectContaining({ pathKey: 'workspace.dashboard.pages.logs' }),
        ])
      )
    },
    60000
  )

  it('keeps dashboard route scans materially narrower than all-mode widget coverage', () => {
    const { routeScanResult, globalScanResult } = getRealAppDashboardFixture()

    expect(routeScanResult.scannedFiles).not.toContain(
      'widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/file-selector/components/confluence-file-selector.tsx'
    )
    expect(routeScanResult.scannedFiles).not.toContain(
      'widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/file-selector/components/jira-issue-selector.tsx'
    )
    expect(globalScanResult.scannedFiles).toEqual(
      expect.arrayContaining([
        'widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/file-selector/components/confluence-file-selector.tsx',
        'widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/file-selector/components/jira-issue-selector.tsx',
      ])
    )
    expect(routeScanResult.scannedFiles.length).toBeLessThan(globalScanResult.scannedFiles.length)
    expect(routeScanResult.scannedFiles.length / globalScanResult.scannedFiles.length).toBeLessThan(
      0.8
    )
  })
})

describe('i18n catalog ownership guardrails', () => {
  it('keeps explicit ownership patterns unique and matched to current routes', () => {
    const inventory = collectCanonicalRouteInventory(APP_PROJECT_ROOT)
    const patterns = EXPLICIT_ROUTE_OWNERSHIP_RULES.map((rule) => rule.pattern)
    const duplicatePatterns = patterns.filter(
      (pattern, index) => patterns.indexOf(pattern) !== index
    )
    const duplicateNamespacePatterns = EXPLICIT_ROUTE_OWNERSHIP_RULES.filter(
      (rule) => new Set(rule.namespaces).size !== rule.namespaces.length
    ).map((rule) => rule.pattern)
    const unmatchedPatterns = patterns.filter(
      (pattern) =>
        !inventory.routePaths.some(
          (routePath) => findBestMatchingRoutePattern(routePath, [pattern]) === pattern
        )
    )

    expect(duplicatePatterns).toEqual([])
    expect(duplicateNamespacePatterns).toEqual([])
    expect(unmatchedPatterns).toEqual([])
  })

  it('keeps canonical routes backed by locale namespaces through explicit ownership or fallback derivation', () => {
    const inventory = collectCanonicalRouteInventory(APP_PROJECT_ROOT)
    const catalogPaths = buildCatalogPathIndex(enMessages)
    const missingNamespaces = inventory.routePaths.flatMap((routePath) =>
      getRouteOwnedNamespaces(routePath)
        .filter((namespace) => !hasCatalogPath(catalogPaths, namespace))
        .map((namespace) => `${routePath} -> ${namespace}`)
    )

    expect(missingNamespaces).toEqual([])
  })
})
