'use client'

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { useQueryClient } from '@tanstack/react-query'
import type { MonacoEditorHandle } from '@/components/monaco-editor'
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
import {
  buildInputsMapFromMeta,
  inferInputMetaFromPineCode,
} from '@/lib/indicators/input-meta'
import { ENTITY_KIND_INDICATOR, type ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import * as Y from 'yjs'
import { useEntitySession } from '@/lib/copilot/review-sessions/entity-session-host'
import { getFieldsMap } from '@/lib/yjs/entity-session'
import { useYjsStringField, useYjsField } from '@/lib/yjs/use-entity-fields'
import { indicatorKeys, useVerifyIndicator } from '@/hooks/queries/indicators'
import { useWand } from '@/hooks/workflow/use-wand'
import type { InputMetaMap } from '@/lib/indicators/types'
import {
  CHEAT_SHEET_GROUPS,
  type CheatSheetGroup,
} from '@/widgets/widgets/editor_indicator/components/pine-cheat-sheet'
import { PINE_CHEAT_SHEET_EXTRA_LIBS } from '@/widgets/widgets/editor_indicator/components/pine-cheat-sheet-typings'
import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { CodeEditor } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor'

type IndicatorCodePanelProps = {
  workspaceId: string
  descriptor: ReviewTargetDescriptor
  saveRef: MutableRefObject<() => void>
  verifyRef: MutableRefObject<() => void>
  yjsDoc: Y.Doc
  onReviewTargetChange?: (descriptor: ReviewTargetDescriptor | null) => void
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

export function IndicatorCodePanel({
  workspaceId,
  descriptor,
  saveRef,
  verifyRef,
  yjsDoc,
  onReviewTargetChange,
}: IndicatorCodePanelProps) {
  const queryClient = useQueryClient()
  const entitySession = useEntitySession()
  const verifyMutation = useVerifyIndicator()

  const pineCodeYText = yjsDoc ? getFieldsMap(yjsDoc).get('pineCode') : null

  // Yjs-backed collaborative fields
  const [yjsName] = useYjsStringField(yjsDoc, 'name', '')
  const [yjsColor] = useYjsStringField(yjsDoc, 'color', '')
  const [yjsPineCode, setYjsPineCode] = useYjsStringField(yjsDoc, 'pineCode', '')
  const [yjsInputMeta, setYjsInputMeta] = useYjsField<InputMetaMap | null>(
    yjsDoc,
    'inputMeta',
    null
  )
  const pineCode = yjsPineCode
  const setPineCode = setYjsPineCode

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
  const [cheatSheetGroup, setCheatSheetGroup] = useState<CheatSheetGroup>('data')

  const codeEditorRef = useRef<HTMLDivElement>(null)
  const codeEditorHandleRef = useRef<MonacoEditorHandle | null>(null)
  const pineCodeRef = useLatestRef(pineCode)
  const disallowedGlobalMessage =
    'Do not use $.pine or $.data. Use globals directly (ta, input, plot, open, high, low, close, volume).'
  const monacoModelPath = useMemo(
    () =>
      `inmemory://model/pine-indicator-${encodeURIComponent(workspaceId)}-${encodeURIComponent(
        descriptor.reviewSessionId ?? descriptor.draftSessionId ?? descriptor.entityId ?? 'draft'
      )}.ts`,
    [descriptor.draftSessionId, descriptor.entityId, descriptor.reviewSessionId, workspaceId]
  )

  const validateNoDollarGlobals = (code: string) =>
    /\$\.(pine|data)\b/.test(code) ? disallowedGlobalMessage : null

  useEffect(() => {
    setVerifyStatus({ state: 'idle' })
  }, [descriptor.reviewSessionId])

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
      const nextCode = `${pineCodeRef.current}${chunk}`
      pineCodeRef.current = nextCode
      setPineCode(nextCode)
    },
  })

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
    if (!workspaceId || !descriptor.reviewSessionId) return
    const disallowedMessage = validateNoDollarGlobals(pineCode)
    if (disallowedMessage) {
      setVerifyStatus({ state: 'error', message: disallowedMessage })
      return
    }
    const inferredInputMeta = inferInputMetaFromPineCode(pineCode) ?? yjsInputMeta ?? null
    const trimmedName = yjsName.trim()

    if (!trimmedName) {
      setVerifyStatus({ state: 'error', message: 'Indicator name is required.' })
      return
    }

    try {
      setYjsInputMeta(inferredInputMeta)

      const response = await fetch('/api/copilot/review-entities/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityKind: ENTITY_KIND_INDICATOR,
          workspaceId,
          reviewSessionId: descriptor.reviewSessionId,
          draftSessionId: descriptor.draftSessionId ?? undefined,
          indicator: {
            id: descriptor.entityId ?? undefined,
            name: trimmedName,
            color: yjsColor.trim() || null,
            pineCode,
            inputMeta: inferredInputMeta,
          },
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save indicator.')
      }

      await queryClient.invalidateQueries({ queryKey: indicatorKeys.list(workspaceId) })
      if (payload?.reviewTarget) {
        onReviewTargetChange?.(payload.reviewTarget as ReviewTargetDescriptor)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save indicator.'
      setVerifyStatus({ state: 'error', message })
    }
  }, [
    descriptor.draftSessionId,
    descriptor.entityId,
    descriptor.reviewSessionId,
    onReviewTargetChange,
    pineCode,
    queryClient,
    setYjsInputMeta,
    workspaceId,
    yjsColor,
    yjsInputMeta,
    yjsName,
  ])

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
      const data = await verifyMutation.mutateAsync({
        workspaceId,
        pineCode,
        inputs: buildInputsMapFromMeta(inferredInputMeta ?? undefined),
      })

      const warnings: string[] = []
      if (Array.isArray(data?.warnings)) {
        warnings.push(
          ...data.warnings
            .map((warning: { message?: string }) => warning?.message)
            .filter((warning: any): warning is string => Boolean(warning))
        )
      }
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
      const baseMessage = `Verification passed (${plotsCount} plot${plotsCount === 1 ? '' : 's'
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
  }, [workspaceId, verifyMutation, pineCode, verifyStatus.state])

  useEffect(() => {
    saveRef.current = handleSave
  }, [handleSave, saveRef])

  useEffect(() => {
    verifyRef.current = handleVerify
  }, [handleVerify, verifyRef])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden p-2'>
      <div className='space-y-2'>
        <div className='rounded-md bg-muted flex justify-start gap-2 p-2'>
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
                    <code className='cursor-help rounded bg-background px-1 py-0.5 text-xs text-foreground'>
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
                          <span className='font-medium text-secondary'>Available:</span>{' '}
                          {members}
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
          className='flex-1 min-h-0'
          yText={pineCodeYText instanceof Y.Text ? pineCodeYText : null}
          awareness={entitySession?.awareness}
          highlightVariables={true}
          editorHandleRef={codeEditorHandleRef}
          extraLibs={PINE_CHEAT_SHEET_EXTRA_LIBS}
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
