import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Wand2 } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useWebhookManagement } from '@/hooks/use-webhook-management'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { useWand } from '@/hooks/workflow/use-wand'
import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ShortInput')

const useOptionalReactFlow = () => {
  try {
    return useReactFlow()
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('[React Flow]: Seems like you have not used zustand provider')
    ) {
      return null
    }
    throw error
  }
}

interface ShortInputProps {
  placeholder?: string
  password?: boolean
  inputId?: string
  blockId: string
  subBlockId: string
  isConnecting: boolean
  config: SubBlockConfig
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  readOnly?: boolean
  showCopyButton?: boolean
  useWebhookUrl?: boolean
  workspaceId?: string
  enableTags?: boolean
  forceEnvVarDropdown?: boolean
}

export function ShortInput({
  blockId,
  subBlockId,
  placeholder,
  password,
  inputId,
  isConnecting,
  config,
  onChange,
  value: propValue,
  disabled = false,
  readOnly = false,
  showCopyButton = false,
  useWebhookUrl = false,
  workspaceId,
  enableTags = true,
  forceEnvVarDropdown = false,
}: ShortInputProps) {
  // Local state for immediate UI updates during streaming
  const [localContent, setLocalContent] = useState<string>('')
  const setStoreValueRef = useRef<((value: string) => void) | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [copied, setCopied] = useState(false)

  const webhookManagement = useWebhookManagement({
    blockId,
    triggerId: undefined,
    useWebhookUrl,
  })

  // Wand functionality (only if wandConfig is enabled)
  const wandHook = config.wandConfig?.enabled
    ? useWand({
        wandConfig: config.wandConfig,
        currentValue: localContent,
        onStreamStart: () => {
          // Clear the content when streaming starts
          setLocalContent('')
        },
        onStreamChunk: (chunk) => {
          // Update local content with each chunk as it arrives
          setLocalContent((current) => current + chunk)
        },
        onGeneratedContent: (content) => {
          // Final content update
          setLocalContent(content)
          if (!disabled) {
            // Persist the generated content to the store after streaming
            setStoreValueRef.current?.(content)
          }
        },
      })
    : null
  // State management - useSubBlockValue with explicit streaming control
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, false, {
    isStreaming: wandHook?.isStreaming || false,
    onStreamingEnd: () => {
      logger.debug('Wand streaming ended, value persisted', { blockId, subBlockId })
    },
  })
  setStoreValueRef.current = setStoreValue

  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)

  const emitTagSelection = useTagSelection(blockId, subBlockId)

  const workflowRoute = useOptionalWorkflowRoute()
  const resolvedWorkspaceId = workspaceId ?? workflowRoute?.workspaceId

  // Get ReactFlow instance for zoom control (optional outside ReactFlow providers)
  const reactFlowInstance = useOptionalReactFlow()

  const baseValue = propValue !== undefined ? propValue : storeValue

  // During streaming, use local content; otherwise use base value
  const value = wandHook?.isStreaming ? localContent : baseValue

  const effectiveValue =
    useWebhookUrl && webhookManagement.webhookUrl ? webhookManagement.webhookUrl : value

  const isNumericInput = config.inputType === 'number'
  const numericStep = isNumericInput ? (config.step ?? (config.integer ? 1 : undefined)) : undefined
  const numericInputMode =
    isNumericInput && (config.integer || numericStep === 1 || numericStep === undefined)
      ? 'numeric'
      : 'decimal'

  // Sync local content with base value when not streaming
  useEffect(() => {
    if (!wandHook?.isStreaming) {
      const baseValueString = baseValue?.toString() ?? ''
      if (baseValueString !== localContent) {
        setLocalContent(baseValueString)
      }
    }
  }, [baseValue, wandHook?.isStreaming])

  // Update store value during streaming (but won't persist until streaming ends)
  useEffect(() => {
    if (wandHook?.isStreaming && localContent !== '') {
      if (!disabled) {
        setStoreValue(localContent)
      }
    }
  }, [localContent, wandHook?.isStreaming, disabled, setStoreValue])

  // Check if this input is API key related
  const isApiKeyField = useMemo(() => {
    if (forceEnvVarDropdown) return true
    const normalizedId = config?.id?.replace(/\s+/g, '').toLowerCase() || ''
    const normalizedTitle = config?.title?.replace(/\s+/g, '').toLowerCase() || ''

    // Check for common API key naming patterns
    const apiKeyPatterns = [
      'apikey',
      'api_key',
      'api-key',
      'secretkey',
      'secret_key',
      'secret-key',
      'token',
      'access_token',
      'auth_token',
      'secret',
      'password',
    ]

    return apiKeyPatterns.some(
      (pattern) =>
        normalizedId === pattern ||
        normalizedTitle === pattern ||
        normalizedId.includes(pattern) ||
        normalizedTitle.includes(pattern)
    )
  }, [config?.id, config?.title, forceEnvVarDropdown])

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Don't allow changes if disabled
    if (disabled || readOnly) {
      e.preventDefault()
      return
    }

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    if (onChange) {
      onChange(newValue)
    } else {
      setStoreValue(newValue)
    }

    setCursorPosition(newCursorPosition)

    // Check for environment variables trigger
    const envVarTrigger = checkEnvVarTrigger(newValue, newCursorPosition)

    // For API key fields, always show dropdown when typing (without requiring {{ trigger)
    if (isApiKeyField && isFocused && !readOnly) {
      // Only show dropdown if there's text to filter by or the field is empty
      const shouldShowDropdown = newValue.trim() !== '' || newValue === ''
      setShowEnvVars(shouldShowDropdown)
      // For API key style fields, keep the picker broad unless user types {{... explicitly.
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
    } else {
      // Normal behavior for non-API key fields
      setShowEnvVars(envVarTrigger.show)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
    }

    // Check for tag trigger
    if (enableTags && !readOnly) {
      const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
      setShowTags(tagTrigger.show)
    }
  }

  // Sync scroll position between input and overlay
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  // Remove the auto-scroll effect that forces cursor position and replace with natural scrolling
  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [value])

  // Handle paste events to ensure long values are handled correctly
  const handlePaste = (_e: React.ClipboardEvent<HTMLInputElement>) => {
    // Let the paste happen normally
    // Then ensure scroll positions are synced after the content is updated
    setTimeout(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft
      }
    }, 0)
  }

  // Handle wheel events to control ReactFlow zoom
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    if (!reactFlowInstance) {
      return true
    }
    // Only handle zoom when Ctrl/Cmd key is pressed
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()

      // Get current zoom level and viewport
      const currentZoom = reactFlowInstance.getZoom()
      const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

      // Calculate zoom factor based on wheel delta
      // Use a smaller factor for smoother zooming that matches ReactFlow's native behavior
      const delta = e.deltaY > 0 ? 1 : -1
      // Using 0.98 instead of 0.95 makes the zoom much slower and more gradual
      const zoomFactor = 0.96 ** delta

      // Calculate new zoom level with min/max constraints
      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 1)

      // Get the position of the cursor in the page
      const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      })

      // Calculate the new viewport position to keep the cursor position fixed
      const newViewportX = viewportX + (pointerX * currentZoom - pointerX * newZoom)
      const newViewportY = viewportY + (pointerY * currentZoom - pointerY * newZoom)

      // Set the new viewport with the calculated position and zoom
      reactFlowInstance.setViewport(
        {
          x: newViewportX,
          y: newViewportY,
          zoom: newZoom,
        },
        { duration: 0 }
      )

      return false
    }

    // For regular scrolling (without Ctrl/Cmd), let the default behavior happen
    // Don't interfere with normal scrolling
    return true
  }

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      // Get current cursor position or append to end
      const dropPosition = inputRef.current?.selectionStart ?? value?.toString().length ?? 0

      // Insert '<' at drop position to trigger the dropdown
      const currentValue = value?.toString() ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      // Focus the input first
      inputRef.current?.focus()

      // Update all state in a single batch
      Promise.resolve().then(() => {
        // Update value through onChange if provided, otherwise use store
        if (onChange) {
          onChange(newValue)
        } else {
          setStoreValue(newValue)
        }

        setCursorPosition(dropPosition + 1)
        if (enableTags) {
          setShowTags(true)
        }

        // Pass the source block ID from the dropped connection
        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        // Set cursor position after state updates
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = dropPosition + 1
            inputRef.current.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  // Handle key combinations
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowEnvVars(false)
      if (enableTags) {
        setShowTags(false)
      }
      return
    }

    // For API key fields, show env vars when clearing with keyboard shortcuts
    if (
      isApiKeyField &&
      (e.key === 'Delete' || e.key === 'Backspace') &&
      inputRef.current?.selectionStart === 0 &&
      inputRef.current?.selectionEnd === value?.toString().length
    ) {
      setTimeout(() => setShowEnvVars(true), 0)
    }
  }

  // Value display logic
  const displayValue =
    password && !isFocused
      ? '•'.repeat(effectiveValue?.toString().length ?? 0)
      : (effectiveValue?.toString() ?? '')

  // Explicitly mark environment variable references with '{{' and '}}' when inserting
  const handleEnvVarSelect = (newValue: string) => {
    // For API keys, ensure we're using the full value with {{ }} format
    if (isApiKeyField && !newValue.startsWith('{{')) {
      newValue = `{{${newValue}}}`
    }

    if (onChange) {
      onChange(newValue)
    } else {
      emitTagSelection(newValue)
    }
  }

  const handleTagSelect = (newValue: string) => {
    if (onChange) {
      onChange(newValue)
      return
    }
    emitTagSelection(newValue)
  }

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const handleCopy = async () => {
    const textToCopy = useWebhookUrl ? webhookManagement.webhookUrl : effectiveValue?.toString()
    if (!textToCopy) return
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      logger.error('Failed to copy text', { error })
    }
  }

  return (
    <>
      <WandPromptBar
        isVisible={wandHook?.isPromptVisible || false}
        isLoading={wandHook?.isLoading || false}
        isStreaming={wandHook?.isStreaming || false}
        promptValue={wandHook?.promptInputValue || ''}
        onSubmit={(prompt: string) => wandHook?.generateStream({ prompt }) || undefined}
        onCancel={
          wandHook?.isStreaming
            ? wandHook?.cancelGeneration
            : wandHook?.hidePromptInline || (() => {})
        }
        onChange={(value: string) => wandHook?.updatePromptValue?.(value)}
        placeholder={config.wandConfig?.placeholder || 'Describe what you want to generate...'}
      />

      <div className='group relative w-full'>
        <Input
          ref={inputRef}
          id={inputId}
          className={cn(
            'allow-scroll w-full overflow-auto text-transparent caret-foreground [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground/50 [&::-webkit-scrollbar]:hidden',
            isConnecting &&
              config?.connectionDroppable !== false &&
              'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500',
            showCopyButton && wandHook ? 'pr-20' : showCopyButton ? 'pr-12' : undefined
          )}
          placeholder={placeholder ?? ''}
          inputMode={isNumericInput ? numericInputMode : undefined}
          min={isNumericInput ? config.min : undefined}
          max={isNumericInput ? config.max : undefined}
          step={numericStep}
          value={displayValue}
          onChange={handleChange}
          onFocus={() => {
            setIsFocused(true)

            // If this is an API key field, automatically show env vars dropdown
            if (isApiKeyField && !readOnly) {
              setShowEnvVars(true)
              setSearchTerm('')

              // Set cursor position to the end of the input
              const inputLength = value?.toString().length ?? 0
              setCursorPosition(inputLength)
            } else {
              setShowEnvVars(false)
              setShowTags(false)
              setSearchTerm('')
            }
          }}
          onBlur={() => {
            setIsFocused(false)
            setShowEnvVars(false)
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onScroll={handleScroll}
          onPaste={handlePaste}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          autoComplete='off'
          type='text'
          style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          disabled={disabled}
          readOnly={readOnly}
        />
        <div
          ref={overlayRef}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-3 text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div
            className='w-full whitespace-pre'
            style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
          >
            {password && !isFocused
              ? '•'.repeat(effectiveValue?.toString().length ?? 0)
              : formatDisplayText(effectiveValue?.toString() ?? '', {
                  accessiblePrefixes,
                  highlightAll: !accessiblePrefixes,
                })}
          </div>
        </div>

        <div className='-translate-y-1/2 absolute top-1/2 right-1 z-10 flex items-center gap-1'>
          {showCopyButton && effectiveValue && (
            <Button
              variant='ghost'
              size='icon'
              onClick={handleCopy}
              disabled={disabled}
              aria-label='Copy value'
              className='h-8 w-8 rounded-sm border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:bg-muted hover:text-foreground hover:shadow'
            >
              {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
            </Button>
          )}

          {/* Wand Button */}
          {wandHook && !wandHook.isStreaming && !readOnly && (
            <Button
              variant='ghost'
              size='icon'
              onClick={
                wandHook.isPromptVisible ? wandHook.hidePromptInline : wandHook.showPromptInline
              }
              disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
              aria-label='Generate content with AI'
              className='h-8 w-8 rounded-sm border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:bg-muted hover:text-foreground hover:shadow'
            >
              <Wand2 className='h-4 w-4' />
            </Button>
          )}
        </div>

        {!wandHook?.isStreaming && (
          <>
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={handleEnvVarSelect}
              searchTerm={searchTerm}
              inputValue={value?.toString() ?? ''}
              cursorPosition={cursorPosition}
              workspaceId={resolvedWorkspaceId}
              onClose={() => {
                setShowEnvVars(false)
                setSearchTerm('')
              }}
            />
            {enableTags && (
              <TagDropdown
                visible={showTags}
                onSelect={handleTagSelect}
                blockId={blockId}
                activeSourceBlockId={activeSourceBlockId}
                inputValue={value?.toString() ?? ''}
                cursorPosition={cursorPosition}
                onClose={() => {
                  setShowTags(false)
                  setActiveSourceBlockId(null)
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  )
}
