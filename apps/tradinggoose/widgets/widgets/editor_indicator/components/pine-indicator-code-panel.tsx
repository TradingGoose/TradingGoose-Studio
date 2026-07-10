'use client'

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import {
  buildMonacoIndicatorDiagnosticSource,
  type MonacoEditorHandle,
} from '@/components/monaco-editor'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { Notice } from '@/components/ui/notice'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { executeBrowserPineIndicator } from '@/lib/indicators/browser-execution'
import { exportIndicatorsAsJson } from '@/lib/indicators/import-export'
import { buildInputsMapFromMeta, inferInputMetaFromPineCode } from '@/lib/indicators/input-meta'
import { PINE_CHEAT_SHEET_EXTRA_LIBS } from '@/lib/indicators/pine-cheat-sheet'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import { detectTriggerUsage } from '@/lib/indicators/trigger-detection'
import { detectUnsupportedFeatures } from '@/lib/indicators/unsupported'
import { generateMockMarketSeries } from '@/lib/market/mock-series'
import { useYjsStringField } from '@/lib/yjs/use-entity-fields'
import { useWand } from '@/hooks/workflow/use-wand'
import {
  CHEAT_SHEET_GROUPS,
  type CheatSheetGroup,
} from '@/widgets/widgets/editor_indicator/components/pine-cheat-sheet'
import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { CodeEditor } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor'

type IndicatorCodePanelProps = {
  indicatorId: string
  indicatorName: string
  workspaceId: string
  doc: Y.Doc | null
  save: () => Promise<void>
  exportRef: MutableRefObject<() => void>
  saveRef: MutableRefObject<() => void>
  verifyRef: MutableRefObject<() => void>
}

const PINE_WAND_PROMPT = `# Role
You are an expert PineTS developer writing Pine Script-style indicators in TypeScript.

# Runtime
- The script runs inside: async ($) => { ... }.
- Use globals directly (no $.pine/$.data). Example:
  const length = input.int(14, 'Length');
  const sma = ta.sma(close, length);
  plot(sma, 'SMA');
- Do NOT return { plots, triggers }. PineTS uses plot calls.
- No imports, exports, require, or fetch.
- Do not read future bars; assume bar-close data only.

# Output
- Use plot/plotshape/plotarrow/plotchar to emit visuals.
- Use input.* to define user-configurable inputs directly in the script.
- Do NOT reference $.pine or $.data.

# Robustness
- Guard against NaN/Infinity and divide-by-zero.
- Prefer edge-triggered logic to avoid repeated markers.

Current script code: {context}

Rules:
1) Output raw TypeScript only.
2) Do NOT include a function wrapper or signature.`

const VERIFY_MAX_BARS = 500
const VERIFY_INTERVAL = '1d'
const VERIFY_INTERVAL_MS = 86_400_000

const hasAnyNumericValue = (values: Array<number | null>) =>
  values.some((value) => typeof value === 'number' && Number.isFinite(value))

const verifyIndicatorInBrowser = async ({
  pineCode,
  inputsMap,
}: {
  pineCode: string
  inputsMap: Record<string, unknown>
}) => {
  if (pineCode.trim().length === 0) {
    throw new Error('Indicator code is required.')
  }

  const unsupportedFeatures = detectUnsupportedFeatures(pineCode)
  if (unsupportedFeatures.length > 0) {
    throw new Error(`${unsupportedFeatures[0]} is not supported`)
  }

  const triggerUsageDetected = detectTriggerUsage(pineCode)
  const inferredInputMeta = inferInputMetaFromPineCode(pineCode)
  const series = generateMockMarketSeries()
  const barsMs = mapMarketSeriesToBarsMs(series, VERIFY_INTERVAL_MS).slice(0, VERIFY_MAX_BARS)
  const { output, warnings } = await executeBrowserPineIndicator({
    barsMs,
    pineCode,
    inputsMap,
    inputMeta: inferredInputMeta,
    symbol: 'SIM:GOOSE',
    interval: VERIFY_INTERVAL,
  })
  const plotsCount = output.series.length
  const markersCount = output.markers.length
  const triggersCount = output.triggers.length

  if (plotsCount === 0 && markersCount === 0 && triggersCount === 0 && !triggerUsageDetected) {
    throw new Error('No plots or markers returned. Did you forget to plot?')
  }

  const warningMessages = warnings
    .map((warning) => warning.message)
    .filter((warning): warning is string => Boolean(warning))
  const unsupportedStyles = output.unsupported.styles.filter((style) => style)
  const unsupportedPlots = output.unsupported.plots.filter((plot) => plot)

  if (unsupportedStyles.length > 0) {
    warningMessages.push(`Unsupported styles: ${unsupportedStyles.join(', ')}`)
  }
  if (unsupportedPlots.length > 0) {
    warningMessages.push(`Unsupported plots: ${unsupportedPlots.join(', ')}`)
  }

  const triggerOnly =
    triggerUsageDetected && plotsCount === 0 && markersCount === 0 && triggersCount === 0
  if (triggerOnly) {
    warningMessages.push('Script uses trigger(...) without plots/markers/triggers, which is valid.')
  }

  if (plotsCount > 0) {
    const hasPlotValues = output.series.some((plot) =>
      hasAnyNumericValue(plot.points.map((point) => point.value))
    )
    if (!hasPlotValues) {
      warningMessages.push('All plot values are null. Check your calculations and return values.')
    }
  }

  if (markersCount > 0) {
    const hasMarkerValues = output.markers.some(
      (marker) => typeof marker.time === 'number' && Number.isFinite(marker.time)
    )
    if (!hasMarkerValues) {
      warningMessages.push('All markers are null. Ensure plots emit valid values.')
    }
  }

  return {
    plotsCount,
    markersCount,
    warnings: warningMessages,
  }
}

export function IndicatorCodePanel({
  indicatorId,
  indicatorName,
  workspaceId,
  doc,
  save,
  exportRef,
  saveRef,
  verifyRef,
}: IndicatorCodePanelProps) {
  const [pineCode, setPineCode] = useYjsStringField(doc, 'pineCode')

  const [verifyStatus, setVerifyStatus] = useState<
    | { state: 'idle' }
    | { state: 'running' }
    | { state: 'success'; message: string; warnings: string[] }
    | { state: 'warning'; message: string; warnings: string[] }
    | { state: 'error'; message: string }
  >({ state: 'idle' })
  const [saveError, setSaveError] = useState<string | null>(null)

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envVarSearchTerm, setEnvVarSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const [cheatSheetGroup, setCheatSheetGroup] = useState<CheatSheetGroup>('data')

  const codeEditorRef = useRef<HTMLDivElement>(null)
  const codeEditorHandleRef = useRef<MonacoEditorHandle | null>(null)
  const disallowedGlobalMessage =
    'Do not use $.pine or $.data. Use globals directly (ta, input, plot, open, high, low, close, volume).'
  const monacoModelPath = useMemo(
    () =>
      `inmemory://model/pine-indicator-${encodeURIComponent(workspaceId)}-${encodeURIComponent(indicatorId)}.ts`,
    [workspaceId, indicatorId]
  )

  const validateNoDollarGlobals = (code: string) =>
    /\$\.(pine|data)\b/.test(code) ? disallowedGlobalMessage : null

  const calcWand = useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      generationType: 'javascript-function-body',
      prompt: PINE_WAND_PROMPT,
      placeholder: 'Describe the PineTS indicator logic to generate...',
    },
    currentValue: pineCode,
    onGeneratedContent: (content) => {
      setPineCode(content)
    },
    onStreamChunk: (chunk) => {
      setPineCode((prev) => prev + chunk)
    },
  })

  useEffect(() => {
    setVerifyStatus({ state: 'idle' })
    setSaveError(null)
  }, [doc, indicatorId])

  const updateCursorState = (
    value: string,
    pos: number,
    coords: { top: number; left: number; height: number } | null
  ) => {
    setCursorPosition(pos)

    if (coords && codeEditorRef.current) {
      const editorRect = codeEditorRef.current.getBoundingClientRect()
      const top = coords.top + coords.height + 4
      const left = Math.min(coords.left, editorRect.width - 260)
      setDropdownPosition({ top, left })
    }

    const envVarTrigger = checkEnvVarTrigger(value, pos)
    setShowEnvVars(envVarTrigger.show)

    if (envVarTrigger.show) {
      setEnvVarSearchTerm(envVarTrigger.searchTerm)
    } else {
      setEnvVarSearchTerm('')
    }
  }

  const handleCodeChange = (value: string) => {
    setPineCode(value)
    const offset = codeEditorHandleRef.current?.getCursorOffset() ?? value.length
    const coords = codeEditorHandleRef.current?.getCursorCoords() ?? null
    updateCursorState(value, offset, coords)
  }

  const handleCursorChange = (
    offset: number,
    coords: { top: number; left: number; height: number } | null
  ) => {
    const currentValue = codeEditorHandleRef.current?.getEditor()?.getValue() ?? pineCode
    updateCursorState(currentValue, offset, coords)
  }

  const handleSave = useCallback(async () => {
    if (!workspaceId || !indicatorId || !doc) return
    const currentPineCode = codeEditorHandleRef.current?.getEditor()?.getValue() ?? pineCode
    const disallowedMessage = validateNoDollarGlobals(currentPineCode)
    if (disallowedMessage) {
      setSaveError(null)
      setVerifyStatus({ state: 'error', message: disallowedMessage })
      return
    }

    setSaveError(null)

    try {
      if (currentPineCode !== pineCode) {
        setPineCode(currentPineCode)
      }

      await save()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save indicator.')
      console.error('Failed to update indicator', err)
    }
  }, [workspaceId, indicatorId, doc, pineCode, save, setPineCode])

  const handleExport = useCallback(() => {
    if (!doc) return
    const json = exportIndicatorsAsJson({
      exportedFrom: 'indicatorEditor',
      indicators: [
        {
          name: indicatorName,
          pineCode,
        },
      ],
    })
    const fileNameBase =
      indicatorName
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/\s+/g, '-') || 'indicator'
    const blobUrl = URL.createObjectURL(
      new Blob([json], { type: 'application/json;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `${fileNameBase}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  }, [doc, indicatorName, pineCode])

  useEffect(() => {
    exportRef.current = handleExport
  }, [exportRef, handleExport])

  const handleVerify = useCallback(async () => {
    if (!workspaceId) return
    if (verifyStatus.state === 'running') return
    const disallowedMessage = validateNoDollarGlobals(pineCode)
    if (disallowedMessage) {
      setVerifyStatus({ state: 'error', message: disallowedMessage })
      return
    }

    setVerifyStatus({ state: 'running' })

    try {
      const inferredInputMeta = inferInputMetaFromPineCode(pineCode)
      const data = await verifyIndicatorInBrowser({
        pineCode,
        inputsMap: buildInputsMapFromMeta(inferredInputMeta ?? undefined),
      })
      const plotsCount = data.plotsCount
      const markersCount = data.markersCount
      const baseMessage = `Verification passed (${plotsCount} plot${plotsCount === 1 ? '' : 's'}, ${markersCount} marker${markersCount === 1 ? '' : 's'}).`

      if (data.warnings.length > 0) {
        setVerifyStatus({
          state: 'warning',
          message: baseMessage,
          warnings: data.warnings,
        })
        return
      }

      setVerifyStatus({
        state: 'success',
        message: baseMessage,
        warnings: [],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed.'
      setVerifyStatus({ state: 'error', message })
    }
  }, [workspaceId, pineCode, verifyStatus.state])

  useEffect(() => {
    saveRef.current = handleSave
  }, [handleSave, saveRef])

  useEffect(() => {
    verifyRef.current = handleVerify
  }, [handleVerify, verifyRef])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden p-2'>
      <div className='space-y-2'>
        <div className='flex justify-start gap-2 rounded-md bg-muted p-2'>
          <div className='flex flex-wrap items-center gap-1 '>
            <Select
              value={cheatSheetGroup}
              onValueChange={(value) => setCheatSheetGroup(value as CheatSheetGroup)}
            >
              <SelectTrigger className='h-7 w-36'>
                <SelectValue placeholder='Group' />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHEAT_SHEET_GROUPS).map(([key, group]) => (
                  <SelectItem key={key} value={key}>
                    {group.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex flex-wrap items-center gap-1'>
            {CHEAT_SHEET_GROUPS[cheatSheetGroup].items.map((item) => {
              const examples = 'examples' in item ? item.examples : undefined
              const members = 'members' in item ? item.members : undefined

              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <code className='cursor-help rounded bg-background px-1 py-0.5 text-foreground text-xs'>
                      {item.key}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent
                    side='top'
                    className='max-h-48 max-w-[320px] overflow-auto whitespace-normal text-left'
                  >
                    <div className='space-y-1'>
                      <div className='font-medium'>{item.key}</div>
                      <div>{item.description}</div>
                      {examples && examples.length > 0 && (
                        <div className='text-secondary/80'>
                          <div className='font-medium text-secondary'>Examples:</div>
                          <div className='mt-1 space-y-0.5'>
                            {examples.map((example) => (
                              <div key={example}>{example}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {members && (
                        <div className='text-secondary/80'>
                          <span className='font-medium text-secondary'>Available:</span> {members}
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </div>
        {verifyStatus.state !== 'idle' && (
          <Notice
            variant={
              verifyStatus.state === 'error'
                ? 'error'
                : verifyStatus.state === 'warning'
                  ? 'warning'
                  : verifyStatus.state === 'success'
                    ? 'success'
                    : 'info'
            }
            title={
              verifyStatus.state === 'running'
                ? 'Verifying indicator...'
                : verifyStatus.state === 'error'
                  ? 'Verification failed'
                  : verifyStatus.state === 'warning'
                    ? 'Verification warnings'
                    : 'Verification passed'
            }
          >
            {verifyStatus.state === 'running' && 'Running browser verification with mock data.'}
            {verifyStatus.state === 'error' && verifyStatus.message}
            {(verifyStatus.state === 'success' || verifyStatus.state === 'warning') && (
              <div className='space-y-1'>
                <div>{verifyStatus.message}</div>
                {verifyStatus.warnings.length > 0 && (
                  <ul className='list-disc space-y-1 pl-4'>
                    {verifyStatus.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Notice>
        )}
        {saveError ? (
          <Notice variant='error' title='Save failed'>
            {saveError}
          </Notice>
        ) : null}
      </div>

      <div ref={codeEditorRef} className='relative mt-2 flex min-h-0 flex-1 flex-col rounded-md'>
        <WandPromptBar
          isVisible={calcWand.isPromptVisible}
          isLoading={calcWand.isLoading}
          isStreaming={calcWand.isStreaming}
          promptValue={calcWand.promptInputValue}
          onSubmit={(prompt: string) => calcWand.generateStream({ prompt })}
          onCancel={calcWand.isStreaming ? calcWand.cancelGeneration : calcWand.hidePromptInline}
          onChange={calcWand.updatePromptValue}
          placeholder='Describe the PineTS indicator logic to generate...'
          className='!top-0 relative mb-2'
        />
        <CodeEditor
          value={pineCode}
          onChange={handleCodeChange}
          language='typescript'
          path={monacoModelPath}
          placeholder='Write PineTS code here...'
          minHeight='0px'
          className='min-h-0 flex-1'
          highlightVariables={true}
          editorHandleRef={codeEditorHandleRef}
          extraLibs={PINE_CHEAT_SHEET_EXTRA_LIBS}
          diagnosticSourceBuilder={buildMonacoIndicatorDiagnosticSource}
          editorOptions={{
            scrollbar: { alwaysConsumeMouseWheel: true },
          }}
          showWandButton
          onWandClick={() => {
            calcWand.isPromptVisible ? calcWand.hidePromptInline() : calcWand.showPromptInline()
          }}
          wandButtonDisabled={calcWand.isLoading || calcWand.isStreaming}
          onCursorChange={handleCursorChange}
        />
        {showEnvVars && (
          <EnvVarDropdown
            visible={showEnvVars}
            onSelect={setPineCode}
            searchTerm={envVarSearchTerm}
            inputValue={pineCode}
            cursorPosition={cursorPosition}
            workspaceId={workspaceId}
            onClose={() => setShowEnvVars(false)}
            className='w-64'
            style={{
              position: 'absolute',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
            }}
          />
        )}
      </div>
    </div>
  )
}
