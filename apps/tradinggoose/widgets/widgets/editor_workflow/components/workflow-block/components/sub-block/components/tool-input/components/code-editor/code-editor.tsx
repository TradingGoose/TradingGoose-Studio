import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Wand2 } from 'lucide-react'
import { MonacoEditor } from '@/components/monaco-editor'
import type { MonacoDecoration, MonacoEditorHandle, MonacoEditorProps } from '@/components/monaco-editor'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: 'javascript' | 'json' | 'typescript' | 'sql' | 'html' | 'plaintext'
  path?: string
  placeholder?: string
  className?: string
  minHeight?: string
  height?: string | number
  highlightVariables?: boolean
  onKeyDown?: (e: KeyboardEvent) => void
  onKeyUp?: (e: KeyboardEvent) => void
  onClick?: (e: MouseEvent) => void
  onBlur?: () => void
  onCursorChange?: (
    offset: number,
    coords: { top: number; left: number; height: number } | null
  ) => void
  editorHandleRef?: MutableRefObject<MonacoEditorHandle | null>
  disabled?: boolean
  schemaParameters?: Array<{
    name: string
    type: string
    description: string
    required: boolean
    label?: string
    atomic?: boolean
  }>
  atomicSchemaParams?: boolean
  showWandButton?: boolean
  onWandClick?: () => void
  wandButtonDisabled?: boolean
  autoHeight?: boolean
  extraLibs?: ReadonlyArray<{ content: string; filePath?: string }>
  editorOptions?: MonacoEditorProps['options']
}

export function CodeEditor({
  value,
  onChange,
  language,
  path,
  placeholder = '',
  className = '',
  minHeight = '360px',
  height,
  highlightVariables = true,
  onKeyDown,
  onKeyUp,
  onClick,
  onBlur,
  onCursorChange,
  editorHandleRef,
  disabled = false,
  schemaParameters = [],
  atomicSchemaParams = false,
  showWandButton = false,
  onWandClick,
  wandButtonDisabled = false,
  autoHeight,
  extraLibs,
  editorOptions,
}: CodeEditorProps) {
  const [code, setCode] = useState(value)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const editorRef = useRef<MonacoEditorHandle | null>(null)

  useEffect(() => {
    setCode(value)
  }, [value])

  const resolvedAutoHeight = autoHeight ?? false
  const resolvedHeight = resolvedAutoHeight ? undefined : height ?? '100%'

  const { decorations, atomicTokenRanges } = useMemo(() => {
    if (
      !code ||
      !highlightVariables ||
      (language !== 'javascript' && language !== 'typescript')
    ) {
      return {
        decorations: [] as MonacoDecoration[],
        atomicTokenRanges: [] as Array<{ start: number; end: number }>,
      }
    }

    const ranges: MonacoDecoration[] = []
    const atomicRanges: Array<{ start: number; end: number }> = []
    const envVarRegex = /\{\{[^}]+\}\}/g
    const tagRegex = /<([^>\s/]+)>/g
    let match: RegExpExecArray | null

    while ((match = envVarRegex.exec(code)) !== null) {
      ranges.push({
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        className: 'monaco-decoration-env',
      })
    }

    while ((match = tagRegex.exec(code)) !== null) {
      ranges.push({
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        className: 'monaco-decoration-reference',
      })
    }

    if (schemaParameters.length > 0) {
      type SchemaRange = {
        start: number
        end: number
        name: string
        label?: string
        kind?: 'figure'
        atomic?: boolean
      }
      const rangesForSchema: SchemaRange[] = []
      const isBoundary = (char?: string) => !char || !/[A-Za-z0-9_$]/.test(char)
      const sortedParams = [...schemaParameters]
        .filter((param) => param.name)
        .sort((a, b) => b.name.length - a.name.length)

      const hasOverlap = (start: number, end: number) =>
        rangesForSchema.some((range) => start < range.end && end > range.start)

      const isFigureParamName = (name: string) =>
        name.startsWith('figures.') || name.startsWith('figures[')

      sortedParams.forEach((param) => {
        const name = param.name
        if (!name) return
        let index = code.indexOf(name)
        while (index !== -1) {
          const before = index > 0 ? code[index - 1] : undefined
          const after = code[index + name.length]
          if (isBoundary(before) && isBoundary(after)) {
            const start = index
            const end = index + name.length
            if (!hasOverlap(start, end)) {
              const label = param.label && param.label !== name ? param.label : undefined
              const kind = isFigureParamName(name) ? 'figure' : undefined
              const atomic = atomicSchemaParams || param.atomic || kind === 'figure'
              rangesForSchema.push({ start, end, name, label, kind, atomic })
            }
          }
          index = code.indexOf(name, index + name.length)
        }
      })

      rangesForSchema.forEach((range) => {
        if (range.atomic) {
          atomicRanges.push({ start: range.start, end: range.end })
        }
        const label = range.label
        if (label && label !== range.name) {
          ranges.push({
            startOffset: range.start,
            endOffset: range.end,
            className: 'schema-param-hidden',
            inlineClassNameAffectsLetterSpacing: true,
            before: {
              content: label,
              className: 'schema-param-alias',
              cursorStops: 'both',
            },
          })
          return
        }
        ranges.push({
          startOffset: range.start,
          endOffset: range.end,
          className: 'schema-param-highlight',
        })
      })
    }

    return { decorations: ranges, atomicTokenRanges: atomicRanges }
  }, [code, highlightVariables, language, schemaParameters, atomicSchemaParams])

  const emitCursorChange = (offset: number) => {
    onCursorChange?.(offset, editorRef.current?.getCursorCoords() ?? null)
  }

  const handleChange = (newCode: string) => {
    if (isCollapsed || disabled) return
    setCode(newCode)
    onChange(newCode)
    emitCursorChange(editorRef.current?.getCursorOffset() ?? newCode.length)
  }

  const showCollapseToggle = !showWandButton && code.split('\n').length > 5

  const handleEditorKeyDown = (event: KeyboardEvent) => {
    if (
      !disabled &&
      !isCollapsed &&
      (event.key === 'Backspace' || event.key === 'Delete') &&
      atomicTokenRanges.length > 0
    ) {
      const editor = editorRef.current?.getEditor()
      const model = editor?.getModel()
      const selection = editor?.getSelection()

      if (editor && model && selection) {
        const startPos = selection.getStartPosition()
        const endPos = selection.getEndPosition()
        const selectionStart = model.getOffsetAt(startPos)
        const selectionEnd = model.getOffsetAt(endPos)

        const deleteRange = (start: number, end: number) => {
          const rangeStart = model.getPositionAt(start)
          const rangeEnd = model.getPositionAt(end)
          editor.pushUndoStop()
          editor.executeEdits('remove-figure-token', [
            {
              range: {
                startLineNumber: rangeStart.lineNumber,
                startColumn: rangeStart.column,
                endLineNumber: rangeEnd.lineNumber,
                endColumn: rangeEnd.column,
              },
              text: '',
              forceMoveMarkers: true,
            },
          ])
          editor.pushUndoStop()
          editor.setPosition(rangeStart)
          editor.setSelection({
            startLineNumber: rangeStart.lineNumber,
            startColumn: rangeStart.column,
            endLineNumber: rangeStart.lineNumber,
            endColumn: rangeStart.column,
          })
        }

        if (selectionStart !== selectionEnd) {
          let rangeStart = selectionStart
          let rangeEnd = selectionEnd
          let intersects = false
          atomicTokenRanges.forEach((token) => {
            if (token.start < rangeEnd && token.end > rangeStart) {
              intersects = true
              rangeStart = Math.min(rangeStart, token.start)
              rangeEnd = Math.max(rangeEnd, token.end)
            }
          })
          if (intersects) {
            event.preventDefault()
            event.stopPropagation()
            deleteRange(rangeStart, rangeEnd)
            return
          }
        } else {
          const offset = selectionStart
          const target =
            event.key === 'Backspace'
              ? atomicTokenRanges.find((token) => offset > token.start && offset <= token.end)
              : atomicTokenRanges.find((token) => offset >= token.start && offset < token.end)
          if (target) {
            event.preventDefault()
            event.stopPropagation()
            deleteRange(target.start, target.end)
            return
          }
        }
      }
    }

    onKeyDown?.(event)
  }

  const mergedEditorOptions = useMemo<MonacoEditorProps['options']>(
    () => ({
      lineNumbers: 'on' as const,
      padding: { top: 8, bottom: 8 },
      ...(editorOptions ?? {}),
    }),
    [editorOptions]
  )

  return (
    <div
      className={cn(
        'group relative min-h-0 h-full rounded-md border bg-background font-mono text-sm',
        className
      )}
    >
      {showWandButton && onWandClick && (
        <Button
          variant='ghost'
          size='icon'
          onClick={onWandClick}
          disabled={wandButtonDisabled}
          aria-label='Generate with AI'
          className='absolute top-2 right-3 z-10 h-8 w-8 rounded-sm border border-transparent bg-muted/80 text-muted-foreground opacity-0 shadow-sm transition-all duration-200 hover:bg-muted hover:text-foreground hover:shadow group-hover:opacity-100'
        >
          <Wand2 className='h-4 w-4' />
        </Button>
      )}

      {showCollapseToggle && (
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            'absolute top-2 right-2 z-10 rounded-md p-1.5',
            'bg-accent text-muted-foreground hover:bg-card hover:text-foreground',
            'opacity-0 transition-opacity group-hover:opacity-100',
            'font-medium text-xs'
          )}
        >
          {isCollapsed ? 'Expand' : 'Collapse'}
        </button>
      )}

      <div className={cn('relative mt-0 pt-0 h-full min-h-0', isCollapsed && 'overflow-hidden')}>
        <MonacoEditor
          ref={(instance) => {
            editorRef.current = instance
            if (editorHandleRef) {
              editorHandleRef.current = instance
            }
          }}
          value={code}
          onChange={handleChange}
          onCursorChange={emitCursorChange}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={onKeyUp}
          onClick={onClick}
          onBlur={onBlur}
          language={language}
          path={path}
          placeholder={isCollapsed ? '' : placeholder}
          decorations={decorations}
          autoHeight={resolvedAutoHeight}
          minHeight={minHeight}
          height={resolvedHeight}
          className={cn('h-full focus:outline-none', isCollapsed && 'pointer-events-none select-none')}
          readOnly={disabled || isCollapsed}
          extraLibs={extraLibs}
          options={mergedEditorOptions}
        />
      </div>
    </div>
  )
}
