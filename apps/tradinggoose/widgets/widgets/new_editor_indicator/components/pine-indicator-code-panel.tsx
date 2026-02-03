'use client'

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { MonacoEditorHandle } from '@/components/monaco-editor'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { InputMetaMap } from '@/lib/new_indicators/types'
import { useUpdateNewIndicator, useVerifyNewIndicator } from '@/hooks/queries/new-indicators'
import { useWand } from '@/hooks/workflow/use-wand'
import type { NewIndicatorDefinition } from '@/stores/new-indicators/types'
import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { CodeEditor } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor'

type PineIndicatorCodePanelProps = {
  indicator: NewIndicatorDefinition
  indicatorId: string
  workspaceId: string
  saveRef: MutableRefObject<() => void>
  verifyRef: MutableRefObject<() => void>
}

type InputRow = {
  id: string
  title: string
  type: string
  defval: string
  minval: string
  maxval: string
  step: string
  options: string
  value: string
}

const INPUT_TYPE_OPTIONS = [
  { value: 'float', label: 'Float' },
  { value: 'int', label: 'Int' },
  { value: 'bool', label: 'Bool' },
  { value: 'string', label: 'String' },
  { value: 'source', label: 'Source' },
  { value: 'color', label: 'Color' },
  { value: 'enum', label: 'Enum' },
]

const createRowId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const createInputRow = (partial?: Partial<InputRow>): InputRow => ({
  id: createRowId(),
  title: '',
  type: 'float',
  defval: '',
  minval: '',
  maxval: '',
  step: '',
  options: '',
  value: '',
  ...partial,
})

const parseNumber = (value: string) => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseValue = (value: string, type: string) => {
  if (type === 'int' || type === 'float') {
    const parsed = parseNumber(value)
    if (typeof parsed !== 'number') return undefined
    return type === 'int' ? Math.trunc(parsed) : parsed
  }
  if (type === 'bool') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
    return undefined
  }
  return value
}

const buildInputMetaMap = (rows: InputRow[]) => {
  const map: InputMetaMap = {}
  const errors: string[] = []
  const seen = new Set<string>()

  rows.forEach((row) => {
    const title = row.title.trim()
    const hasAnyValue =
      title ||
      row.defval.trim() ||
      row.minval.trim() ||
      row.maxval.trim() ||
      row.step.trim() ||
      row.options.trim() ||
      row.value.trim()

    if (!title) {
      if (hasAnyValue) {
        errors.push('All inputs must include a title.')
      }
      return
    }

    const lowered = title.toLowerCase()
    if (seen.has(lowered)) {
      errors.push(`Input titles must be unique (case-insensitive): ${title}`)
      return
    }
    seen.add(lowered)

    const type = row.type || 'float'
    const options = row.options
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)

    map[title] = {
      title,
      type,
      defval: parseValue(row.defval, type),
      minval: parseNumber(row.minval),
      maxval: parseNumber(row.maxval),
      step: parseNumber(row.step),
      options: options.length > 0 ? options : undefined,
      value: row.value.trim() ? parseValue(row.value, type) : undefined,
    }
  })

  return { map, errors }
}

const buildInputsMap = (rows: InputRow[]) => {
  const { map } = buildInputMetaMap(rows)
  const inputs: Record<string, unknown> = {}

  Object.entries(map).forEach(([title, meta]) => {
    if (typeof meta.value !== 'undefined') {
      inputs[title] = meta.value
    } else if (typeof meta.defval !== 'undefined') {
      inputs[title] = meta.defval
    }
  })

  return inputs
}

const toRowsFromMeta = (inputMeta?: InputMetaMap | null) => {
  const rows: InputRow[] = []
  const indexByLower = new Map<string, number>()
  let hadDuplicates = false

  Object.entries(inputMeta ?? {}).forEach(([key, meta]) => {
    if (!meta || typeof meta !== 'object') return
    const title = typeof meta.title === 'string' ? meta.title.trim() : key.trim()
    if (!title) return

    const row = createInputRow({
      title,
      type: meta.type ?? 'float',
      defval: typeof meta.defval === 'string' ? meta.defval : (meta.defval?.toString?.() ?? ''),
      minval: typeof meta.minval === 'number' ? String(meta.minval) : '',
      maxval: typeof meta.maxval === 'number' ? String(meta.maxval) : '',
      step: typeof meta.step === 'number' ? String(meta.step) : '',
      options: Array.isArray(meta.options) ? meta.options.join(', ') : '',
      value: typeof meta.value === 'string' ? meta.value : (meta.value?.toString?.() ?? ''),
    })

    const lowered = title.toLowerCase()
    if (indexByLower.has(lowered)) {
      const idx = indexByLower.get(lowered) ?? -1
      if (idx >= 0) {
        rows[idx] = row
        hadDuplicates = true
      }
      return
    }

    indexByLower.set(lowered, rows.length)
    rows.push(row)
  })

  return { rows, hadDuplicates }
}

const PINE_WAND_PROMPT = `# Role
You are an expert PineTS developer writing Pine Script-style indicators in TypeScript.

# Runtime
- The script runs inside: async ($) => { ... }.
- Access data and Pine helpers like:
  const { close, open, high, low, volume } = $.data;
  const { ta, input, plot, plotshape, plotchar, plotarrow, hline, fill } = $.pine;
- Do NOT return { plots, signals }. PineTS uses plot calls.
- No imports, exports, require, or fetch.
- Do not read future bars; assume bar-close data only.

# Output
- Use plot/plotshape/plotarrow/plotchar to emit visuals.
- Use input.* to define user-configurable inputs (values come from the Input panel).

# Robustness
- Guard against NaN/Infinity and divide-by-zero.
- Prefer edge-triggered logic to avoid repeated markers.

Current script code: {context}

Rules:
1) Output raw TypeScript/JavaScript only.
2) Do NOT include a function wrapper or signature.`

export function PineIndicatorCodePanel({
  indicator,
  indicatorId,
  workspaceId,
  saveRef,
  verifyRef,
}: PineIndicatorCodePanelProps) {
  const updateMutation = useUpdateNewIndicator()
  const verifyMutation = useVerifyNewIndicator()

  const [pineCode, setPineCode] = useState('')
  const [inputRows, setInputRows] = useState<InputRow[]>([])
  const [inputMetaWarning, setInputMetaWarning] = useState<string | null>(null)
  const [inputMetaError, setInputMetaError] = useState<string | null>(null)

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
    if (!indicator) return
    const signature = `${indicator.id}:${indicator.updatedAt ?? indicator.createdAt ?? ''}`
    if (indicatorSignatureRef.current === signature) return
    indicatorSignatureRef.current = signature

    setPineCode(indicator.pineCode ?? '')
    const metaResult = toRowsFromMeta(indicator.inputMeta ?? null)
    setInputRows(metaResult.rows)
    setInputMetaWarning(
      metaResult.hadDuplicates ? 'Input titles had collisions. The latest value was kept.' : null
    )
    setInputMetaError(null)
    setVerifyStatus({ state: 'idle' })
  }, [indicator])

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
    if (!workspaceId || !indicatorId) return
    const { map, errors } = buildInputMetaMap(inputRows)
    if (errors.length > 0) {
      setInputMetaError(errors[0])
      return
    }
    setInputMetaError(null)

    try {
      await updateMutation.mutateAsync({
        workspaceId,
        indicatorId,
        updates: {
          pineCode,
          inputMeta: map,
        },
      })
    } catch (err) {
      console.error('Failed to update indicator', err)
    }
  }, [workspaceId, indicatorId, updateMutation, pineCode, inputRows])

  const handleVerify = useCallback(async () => {
    if (!workspaceId) return
    if (verifyStatus.state === 'running') return

    const { errors } = buildInputMetaMap(inputRows)
    if (errors.length > 0) {
      setInputMetaError(errors[0])
      setVerifyStatus({ state: 'error', message: errors[0] })
      return
    }
    setInputMetaError(null)

    setVerifyStatus({ state: 'running' })

    try {
      const data = await verifyMutation.mutateAsync({
        workspaceId,
        pineCode,
        inputs: buildInputsMap(inputRows),
      })

      const warnings = Array.isArray(data?.warnings)
        ? data.warnings
            .map((warning: { message?: string }) => warning?.message)
            .filter((warning: any): warning is string => Boolean(warning))
        : []
      const unsupportedStyles = Array.isArray(data?.unsupported?.styles)
        ? data.unsupported.styles.filter((style: string) => style)
        : []
      const unsupportedPlots = Array.isArray(data?.unsupported?.plots)
        ? data.unsupported.plots.filter((plot: string) => plot)
        : []
      if (unsupportedStyles.length > 0) {
        warnings.push(`Unsupported styles: ${unsupportedStyles.join(', ')}`)
      }
      if (unsupportedPlots.length > 0) {
        warnings.push(`Unsupported plots: ${unsupportedPlots.join(', ')}`)
      }
      const plotsCount = data?.plotsCount ?? 0
      const markersCount = data?.markersCount ?? 0
      const baseMessage = `Verification passed (${plotsCount} plot${
        plotsCount === 1 ? '' : 's'
      }, ${markersCount} marker${markersCount === 1 ? '' : 's'}).`

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
  }, [workspaceId, verifyMutation, pineCode, inputRows, verifyStatus.state])

  useEffect(() => {
    saveRef.current = handleSave
  }, [handleSave, saveRef])

  useEffect(() => {
    verifyRef.current = handleVerify
  }, [handleVerify, verifyRef])

  const handleAddInput = () => {
    setInputRows((prev) => [...prev, createInputRow()])
  }

  const handleRemoveInput = (rowId: string) => {
    setInputRows((prev) => prev.filter((row) => row.id !== rowId))
  }

  const handleRowChange = (rowId: string, updates: Partial<InputRow>) => {
    setInputRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...updates } : row)))
  }

  const showVerifyNotice = verifyStatus.state !== 'idle'
  const verifyNoticeVariant =
    verifyStatus.state === 'success'
      ? 'success'
      : verifyStatus.state === 'warning'
        ? 'warning'
        : verifyStatus.state === 'error'
          ? 'error'
          : 'info'

  return (
    <div className='flex h-full w-full flex-col gap-4 overflow-hidden p-4'>
      <div className='flex-1 overflow-hidden'>
        <div className='flex h-full flex-col gap-3'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='font-semibold text-sm'>PineTS Script</div>
              <div className='text-muted-foreground text-xs'>
                Use PineTS helpers (pine.plot, pine.plotshape, pine.input, etc.).
              </div>
            </div>
          </div>

          <div className='flex-1 overflow-hidden rounded-md border border-border bg-background'>
            <div className='relative h-full min-h-[320px] p-2' ref={codeEditorRef}>
              <WandPromptBar
                isVisible={calcWand.isPromptVisible}
                isLoading={calcWand.isLoading}
                isStreaming={calcWand.isStreaming}
                promptValue={calcWand.promptInputValue}
                onSubmit={(prompt: string) => calcWand.generateStream({ prompt })}
                onCancel={
                  calcWand.isStreaming ? calcWand.cancelGeneration : calcWand.hidePromptInline
                }
                onChange={calcWand.updatePromptValue}
                placeholder='Describe the PineTS indicator logic to generate...'
                className='!top-0 relative mb-2'
              />
              <CodeEditor
                value={pineCode}
                onChange={handleCodeChange}
                language='typescript'
                placeholder='Write PineTS code here...'
                minHeight='320px'
                editorHandleRef={codeEditorHandleRef}
                showWandButton
                onWandClick={() => {
                  calcWand.isPromptVisible
                    ? calcWand.hidePromptInline()
                    : calcWand.showPromptInline()
                }}
                wandButtonDisabled={calcWand.isLoading || calcWand.isStreaming}
                onCursorChange={handleCursorChange}
              />
              {showEnvVars && (
                <EnvVarDropdown
                  visible={showEnvVars}
                  onSelect={(nextValue) => {
                    setPineCode(nextValue)
                  }}
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

          {showVerifyNotice && (
            <Notice variant={verifyNoticeVariant}>
              <div className='space-y-2'>
                <div>
                  {verifyStatus.state === 'running' ? 'Verifying...' : verifyStatus.message}
                </div>
                {verifyStatus.state === 'warning' && verifyStatus.warnings.length > 0 && (
                  <ul className='list-disc pl-5 text-xs'>
                    {verifyStatus.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Notice>
          )}
        </div>
      </div>

      <div className='rounded-md border border-border bg-muted/30 p-4'>
        <div className='flex items-center justify-between'>
          <div>
            <div className='font-semibold text-sm'>Inputs</div>
            <div className='text-muted-foreground text-xs'>
              Define input titles and defaults for pine.input.* calls.
            </div>
          </div>
          <Button type='button' variant='secondary' size='sm' onClick={handleAddInput}>
            <Plus className='mr-1 h-4 w-4' />
            Add input
          </Button>
        </div>

        {inputMetaWarning && (
          <div className='mt-3'>
            <Notice variant='warning'>{inputMetaWarning}</Notice>
          </div>
        )}

        {inputMetaError && (
          <div className='mt-3'>
            <Notice variant='error'>{inputMetaError}</Notice>
          </div>
        )}

        <div className='mt-4 space-y-3'>
          <div className='hidden grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1.5fr_1fr_auto] gap-2 text-muted-foreground text-xs md:grid'>
            <span>Title</span>
            <span>Type</span>
            <span>Default</span>
            <span>Min</span>
            <span>Max</span>
            <span>Step</span>
            <span>Options</span>
            <span>Value</span>
            <span />
          </div>

          {inputRows.length === 0 ? (
            <div className='rounded-md border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-xs'>
              No inputs yet. Add inputs to configure pine.input values.
            </div>
          ) : (
            inputRows.map((row) => (
              <div
                key={row.id}
                className='grid grid-cols-1 items-center gap-2 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_1.5fr_1fr_auto]'
              >
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Title</Label>
                  <Input
                    value={row.title}
                    onChange={(event) => handleRowChange(row.id, { title: event.target.value })}
                    placeholder='Length'
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Type</Label>
                  <Select
                    value={row.type}
                    onValueChange={(value) => handleRowChange(row.id, { type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='Type' />
                    </SelectTrigger>
                    <SelectContent>
                      {INPUT_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Default</Label>
                  <Input
                    value={row.defval}
                    onChange={(event) => handleRowChange(row.id, { defval: event.target.value })}
                    placeholder='14'
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Min</Label>
                  <Input
                    value={row.minval}
                    onChange={(event) => handleRowChange(row.id, { minval: event.target.value })}
                    placeholder='1'
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Max</Label>
                  <Input
                    value={row.maxval}
                    onChange={(event) => handleRowChange(row.id, { maxval: event.target.value })}
                    placeholder='200'
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Step</Label>
                  <Input
                    value={row.step}
                    onChange={(event) => handleRowChange(row.id, { step: event.target.value })}
                    placeholder='1'
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Options</Label>
                  <Input
                    value={row.options}
                    onChange={(event) => handleRowChange(row.id, { options: event.target.value })}
                    placeholder='fast, slow'
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs md:hidden'>Value</Label>
                  <Input
                    value={row.value}
                    onChange={(event) => handleRowChange(row.id, { value: event.target.value })}
                    placeholder='Optional override'
                  />
                </div>
                <div className='flex items-center justify-end'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    onClick={() => handleRemoveInput(row.id)}
                  >
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
