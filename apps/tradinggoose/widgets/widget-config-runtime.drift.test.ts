import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'
import { getWidgetContract, isWidgetKey, WIDGET_KEYS } from '@/widgets/widget-contracts'

const APP_ROOT = existsSync(join(process.cwd(), 'apps/tradinggoose'))
  ? join(process.cwd(), 'apps/tradinggoose')
  : process.cwd()
const PRODUCTION_DIRS = ['app', 'lib', 'stores', 'widgets']

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      collectSourceFiles(path, files)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) files.push(path)
  }
  return files
}

const readSource = (path: string) => readFileSync(join(APP_ROOT, path), 'utf8')

/** Relative paths of production source files whose contents match the predicate. */
const findProductionOffenders = (predicate: (source: string) => boolean) =>
  PRODUCTION_DIRS.flatMap((dir) => collectSourceFiles(join(APP_ROOT, dir)))
    .filter((file) => predicate(readFileSync(file, 'utf8')))
    .map((file) => relative(APP_ROOT, file))

describe('widget config runtime drift guards', () => {
  it('keeps production code off the legacy dashboard pair-store import path', () => {
    const offenders = findProductionOffenders((source) =>
      source.includes('@/stores/dashboard/pair-store')
    )

    expect(offenders).toEqual([])
  })

  it('keeps workflow registry decoupled from pair-store subscriptions', () => {
    const source = readSource('stores/workflows/registry/store.ts')

    expect(source).not.toContain('@/stores/dashboard/pair-store')
    expect(source).not.toContain('usePairColorStore.getState')
    expect(source).not.toContain('usePairColorStore.subscribe')
  })

  it('does not keep legacy selection or heatmap/watchlist browser persistence adapters', () => {
    const removedAdapterPaths = [
      'selection-persistence-factory',
      'workflow-selection',
      'indicator-selection',
      'mcp-selection',
      'custom-tool-selection',
      'skill-selection',
      'watchlist-selection',
      'heatmap-params',
    ].map((name) => `widgets/utils/${name}.ts`)

    const existingAdapters = removedAdapterPaths.filter((path) => existsSync(join(APP_ROOT, path)))

    expect(existingAdapters).toEqual([])
  })

  it('keeps production widgets off legacy pair-context write and selection-event APIs', () => {
    const staleTokens = `useSetWidgetPairColorContext setPairContext( createSelectionPersistenceHook
      emitWorkflowSelectionChange emitIndicatorSelectionChange emitMcpSelectionChange
      emitCustomToolSelectionChange emitSkillSelectionChange emitWatchlistSelectionChange
      useWorkflowSelectionPersistence useIndicatorSelectionPersistence useMcpSelectionPersistence
      useCustomToolSelectionPersistence useSkillSelectionPersistence useWatchlistSelectionPersistence
      WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT HEATMAP_WIDGET_UPDATE_PARAMS_EVENT
      WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT INDICATOR_WIDGET_SELECT_EVENT
      MCP_WIDGET_SELECT_SERVER_EVENT CUSTOM_TOOL_WIDGET_SELECT_EVENT
      SKILL_WIDGET_SELECT_EVENT WATCHLIST_WIDGET_SELECT_EVENT`.split(/\s+/)

    const offenders = findProductionOffenders((source) =>
      staleTokens.some((token) => source.includes(token))
    )

    expect(offenders).toEqual([])
  })

  it('keeps list_widgets category-only without query aliases', () => {
    const registrySource = readSource('lib/copilot/registry.ts')
    const sharedSource = readSource('lib/copilot/tools/server/widgets/list-widgets.ts')
    const argsStart = registrySource.indexOf('const ListWidgetsArgs')
    const argsEnd = registrySource.indexOf('const EditWorkflowVariableArgs', argsStart)
    const listWidgetArgsSource =
      argsStart >= 0 && argsEnd > argsStart ? registrySource.slice(argsStart, argsEnd) : ''

    expect(listWidgetArgsSource).toContain('category:')
    expect(registrySource).toContain("'list_widgets'")
    expect(registrySource).not.toContain("'list_widget'")
    expect(listWidgetArgsSource).not.toContain('query')
    expect(listWidgetArgsSource).not.toContain('qeury')
    expect(sharedSource).toContain('category?:')
    expect(sharedSource).not.toContain('query')
    expect(sharedSource).not.toContain('qeury')
  })

  it('keeps React widget definitions anchored to canonical widget contracts', () => {
    const widgetIndexFiles = collectSourceFiles(join(APP_ROOT, 'widgets/widgets')).filter(
      (file) => file.endsWith('/index.tsx') && !file.endsWith('/empty/index.tsx')
    )
    const offenders = widgetIndexFiles
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        if (!source.includes('DashboardWidgetDefinition')) return false
        return !/^ {2}contract:/m.test(source) || /^ {2}(title|category|description):/m.test(source)
      })
      .map((file) => relative(APP_ROOT, file))

    expect(offenders).toEqual([])
  })

  it('keeps widget contracts owned by their widget directories', () => {
    const widgetRoot = join(APP_ROOT, 'widgets/widgets')
    const persistedWidgetDirs = readdirSync(widgetRoot)
      .filter((entry) => !['_shared', 'components', 'empty'].includes(entry))
      .filter((entry) => statSync(join(widgetRoot, entry)).isDirectory())
    const missingContractFiles = persistedWidgetDirs
      .filter((entry) => !existsSync(join(widgetRoot, entry, 'contract.ts')))
      .map((entry) => `widgets/widgets/${entry}/contract.ts`)
    const unregisteredWidgetDirs = persistedWidgetDirs
      .filter((entry) => !isWidgetKey(entry))
      .map((entry) => `widgets/widgets/${entry}`)
    const missingWidgetDirs = WIDGET_KEYS.filter((key) => !existsSync(join(widgetRoot, key))).map(
      (key) => `widgets/widgets/${key}`
    )
    const mismatchedContractKeys = persistedWidgetDirs
      .filter(isWidgetKey)
      .filter((entry) => getWidgetContract(entry).key !== entry)
      .map((entry) => `widgets/widgets/${entry}/contract.ts`)

    expect(existsSync(join(APP_ROOT, 'widgets/contracts'))).toBe(false)
    expect(missingContractFiles).toEqual([])
    expect(unregisteredWidgetDirs).toEqual([])
    expect(missingWidgetDirs).toEqual([])
    expect(mismatchedContractKeys).toEqual([])
  })

  it('keeps persisted widget param types owned by pure widget contracts', () => {
    const staleTypePaths = ['quick_order', 'heatmap', 'portfolio_snapshot', 'watchlist'].map(
      (widgetKey) => `@/widgets/widgets/${widgetKey}/types`
    )
    const persistedDataChartTypes = [
      'DataChartCandleType',
      'DataChartViewParams',
      'DataChartWidgetParams',
      'DrawToolsRef',
      'IndicatorRef',
    ]
    const offenders = findProductionOffenders((source) => {
      if (staleTypePaths.some((path) => source.includes(path))) return true
      if (source.includes('dataChartWidgetParams')) return true

      const dataChartTypeImports = source.matchAll(
        /import type \{([^{}]+)\} from '@\/widgets\/widgets\/data_chart\/types'/g
      )
      return Array.from(dataChartTypeImports).some((match) =>
        persistedDataChartTypes.some((typeName) => match[1]?.includes(typeName))
      )
    })

    expect(offenders).toEqual([])
  })
})
