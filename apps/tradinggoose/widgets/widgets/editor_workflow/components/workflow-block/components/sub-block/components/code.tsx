import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { MonacoEditor } from '@/components/monaco-editor'
import type { MonacoDecoration, MonacoEditorHandle } from '@/components/monaco-editor'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { CodeLanguage } from '@/lib/execution/languages'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { isLikelyReferenceSegment, SYSTEM_REFERENCE_PREFIXES } from '@/lib/workflows/references'
import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowId, useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { useWand } from '@/hooks/workflow/use-wand'
import type { GenerationType } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { normalizeBlockName } from '@/stores/workflows/utils'

const logger = createLogger('Code')

interface CodeProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  placeholder?: string
  language?: 'javascript' | 'json' | 'typescript' | 'python' | 'sql' | 'html' | 'plaintext'
  generationType?: GenerationType
  value?: string
  disabled?: boolean
  readOnly?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  showCopyButton?: boolean
  onValidationChange?: (isValid: boolean) => void
  wandConfig: {
    enabled: boolean
    prompt: string
    generationType?: GenerationType
    placeholder?: string
    maintainHistory?: boolean
  }
}



export function Code({
  blockId,
  subBlockId,
  isConnecting,
  placeholder = 'Write JavaScript...',
  language = 'javascript',
  generationType = 'javascript-function-body',
  value: propValue,
  disabled = false,
  readOnly = false,
  collapsible,
  defaultCollapsed = false,
  defaultValue,
  showCopyButton = false,
  onValidationChange,
  wandConfig,
}: CodeProps) {
  const workspaceId = useWorkspaceId()
  const workflowId = useWorkflowId()

  const aiPromptPlaceholder = useMemo(() => {
    switch (generationType) {
      case 'json-schema':
        return 'Describe the JSON schema to generate...'
      case 'json-object':
        return 'Describe the JSON object to generate...'
      default:
        return 'Describe the JavaScript code to generate...'
    }
  }, [generationType])

  const [code, setCode] = useState<string>('')
  const [showTags, setShowTags] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const collapsedStateKey = `${subBlockId}_collapsed`
  const collapsedStoreValue = useSubBlockStore((state) =>
    state.getValue(blockId, collapsedStateKey, workflowId)
  ) as boolean | null
  const isCollapsed = collapsedStoreValue ?? defaultCollapsed ?? false

  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()
  const setCollapsedValue = (blockId: string, subblockId: string, value: any) => {
    collaborativeSetSubblockValue(blockId, subblockId, value)
  }

  useEffect(() => {
    if (defaultCollapsed && (collapsedStoreValue === null || collapsedStoreValue === undefined)) {
      setCollapsedValue(blockId, collapsedStateKey, true)
    }
  }, [blockId, collapsedStateKey, collapsedStoreValue, defaultCollapsed])

  const allowCollapse =
    typeof collapsible === 'boolean'
      ? collapsible
      : subBlockId === 'responseFormat' || subBlockId === 'code'
  const showCollapseButton = allowCollapse && code.split('\n').length > 5

  const isValidJson = useMemo(() => {
    if (subBlockId !== 'responseFormat' || !code.trim()) {
      return true
    }
    try {
      JSON.parse(code)
      return true
    } catch {
      return false
    }
  }, [subBlockId, code])

  useEffect(() => {
    if (onValidationChange && subBlockId === 'responseFormat') {
      const timeoutId = setTimeout(() => {
        onValidationChange(isValidJson)
      }, 150)
      return () => clearTimeout(timeoutId)
    }
  }, [isValidJson, onValidationChange, subBlockId])

  const editorRef = useRef<MonacoEditorHandle | null>(null)

  const toggleCollapsed = () => {
    setCollapsedValue(blockId, collapsedStateKey, !isCollapsed)
  }

  const handleStreamStartRef = useRef<() => void>(() => { })
  const handleGeneratedContentRef = useRef<(generatedCode: string) => void>(() => { })
  const handleStreamChunkRef = useRef<(chunk: string) => void>(() => { })

  const [languageValue] = useSubBlockValue<string>(blockId, 'language')
  const isPythonLanguage = languageValue === CodeLanguage.Python

  const effectiveLanguage = useMemo(() => {
    if (languageValue === CodeLanguage.Python) return 'python'
    if (languageValue === CodeLanguage.JavaScript) return 'javascript'
    return language
  }, [language, languageValue])

  const dynamicPlaceholder = useMemo(() => {
    if (isPythonLanguage) {
      return 'Write Python...'
    }
    return placeholder
  }, [isPythonLanguage, placeholder])

  const dynamicWandConfig = useMemo(() => {
    if (isPythonLanguage) {
      return {
        ...wandConfig,
        prompt: `You are an expert Python programmer.
Generate ONLY the raw body of a Python function based on the user's request.
The code should be executable within a Python function body context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use os.environ or env.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'def my_func(...)') or surrounding braces. Return the final value with 'return'.
4. Imports: You may add imports as needed (standard library or pip-installed packages) without comments.
5. No Markdown: Do NOT include backticks, code fences, or any markdown.
6. Clarity: Write clean, readable Python code.`,
        placeholder: 'Describe the Python function you want to create...',
      }
    }
    return wandConfig
  }, [wandConfig, isPythonLanguage])

  const handleCopy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      logger.error('Failed to copy code', { error })
    }
  }

  const wandHook = useWand({
    wandConfig: readOnly
      ? { ...(wandConfig || { enabled: false, prompt: '' }), enabled: false }
      : wandConfig || { enabled: false, prompt: '' },
    currentValue: code,
    onStreamStart: () => handleStreamStartRef.current?.(),
    onStreamChunk: (chunk: string) => handleStreamChunkRef.current?.(chunk),
    onGeneratedContent: (content: string) => handleGeneratedContentRef.current?.(content),
  })

  const isAiLoading = wandHook?.isLoading || false
  const isAiStreaming = wandHook?.isStreaming || false
  const generateCodeStream = wandHook?.generateStream || (() => { })
  const isPromptVisible = wandHook?.isPromptVisible || false
  const showPromptInline = wandHook?.showPromptInline || (() => { })
  const hidePromptInline = wandHook?.hidePromptInline || (() => { })
  const promptInputValue = wandHook?.promptInputValue || ''
  const updatePromptValue = wandHook?.updatePromptValue || (() => { })
  const cancelGeneration = wandHook?.cancelGeneration || (() => { })

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, false, {
    isStreaming: isAiStreaming,
    onStreamingEnd: () => {
      logger.debug('AI streaming ended, value persisted', { blockId, subBlockId })
    },
  })

  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const persistValue = useCallback(
    (nextValue: string, emitTag = false) => {
      setStoreValue(nextValue)
      if (emitTag) {
        emitTagSelection(nextValue)
      }
    },
    [emitTagSelection, setStoreValue]
  )

  const shouldUseStoreValue = propValue === undefined
  const rawValue = shouldUseStoreValue ? storeValue : propValue ?? code
  const value = rawValue ?? defaultValue ?? ''

  const isReadOnly = readOnly || disabled

  useEffect(() => {
    handleStreamStartRef.current = () => {
      setCode('')
    }

    handleGeneratedContentRef.current = (generatedCode: string) => {
      setCode(generatedCode)
      if (!disabled && !readOnly) {
        persistValue(generatedCode)
      }
    }
  }, [disabled, readOnly, persistValue])

  useEffect(() => {
    if (isAiStreaming) return
    const valueString = value?.toString() ?? ''
    if (valueString !== code) {
      setCode(valueString)
    }
  }, [value, code, isAiStreaming])

  const handleEditorChange = useCallback(
    (newCode: string) => {
      if (isCollapsed || isAiStreaming || isReadOnly) return
      setCode(newCode)
      persistValue(newCode)

      const cursorPos = editorRef.current?.getCursorOffset() ?? 0
      setCursorPosition(cursorPos)

      const tagTrigger = checkTagTrigger(newCode, cursorPos)
      setShowTags(tagTrigger.show)
      if (!tagTrigger.show) {
        setActiveSourceBlockId(null)
      }

      const envVarTrigger = checkEnvVarTrigger(newCode, cursorPos)
      setShowEnvVars(envVarTrigger.show)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
    },
    [isCollapsed, isAiStreaming, isReadOnly, persistValue]
  )

  const handleCursorChange = useCallback(
    (offset: number) => {
      if (isCollapsed || isAiStreaming || isReadOnly) return
      setCursorPosition(offset)
      const currentValue = editorRef.current?.getEditor()?.getValue() ?? code

      const tagTrigger = checkTagTrigger(currentValue, offset)
      setShowTags(tagTrigger.show)
      if (!tagTrigger.show) {
        setActiveSourceBlockId(null)
      }

      const envVarTrigger = checkEnvVarTrigger(currentValue, offset)
      setShowEnvVars(envVarTrigger.show)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
    },
    [code, isCollapsed, isAiStreaming, isReadOnly]
  )


  const handleDrop = (e: React.DragEvent) => {
    if (isReadOnly) return
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return
      const editorHandle = editorRef.current
      const dropPosition = editorHandle?.getCursorOffset() ?? code.length
      editorHandle?.insertTextAtCursor('<')

      const newCursorPosition = dropPosition + 1
      setCursorPosition(newCursorPosition)
      setShowTags(true)
      if (data.connectionData?.sourceBlockId) {
        setActiveSourceBlockId(data.connectionData.sourceBlockId)
      }

      setTimeout(() => {
        editorHandle?.focus()
        editorHandle?.setCursorOffset(newCursorPosition)
      }, 0)
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  const handleTagSelect = (newValue: string) => {
    if (!isReadOnly) {
      setCode(newValue)
      persistValue(newValue, true)
    }
    setShowTags(false)
    setActiveSourceBlockId(null)

    setTimeout(() => {
      editorRef.current?.focus()
    }, 0)
  }

  const handleEnvVarSelect = (newValue: string) => {
    if (!isReadOnly) {
      setCode(newValue)
      persistValue(newValue, true)
    }
    setShowEnvVars(false)

    setTimeout(() => {
      editorRef.current?.focus()
    }, 0)
  }

  const shouldHighlightReference = useCallback((part: string): boolean => {
    if (!part.startsWith('<') || !part.endsWith('>')) {
      return false
    }

    if (!isLikelyReferenceSegment(part)) {
      return false
    }

    if (!accessiblePrefixes) {
      return true
    }

    const inner = part.slice(1, -1)
    const [prefix] = inner.split('.')
    const normalizedPrefix = normalizeBlockName(prefix)

    if (SYSTEM_REFERENCE_PREFIXES.has(normalizedPrefix)) {
      return true
    }

    return accessiblePrefixes.has(normalizedPrefix)
  }, [accessiblePrefixes])

  const decorations = useMemo<MonacoDecoration[]>(() => {
    if (!code) return []

    const ranges: MonacoDecoration[] = []
    const envVarRegex = /\{\{[^}]+\}\}/g
    const tagRegex = /<[^>]+>/g

    let match: RegExpExecArray | null
    while ((match = envVarRegex.exec(code)) !== null) {
      ranges.push({
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        className: 'monaco-decoration-env',
      })
    }

    while ((match = tagRegex.exec(code)) !== null) {
      if (shouldHighlightReference(match[0])) {
        ranges.push({
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          className: 'monaco-decoration-reference',
        })
      }
    }

    return ranges
  }, [code, shouldHighlightReference])


  return (
    <>
      <WandPromptBar
        isVisible={isPromptVisible}
        isLoading={isAiLoading}
        isStreaming={isAiStreaming}
        promptValue={promptInputValue}
        onSubmit={(prompt: string) => generateCodeStream({ prompt })}
        onCancel={isAiStreaming ? cancelGeneration : hidePromptInline}
        onChange={updatePromptValue}
        placeholder={dynamicWandConfig?.placeholder || aiPromptPlaceholder}
      />

      <div
        className={cn(
          'group relative min-h-[100px] rounded-sm bg-background font-mono text-sm transition-colors',
          isConnecting ? 'ring-2 ring-blue-500' : 'border border-input'
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className='absolute top-2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
          {showCopyButton && code && (
            <Button
              variant='ghost'
              size='icon'
              onClick={handleCopy}
              disabled={disabled}
              aria-label='Copy code'
              className='h-8 w-8 rounded-sm text-muted-foreground hover:text-foreground'
            >
              {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
            </Button>
          )}
          {wandConfig?.enabled && !isCollapsed && !isAiStreaming && !readOnly && (
            <Button
              variant='ghost'
              size='icon'
              onClick={isPromptVisible ? hidePromptInline : showPromptInline}
              disabled={isAiLoading || isAiStreaming}
              aria-label='Generate code with AI'
              className='h-8 w-8 rounded-sm text-muted-foreground hover:text-foreground'
            >
              <Wand2 className='h-4 w-4' />
            </Button>
          )}

          {showCollapseButton && !isAiStreaming && (
            <Button
              variant='ghost'
              size='sm'
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? 'Expand code' : 'Collapse code'}
              className='h-8 px-2 text-muted-foreground hover:text-foreground'
            >
              <span className='text-xs'>{isCollapsed ? 'Expand' : 'Collapse'}</span>
            </Button>
          )}
        </div>

        <div
          className={cn(
            'relative mt-0 pt-0',
            isCollapsed && 'max-h-[126px] overflow-hidden',
            isAiStreaming && 'streaming-effect'
          )}
        >
          <MonacoEditor
            ref={editorRef}
            value={code}
            onChange={handleEditorChange}
            onCursorChange={handleCursorChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowTags(false)
                setShowEnvVars(false)
              }
              if (isAiStreaming) {
                e.preventDefault()
              }
            }}
            language={effectiveLanguage ?? 'javascript'}
            placeholder={isCollapsed ? '' : dynamicPlaceholder}
            decorations={decorations}
            autoHeight
            minHeight={106}
            className={cn(
              'code-editor-area',
              'bg-transparent focus:outline-none',
              (isCollapsed || isAiStreaming) && 'cursor-not-allowed opacity-50'
            )}
            readOnly={isReadOnly || isAiStreaming || isCollapsed}
            options={{
              lineNumbers: 'on',
              padding: { top: 8, bottom: 8 },
            }}
          />

        </div>

        {showEnvVars && !isCollapsed && !isAiStreaming && (
          <EnvVarDropdown
            visible={showEnvVars}
            onSelect={handleEnvVarSelect}
            searchTerm={searchTerm}
            inputValue={code}
            cursorPosition={cursorPosition}
            workspaceId={workspaceId}
            onClose={() => {
              setShowEnvVars(false)
              setSearchTerm('')
            }}
          />
        )}

        {showTags && !isCollapsed && !isAiStreaming && (
          <TagDropdown
            visible={showTags}
            onSelect={handleTagSelect}
            blockId={blockId}
            activeSourceBlockId={activeSourceBlockId}
            inputValue={code}
            cursorPosition={cursorPosition}
            onClose={() => {
              setShowTags(false)
              setActiveSourceBlockId(null)
            }}
          />
        )}
      </div>
    </>
  )
}
