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
    prompt: `You are an expert JavaScript developer building KLineCharts custom indicators.
Generate ONLY the raw JavaScript code for the indicator script.
The script is executed as: calc(dataList, indicator).
Return an object shaped like:
{ plots: [{ name?: string, key?: string, data: (number|null)[], color?: string, type?: string, overlay?: boolean }], signals: [{ type: "buy"|"sell", data: (number|null)[], text?: string, color?: string }] }
Use plots to render multiple outputs; overlay=true draws on the main chart.

Current script code: {context}

Rules:
1. Output raw JavaScript only (no markdown, no explanations).
2. Do NOT include a function wrapper or signature.
3. Use return to output the result.`,
    placeholder: 'Describe the indicator logic to generate...',
  },
}

type IndicatorCodePanelProps = {
  indicator: CustomIndicatorDefinition
  indicatorId: string
  workspaceId: string
  saveRef: MutableRefObject<() => void>
}

export function IndicatorCodePanel({
  indicator,
  indicatorId,
  workspaceId,
  saveRef,
}: IndicatorCodePanelProps) {
  const updateMutation = useUpdateCustomIndicator()

  const [calcCode, setCalcCode] = useState('')

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

  useEffect(() => {
    saveRef.current = handleSave
  }, [handleSave, saveRef])

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
    <div className='flex h-full w-full flex-col overflow-hidden p-3'>

      <div className='space-y-3'>
        <div className='rounded-md bg-muted/50 p-2 text-xs text-muted-foreground'>
          <div className='flex flex-wrap items-center gap-1'>
            <span className='font-medium'>Globals:</span>
            <code className='rounded bg-background px-1 py-0.5 text-foreground'>dataList</code>,
            <code className='rounded bg-background px-1 py-0.5 text-foreground'>indicator</code>.
            Return <code className='rounded bg-background px-1 py-0.5 text-foreground'>{`{ plots, signals }`}</code>.
          </div>
        </div>
      </div>

      <div ref={codeEditorRef} className='relative mt-3 flex-1 rounded-md'>
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
