import fs from 'node:fs'
import path from 'node:path'
import { type AppLocale, defaultLocale, locales } from '../../i18n/routing'
import { toRelativeProjectPath } from './entries'
import type { CatalogScanResult, CoverageRecord, HardcodedCandidate } from './scan'

type JsonPrimitive = boolean | number | string | null
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

type LocaleCode = AppLocale
type TargetLocaleCode = Exclude<LocaleCode, typeof defaultLocale>

type LocaleCatalogs = Record<LocaleCode, JsonObject>

type CatalogIndex = {
  leafMap: Map<string, string>
  objectPaths: Set<string>
  leafPathsByRoot: Map<string, string[]>
}

export type MissingKey = {
  filePath: string
  line: number
  column: number
  pathKey: string
}

export type TargetLocaleGap = {
  locale: TargetLocaleCode
  pathKey: string
}

export type OrphanedKey = {
  pathKey: string
}

export type HardcodedCandidateReport = {
  filePath: string
  line: number
  column: number
  text: string
  kind: HardcodedCandidate['kind']
  namespace: string
  namespaceSource: HardcodedCandidate['namespaceSource']
  attributeName?: string
  metadata: boolean
  existingPathKey?: string
  suggestedPathKey: string
}

export type CatalogReport = {
  routePath: string | null
  scannedFiles: string[]
  usedKeys: string[]
  missingKeys: MissingKey[]
  orphanedKeys?: OrphanedKey[]
  dynamicProtectedRoots?: string[]
  targetLocaleGaps: TargetLocaleGap[]
  hardcodedCandidates: HardcodedCandidateReport[]
}

type BuildReportOptions = {
  projectRoot: string
  scanResult: CatalogScanResult
  globalScanResult?: CatalogScanResult
}

function getCatalogFilePath(projectRoot: string, locale: LocaleCode) {
  return path.join(projectRoot, 'i18n', 'messages', `${locale}.json`)
}

function loadLocaleCatalogs(projectRoot: string): LocaleCatalogs {
  return Object.fromEntries(
    locales.map((locale) => [
      locale,
      JSON.parse(fs.readFileSync(getCatalogFilePath(projectRoot, locale), 'utf8')) as JsonObject,
    ])
  ) as LocaleCatalogs
}

function buildCatalogIndex(catalog: JsonObject): CatalogIndex {
  const leafMap = new Map<string, string>()
  const objectPaths = new Set<string>()
  const leafPathsByRoot = new Map<string, string[]>()

  const visit = (value: JsonValue, pathParts: string[]) => {
    if (typeof value === 'string') {
      const pathKey = pathParts.join('.')
      leafMap.set(pathKey, value)
      for (let index = 1; index < pathParts.length; index += 1) {
        const rootPathKey = pathParts.slice(0, index).join('.')
        const rootLeafPaths = leafPathsByRoot.get(rootPathKey) ?? []
        rootLeafPaths.push(pathKey)
        leafPathsByRoot.set(rootPathKey, rootLeafPaths)
      }
      return
    }

    if (!value || typeof value !== 'object') {
      return
    }

    if (Array.isArray(value)) {
      if (pathParts.length > 0) {
        objectPaths.add(pathParts.join('.'))
      }

      for (const [index, child] of value.entries()) {
        visit(child, [...pathParts, String(index)])
      }
      return
    }

    if (pathParts.length > 0) {
      objectPaths.add(pathParts.join('.'))
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, [...pathParts, key])
    }
  }

  visit(catalog, [])
  return { leafMap, objectPaths, leafPathsByRoot }
}

type CoverageSummary = {
  dynamicRootPaths: string[]
  missingKeys: MissingKey[]
  usedKeys: string[]
}

function buildCoverageSummary(
  coverage: CoverageRecord[],
  catalogIndex: CatalogIndex
): CoverageSummary {
  const usedKeys = new Set<string>()
  const missingKeysByPath = new Map<string, MissingKey>()
  const dynamicRootPaths = new Set<string>()

  const addSubtreeLeafUsage = (pathKey: string) => {
    if (catalogIndex.leafMap.has(pathKey)) {
      usedKeys.add(pathKey)
      return true
    }

    const leafPaths = catalogIndex.leafPathsByRoot.get(pathKey)
    if (!leafPaths) {
      return false
    }

    for (const leafPath of leafPaths) {
      usedKeys.add(leafPath)
    }

    return true
  }

  for (const record of coverage) {
    if (record.mode === 'subtree' && record.subtreeReason === 'dynamic-root') {
      dynamicRootPaths.add(record.pathKey)
    }

    if (record.mode === 'subtree') {
      if (addSubtreeLeafUsage(record.pathKey)) {
        continue
      }

      if (catalogIndex.objectPaths.has(record.pathKey)) {
        continue
      }
    } else if (catalogIndex.leafMap.has(record.pathKey)) {
      usedKeys.add(record.pathKey)
      continue
    } else if (catalogIndex.objectPaths.has(record.pathKey)) {
      continue
    }

    if (!missingKeysByPath.has(record.pathKey)) {
      missingKeysByPath.set(record.pathKey, {
        filePath: record.filePath,
        line: record.line,
        column: record.column,
        pathKey: record.pathKey,
      })
    }
  }

  return {
    dynamicRootPaths: [...dynamicRootPaths].sort(),
    usedKeys: [...usedKeys].sort(),
    missingKeys: [...missingKeysByPath.values()].sort((left, right) =>
      left.pathKey.localeCompare(right.pathKey)
    ),
  }
}

function isOwnedPath(pathKey: string, ownedNamespaces: string[]) {
  if (ownedNamespaces.length === 0) {
    return true
  }

  return ownedNamespaces.some(
    (namespace) => pathKey === namespace || pathKey.startsWith(`${namespace}.`)
  )
}

function buildTargetLocaleGaps(usedKeys: string[], catalogs: LocaleCatalogs) {
  const gaps: TargetLocaleGap[] = []
  const targetLocales = locales.filter(
    (locale): locale is TargetLocaleCode => locale !== defaultLocale
  )
  const localeIndexes = Object.fromEntries(
    targetLocales.map((locale) => [locale, buildCatalogIndex(catalogs[locale])])
  ) as Record<TargetLocaleCode, CatalogIndex>

  for (const locale of targetLocales) {
    for (const pathKey of usedKeys) {
      if (!localeIndexes[locale].leafMap.has(pathKey)) {
        gaps.push({ locale, pathKey })
      }
    }
  }

  return gaps.sort((left, right) =>
    left.locale === right.locale
      ? left.pathKey.localeCompare(right.pathKey)
      : left.locale.localeCompare(right.locale)
  )
}

function normalizeCatalogText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function buildCatalogValueIndex(catalogIndex: CatalogIndex, ownedNamespaces: string[]) {
  const valueIndex = new Map<string, string[]>()

  for (const [pathKey, value] of catalogIndex.leafMap.entries()) {
    if (!isOwnedPath(pathKey, ownedNamespaces)) {
      continue
    }

    const normalizedValue = normalizeCatalogText(value)
    const pathKeys = valueIndex.get(normalizedValue) ?? []
    pathKeys.push(pathKey)
    valueIndex.set(normalizedValue, pathKeys)
  }

  return valueIndex
}

function findExistingPathKey(candidate: HardcodedCandidate, valueIndex: Map<string, string[]>) {
  const matches = valueIndex.get(normalizeCatalogText(candidate.text)) ?? []
  const namespaceMatches = matches.filter(
    (pathKey) => pathKey === candidate.namespace || pathKey.startsWith(`${candidate.namespace}.`)
  )

  if (namespaceMatches.length === 1) {
    return namespaceMatches[0]
  }

  return matches.length === 1 ? matches[0] : undefined
}

function toSuggestedPathKey(candidate: HardcodedCandidate) {
  const suffix = candidate.relativeKeyParts.join('.')
  return suffix ? `${candidate.namespace}.${suffix}` : candidate.namespace
}

export function buildCatalogReport(options: BuildReportOptions): CatalogReport {
  const catalogs = loadLocaleCatalogs(options.projectRoot)
  const englishCatalogIndex = buildCatalogIndex(catalogs[defaultLocale])
  const hasGlobalScan = Boolean(options.globalScanResult)

  const globalCoverageSummary = options.globalScanResult
    ? buildCoverageSummary(options.globalScanResult.coverage, englishCatalogIndex)
    : null
  const routeCoverageSummary =
    options.scanResult.mode === 'all'
      ? (globalCoverageSummary ??
        buildCoverageSummary(options.scanResult.coverage, englishCatalogIndex))
      : buildCoverageSummary(options.scanResult.coverage, englishCatalogIndex)

  const ownedNamespaces =
    options.scanResult.mode === 'route' ? options.scanResult.ownedNamespaces : []
  const catalogValueIndex = buildCatalogValueIndex(englishCatalogIndex, ownedNamespaces)
  const usedKeySet = globalCoverageSummary ? new Set(globalCoverageSummary.usedKeys) : null
  const orphanedKeys = hasGlobalScan
    ? [...englishCatalogIndex.leafMap.keys()]
        .filter((pathKey) => !usedKeySet!.has(pathKey))
        .filter((pathKey) => isOwnedPath(pathKey, ownedNamespaces))
        .sort()
    : null

  const dynamicProtectedRoots = hasGlobalScan
    ? globalCoverageSummary!.dynamicRootPaths
        .filter((pathKey) => isOwnedPath(pathKey, ownedNamespaces))
        .sort()
    : null

  const report: CatalogReport = {
    routePath: options.scanResult.routePath,
    scannedFiles: options.scanResult.scannedFiles,
    usedKeys: routeCoverageSummary.usedKeys,
    missingKeys: routeCoverageSummary.missingKeys.map((entry) => ({
      ...entry,
      filePath: toRelativeProjectPath(options.projectRoot, entry.filePath),
    })),
    targetLocaleGaps: buildTargetLocaleGaps(routeCoverageSummary.usedKeys, catalogs),
    hardcodedCandidates: [...options.scanResult.hardcodedCandidates]
      .sort((left, right) => {
        if (left.filePath !== right.filePath) {
          return left.filePath.localeCompare(right.filePath)
        }
        if (left.line !== right.line) {
          return left.line - right.line
        }
        return left.column - right.column
      })
      .map((candidate) => ({
        filePath: toRelativeProjectPath(options.projectRoot, candidate.filePath),
        line: candidate.line,
        column: candidate.column,
        text: candidate.text,
        kind: candidate.kind,
        namespace: candidate.namespace,
        namespaceSource: candidate.namespaceSource,
        attributeName: candidate.attributeName,
        metadata: candidate.metadata,
        existingPathKey: findExistingPathKey(candidate, catalogValueIndex),
        suggestedPathKey: toSuggestedPathKey(candidate),
      })),
  }

  if (hasGlobalScan) {
    report.orphanedKeys = orphanedKeys!.map((pathKey) => ({ pathKey }))
    report.dynamicProtectedRoots = dynamicProtectedRoots!
  }

  return report
}
