import { parseArgs } from 'node:util'
import { buildCatalogReport, type CatalogReport } from './catalog'
import {
  type CatalogScanResult,
  createCatalogProjectContext,
  scanCatalogProjectWithContext,
} from './scan'

export type CliFlags = {
  route?: string
  all?: boolean
  json?: boolean
  showUsedKeys?: boolean
  withOrphans?: boolean
}

export type CatalogCliResult = {
  scan: {
    mode: CatalogScanResult['mode']
    routePath: CatalogScanResult['routePath']
  }
  report: CatalogReport
  text: string
}

export function parseCliFlags(argv = process.argv.slice(2)): CliFlags {
  const { values } = parseArgs({
    args: argv,
    options: {
      route: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'show-used-keys': { type: 'boolean', default: false },
      'with-orphans': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })

  return {
    route: values.route,
    all: values.all,
    json: values.json,
    showUsedKeys: values['show-used-keys'],
    withOrphans: values['with-orphans'],
  }
}

function formatList(title: string, entries: string[]) {
  if (entries.length === 0) {
    return `${title}: 0`
  }

  return `${title}: ${entries.length}\n${entries.map((entry) => `  - ${entry}`).join('\n')}`
}

function formatCount(title: string, count: number) {
  return `${title}: ${count}`
}

export function formatCatalogCliText(
  scanResult: CatalogScanResult,
  report: CatalogReport,
  options?: { showUsedKeys?: boolean }
) {
  const sections = [
    `Mode: ${scanResult.mode}${scanResult.routePath ? ` (${scanResult.routePath})` : ''}`,
    `Scanned files: ${report.scannedFiles.length}`,
    options?.showUsedKeys
      ? formatList('Used keys', report.usedKeys)
      : formatCount('Used keys', report.usedKeys.length),
    formatList(
      'Missing keys',
      report.missingKeys.map((entry) => entry.pathKey)
    ),
    formatList(
      'Target locale gaps',
      report.targetLocaleGaps.map((entry) => `${entry.locale}: ${entry.pathKey}`)
    ),
    formatList(
      'Hardcoded candidates',
      report.hardcodedCandidates.map(
        (entry) =>
          `${entry.filePath}:${entry.line}:${entry.column} ${
            entry.existingPathKey ? `${entry.existingPathKey} (existing)` : entry.suggestedPathKey
          } -> ${JSON.stringify(entry.text)}`
      )
    ),
  ]

  if (report.orphanedKeys) {
    sections.splice(
      4,
      0,
      formatList(
        'Orphaned keys',
        report.orphanedKeys.map((entry) => entry.pathKey)
      )
    )
  }
  if (report.dynamicProtectedRoots) {
    const insertionIndex = report.orphanedKeys ? 5 : 4
    sections.splice(
      insertionIndex,
      0,
      formatList('Dynamic protected roots', report.dynamicProtectedRoots)
    )
  }

  return sections.join('\n\n')
}

export function runCatalogCli(projectRoot: string, flags: CliFlags): CatalogCliResult {
  if ((!flags.route && !flags.all) || (flags.route && flags.all)) {
    throw new Error('Pass exactly one of --route <pathname> or --all')
  }

  const context = createCatalogProjectContext(projectRoot)
  const scanResult = flags.all
    ? scanCatalogProjectWithContext(context, { mode: 'all' })
    : scanCatalogProjectWithContext(context, { mode: 'route', routePath: flags.route! })
  const includeOrphans = Boolean(flags.withOrphans)
  const globalScanResult =
    includeOrphans
      ? scanResult.mode === 'all'
        ? scanResult
        : scanCatalogProjectWithContext(context, { mode: 'all' })
      : undefined
  const report = buildCatalogReport({
    includeOrphans,
    projectRoot,
    scanResult,
    globalScanResult,
  })

  return {
    scan: {
      mode: scanResult.mode,
      routePath: scanResult.routePath,
    },
    report,
    text: formatCatalogCliText(scanResult, report, {
      showUsedKeys: flags.showUsedKeys,
    }),
  }
}

async function main() {
  const flags = parseCliFlags()
  const result = runCatalogCli(process.cwd(), flags)

  if (flags.json) {
    console.log(JSON.stringify({ scan: result.scan, report: result.report }, null, 2))
    return
  }

  console.log(result.text)
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}
