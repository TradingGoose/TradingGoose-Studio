'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { EnvVarDropdown, checkEnvVarTrigger } from '@/components/ui/env-var-dropdown'
import { Notice } from '@/components/ui/notice'
import type { MonacoEditorHandle } from '@/components/monaco-editor'
import { useWand } from '@/hooks/workflow/use-wand'
import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { useUpdateCustomIndicator } from '@/hooks/queries/custom-indicators'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'
import { CodeEditor } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor'
import { getCodeSectionValue } from '@/widgets/widgets/editor_indicator/editor-indicator-helpers'
import type { CodeSection } from '@/widgets/widgets/editor_indicator/editor-indicator-types'

const SECTION_META = {
  id: 'calc' satisfies CodeSection,
  label: 'Script',
  description: 'Return { plots, signals } from dataList.',
}

const INDICATOR_WAND_PROMPTS: Record<
  CodeSection,
  { prompt: string; placeholder: string }
> = {
  calc: {
    prompt: `# Role
You are an expert TypeScript developer building KLineCharts custom indicators.

# Runtime
- The script is executed as the body of: calc(dataList, indicator).
- Output raw TypeScript/JavaScript only. No markdown, no explanations.
- Do NOT include import/export, require, or a function wrapper/signature.
- Network access is unavailable; use standard JS only (Math, Date, etc).
- Do not read future bars; signals are assumed confirmed on bar close.

# Inputs
- dataList: Array of KLineData with fields: timestamp, open, high, low, close, volume (volume optional).
- indicator: { id?: string, name?: string, color?: string }.

# Output (strict)
Return a single object with this shape:
{
  name?: string,
  plots: [{ name?: string, key?: string, data: (number|null)[], color?: string, type?: string, overlay?: boolean, style?: string }],
  signals?: [{ type: "buy"|"sell", data: (number|null)[], text?: string, color?: string, textData?: (string|null)[] }]
}
- Every data array must match dataList.length; use null for "no value".
- overlay=true draws on the main chart; set overlay=false (at least one plot) for its own pane.
- The final statement MUST be: return { ... } (do not start with a bare object literal).
- If signals are included, signal data values should be price levels (close/low/high) so markers render on the chart.

# Scoping
- If plots and signals share calculations, compute them once in the outer scope (e.g., const smaValues = ...).
- Do NOT reference variables defined inside plots/signals IIFEs from other sections.

# Robustness (important)
- Guard against NaN/Infinity and divide-by-zero; coerce invalid numbers to null.
- Avoid overly strict logic that yields zero buy or zero sell signals unless explicitly requested.
- Prefer edge-triggered signals to avoid repeated consecutive markers (e.g., buy = rawBuy && !prevRawBuy).

Current script code: {context}

Rules:
1) Output raw TypeScript/JavaScript only.
2) Do NOT include a function wrapper or signature.
3) Use return to output the result.`,
    placeholder: 'Describe the indicator logic to generate...',
  },
}

type IndicatorCodePanelProps = {
  indicator: CustomIndicatorDefinition
  indicatorId: string
  workspaceId: string
  saveRef: MutableRefObject<() => void>
  verifyRef: MutableRefObject<() => void>
}

export function IndicatorCodePanel({
  indicator,
  indicatorId,
  workspaceId,
  saveRef,
  verifyRef,
}: IndicatorCodePanelProps) {
  const updateMutation = useUpdateCustomIndicator()

  const [calcCode, setCalcCode] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<
    | { state: 'idle' }
    | { state: 'running' }
    | { state: 'success'; message: string; warnings: string[] }
    | { state: 'warning'; message: string; warnings: string[] }
    | { state: 'error'; message: string }
  >({ state: 'idle' })

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envVarSearchTerm, setEnvVarSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })

  const codeEditorRef = useRef<HTMLDivElement>(null)
  const codeEditorHandleRef = useRef<MonacoEditorHandle | null>(null)

  const indicatorSignatureRef = useRef('')

  const calcWand = useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      generationType: 'javascript-function-body',
      prompt: INDICATOR_WAND_PROMPTS.calc.prompt,
      placeholder: INDICATOR_WAND_PROMPTS.calc.placeholder,
    },
    currentValue: calcCode,
    onGeneratedContent: (content) => {
      setCalcCode(content)
    },
    onStreamChunk: (chunk) => {
      setCalcCode((prev) => prev + chunk)
    },
  })

  useEffect(() => {
    if (!indicator) return
    const signature = `${indicator.id}:${indicator.updatedAt ?? indicator.createdAt ?? ''}`
    if (indicatorSignatureRef.current === signature) return
    indicatorSignatureRef.current = signature

    setCalcCode(getCodeSectionValue('calc', indicator))
  }, [indicator])

  const activeCode = useMemo(() => calcCode, [calcCode])

  const setActiveCode = useCallback(
    (value: string) => {
      setCalcCode(value)
    },
    []
  )

  const handleSave = useCallback(async () => {
    if (!workspaceId || !indicatorId) return
    try {
      await updateMutation.mutateAsync({
        workspaceId,
        indicatorId,
        updates: {
          calcCode,
        },
      })
    } catch (err) {
      console.error('Failed to update indicator code', err)
    }
  }, [workspaceId, indicatorId, updateMutation, calcCode])

  const handleVerify = useCallback(async () => {
    if (!workspaceId) return
    if (verifyStatus.state === 'running') return

    setVerifyStatus({ state: 'running' })

    try {
      const response = await fetch('/api/indicators/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, code: calcCode }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok || !payload?.success) {
        const message =
          payload?.error || `Verification failed (${response.status} ${response.statusText})`
        setVerifyStatus({ state: 'error', message })
        return
      }

      const warnings = Array.isArray(payload?.data?.warnings)
        ? payload.data.warnings
          .map((warning: { message?: string }) => warning?.message)
          .filter((warning: any): warning is string => Boolean(warning))
        : []
      const plotsCount = payload?.data?.plotsCount ?? 0
      const signalsCount = payload?.data?.signalsCount ?? 0
      const baseMessage = `Verification passed (${plotsCount} plot${plotsCount === 1 ? '' : 's'}, ${signalsCount} signal${signalsCount === 1 ? '' : 's'}).`

      if (warnings.length > 0) {
        setVerifyStatus({
          state: 'warning',
          message: baseMessage,
          warnings,
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
  }, [workspaceId, calcCode, verifyStatus.state])

  useEffect(() => {
    saveRef.current = handleSave
  }, [handleSave, saveRef])

  useEffect(() => {
    verifyRef.current = handleVerify
  }, [handleVerify, verifyRef])

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
    setActiveCode(value)
    const offset = codeEditorHandleRef.current?.getCursorOffset() ?? value.length
    const coords = codeEditorHandleRef.current?.getCursorCoords() ?? null
    updateCursorState(value, offset, coords)
  }

  const handleCursorChange = (
    offset: number,
    coords: { top: number; left: number; height: number } | null
  ) => {
    const currentValue = codeEditorHandleRef.current?.getEditor()?.getValue() ?? activeCode
    updateCursorState(currentValue, offset, coords)
  }

  // Schema-driven autocomplete removed for single-script indicators.

  const indicatorExtraLibs = useMemo(
    () => [
      {
        filePath: 'inmemory://model/indicator-globals.d.ts',
        content: `type KLineData = {
  timestamp: number
  open: number
  close: number
  high: number
  low: number
  volume?: number
  [key: string]: any
}

declare const dataList: KLineData[]
declare const indicator: {
  id?: string
  name?: string
  color?: string
}

type IndicatorPlot = {
  key?: string
  name?: string
  data: Array<number | null>
  color?: string
  type?: string
  overlay?: boolean
  style?: string
}

type IndicatorSignal = {
  type: 'buy' | 'sell'
  data: Array<number | null>
  text?: string
  color?: string
  textData?: Array<string | null>
}

type IndicatorOutput = {
  name?: string
  plots?: IndicatorPlot[]
  signals?: IndicatorSignal[]
}
`,
      },
    ],
    []
  )

  const activeWand = calcWand
  const activeWandPlaceholder = INDICATOR_WAND_PROMPTS.calc.placeholder

  return (
    <div className='flex h-full w-full flex-col overflow-hidden p-2'>

      <div className='space-y-2'>
        <div className='rounded-md bg-muted/50 p-2 text-xs text-muted-foreground'>
          <div className='flex flex-wrap items-center gap-1'>
            <span className='font-medium'>Globals:</span>
            <code className='rounded bg-background px-1 py-0.5 text-foreground'>dataList</code>,
            <code className='rounded bg-background px-1 py-0.5 text-foreground'>indicator</code>.
            Return <code className='rounded bg-background px-1 py-0.5 text-foreground'>{`{ plots, signals }`}</code>.
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
            {verifyStatus.state === 'running' && 'Running server-side verification with mock data.'}
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
      </div>

      <div ref={codeEditorRef} className='relative mt-3 flex min-h-0 flex-1 flex-col rounded-md'>
        <WandPromptBar
          isVisible={activeWand.isPromptVisible}
          isLoading={activeWand.isLoading}
          isStreaming={activeWand.isStreaming}
          promptValue={activeWand.promptInputValue}
          onSubmit={(prompt: string) => activeWand.generateStream({ prompt })}
          onCancel={
            activeWand.isStreaming ? activeWand.cancelGeneration : activeWand.hidePromptInline
          }
          onChange={activeWand.updatePromptValue}
          placeholder={activeWandPlaceholder}
          className='!top-0 relative mb-2'
        />
        <CodeEditor
          value={activeCode}
          onChange={handleCodeChange}
          language='typescript'
          placeholder='// Write indicator code here. Return { plots, signals }. Use {{ENV_VAR}} for environment variables.'
          minHeight='360px'
          className='flex-1 min-h-0'
          highlightVariables={true}
          editorHandleRef={codeEditorHandleRef}
          onCursorChange={handleCursorChange}
          extraLibs={indicatorExtraLibs}
          showWandButton={true}
          onWandClick={() => {
            activeWand.isPromptVisible
              ? activeWand.hidePromptInline()
              : activeWand.showPromptInline()
          }}
          wandButtonDisabled={activeWand.isLoading || activeWand.isStreaming}
        />

        {showEnvVars && (
          <EnvVarDropdown
            visible={showEnvVars}
            onSelect={setActiveCode}
            searchTerm={envVarSearchTerm}
            inputValue={activeCode}
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
