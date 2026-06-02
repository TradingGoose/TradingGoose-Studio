import { useCallback, useEffect, useRef, useState } from 'react'
import { useUpdateNodeInternals } from '@xyflow/react'
import { ChevronDown, ChevronUp, Plus, Trash } from 'lucide-react'
import { useLocale } from 'next-intl'
import type { MonacoDecoration, MonacoEditorHandle } from '@/components/monaco-editor'
import { MonacoEditor } from '@/components/monaco-editor'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { isLikelyReferenceSegment, SYSTEM_REFERENCE_PREFIXES } from '@/lib/workflows/references'
import { useWorkflowEdges, useWorkflowMutations } from '@/lib/yjs/use-workflow-doc'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { normalizeBlockName } from '@/stores/workflows/utils'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useWorkflowBlockEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

const logger = createLogger('ConditionInput')

interface ConditionalBlock {
  id: string
  title: string
  value: string
  showTags: boolean
  showEnvVars: boolean
  searchTerm: string
  cursorPosition: number
  activeSourceBlockId: string | null
}

interface ConditionInputProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
}

export const CONDITION_BRANCH_TITLES = {
  if: 'if',
  elseIf: 'else if',
  else: 'else',
} as const

type ConditionBranchTitle = (typeof CONDITION_BRANCH_TITLES)[keyof typeof CONDITION_BRANCH_TITLES]

// Generate a stable ID based on the blockId and a suffix
const generateStableId = (blockId: string, suffix: string): string => {
  return `${blockId}-${suffix}`
}

const getConditionBranchTitle = (index: number, total: number): ConditionBranchTitle => {
  if (index === 0) {
    return CONDITION_BRANCH_TITLES.if
  }

  if (index === total - 1) {
    return CONDITION_BRANCH_TITLES.else
  }

  return CONDITION_BRANCH_TITLES.elseIf
}

const isElseBranchTitle = (title: string): boolean => title === CONDITION_BRANCH_TITLES.else

const getLocalizedConditionBranchTitle = (locale: LocaleCode, title: string) => {
  switch (title) {
    case CONDITION_BRANCH_TITLES.if:
      return translateWorkflowLabel(locale, 'if')
    case CONDITION_BRANCH_TITLES.elseIf:
      return translateWorkflowLabel(locale, 'elseIf')
    case CONDITION_BRANCH_TITLES.else:
      return translateWorkflowLabel(locale, 'else')
    default:
      return title
  }
}

export const applyConditionBlockTitles = <T extends { title: string }>(blocks: T[]): T[] => {
  return blocks.map((block, index) => ({
    ...block,
    title: getConditionBranchTitle(index, blocks.length),
  }))
}

const updateConditionBlock = (
  blocks: ConditionalBlock[],
  targetBlockId: string,
  updateFn: (block: ConditionalBlock) => ConditionalBlock
): ConditionalBlock[] => {
  return blocks.map((block) => (block.id === targetBlockId ? updateFn(block) : block))
}

export function ConditionInput({
  blockId,
  subBlockId,
  isConnecting,
  isPreview = false,
  previewValue,
  disabled = false,
}: ConditionInputProps) {
  const locale = useLocale() as LocaleCode
  const copy = useWorkflowBlockEditorCopy().conditionInput
  const workspaceId = useWorkspaceId()
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)

  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const editorRefs = useRef<Record<string, MonacoEditorHandle | null>>({})

  const shouldHighlightReference = useCallback(
    (part: string): boolean => {
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
    },
    [accessiblePrefixes]
  )

  const getDecorations = useCallback(
    (value: string): MonacoDecoration[] => {
      if (!value) return []

      const ranges: MonacoDecoration[] = []
      const envVarRegex = /\\{\\{[^}]+\\}\\}/g
      const tagRegex = /<[^>]+>/g
      let match: RegExpExecArray | null

      while ((match = envVarRegex.exec(value)) !== null) {
        ranges.push({
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          className: 'monaco-decoration-env',
        })
      }

      while ((match = tagRegex.exec(value)) !== null) {
        if (shouldHighlightReference(match[0])) {
          ranges.push({
            startOffset: match.index,
            endOffset: match.index + match[0].length,
            className: 'monaco-decoration-reference',
          })
        }
      }

      return ranges
    },
    [shouldHighlightReference]
  )
  const updateNodeInternals = useUpdateNodeInternals()
  const { removeEdge } = useWorkflowMutations()
  const edges = useWorkflowEdges()

  // Use a ref to track the previous store value for comparison
  const prevStoreValueRef = useRef<string | null>(null)
  // Use a ref to track if we're currently syncing from store to prevent loops
  const isSyncingFromStoreRef = useRef(false)
  // Use a ref to track if we've already initialized from store
  const hasInitializedRef = useRef(false)
  // Track previous blockId to detect workflow changes
  const previousBlockIdRef = useRef<string>(blockId)
  const shouldPersistRef = useRef<boolean>(false)

  // Create default blocks with stable IDs
  const createDefaultBlocks = (): ConditionalBlock[] => [
    {
      id: generateStableId(blockId, CONDITION_BRANCH_TITLES.if),
      title: CONDITION_BRANCH_TITLES.if,
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    },
    {
      id: generateStableId(blockId, CONDITION_BRANCH_TITLES.else),
      title: CONDITION_BRANCH_TITLES.else,
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    },
  ]

  // Initialize with a loading state instead of default blocks
  const [conditionalBlocks, setConditionalBlocks] = useState<ConditionalBlock[]>([])
  const [isReady, setIsReady] = useState(false)

  const setConditionalBlock = (
    targetBlockId: string,
    updateFn: (block: ConditionalBlock) => ConditionalBlock
  ) => {
    setConditionalBlocks((blocks) => updateConditionBlock(blocks, targetBlockId, updateFn))
  }

  const focusEditor = (targetBlockId: string, cursorOffset?: number) => {
    setTimeout(() => {
      const editorHandle = editorRefs.current[targetBlockId]
      editorHandle?.focus()
      if (cursorOffset !== undefined) {
        editorHandle?.setCursorOffset(cursorOffset)
      }
    }, 0)
  }

  // Reset initialization state when blockId changes (workflow navigation)
  useEffect(() => {
    if (blockId !== previousBlockIdRef.current) {
      // Reset refs and state for new workflow/block
      hasInitializedRef.current = false
      isSyncingFromStoreRef.current = false
      prevStoreValueRef.current = null
      previousBlockIdRef.current = blockId
      setIsReady(false)
      setConditionalBlocks([])
    }
  }, [blockId])

  // Safely parse JSON with fallback
  const safeParseJSON = (jsonString: string | null): ConditionalBlock[] | null => {
    if (!jsonString) return null
    try {
      const parsed = JSON.parse(jsonString)
      if (!Array.isArray(parsed)) return null

      // Validate that the parsed data has the expected structure
      if (parsed.length === 0 || !('id' in parsed[0]) || !('title' in parsed[0])) {
        return null
      }

      return parsed
    } catch (error) {
      logger.error('Failed to parse JSON:', { error, jsonString })
      return null
    }
  }

  // Sync store value with conditional blocks when storeValue changes
  useEffect(() => {
    // Skip if syncing is already in progress
    if (isSyncingFromStoreRef.current) return

    // Use preview value when in preview mode, otherwise use store value
    const effectiveValue = isPreview ? previewValue : storeValue
    // Convert effectiveValue to string if it's not null
    const effectiveValueStr = effectiveValue !== null ? effectiveValue?.toString() : null

    // Set that we're syncing from store to prevent loops
    isSyncingFromStoreRef.current = true

    try {
      // If effective value is null, and we've already initialized, keep current state
      if (effectiveValueStr === null) {
        if (hasInitializedRef.current) {
          if (!isReady) setIsReady(true)
          isSyncingFromStoreRef.current = false
          return
        }

        setConditionalBlocks(createDefaultBlocks())
        hasInitializedRef.current = true
        setIsReady(true)
        shouldPersistRef.current = false
        isSyncingFromStoreRef.current = false
        return
      }

      if (effectiveValueStr === prevStoreValueRef.current && hasInitializedRef.current) {
        if (!isReady) setIsReady(true)
        isSyncingFromStoreRef.current = false
        return
      }

      prevStoreValueRef.current = effectiveValueStr

      const parsedBlocks = safeParseJSON(effectiveValueStr)

      if (parsedBlocks) {
        setConditionalBlocks(applyConditionBlockTitles(parsedBlocks))
        hasInitializedRef.current = true
        if (!isReady) setIsReady(true)
        shouldPersistRef.current = false
      } else if (!hasInitializedRef.current) {
        setConditionalBlocks(createDefaultBlocks())
        hasInitializedRef.current = true
        setIsReady(true)
        shouldPersistRef.current = false
      }
    } finally {
      setTimeout(() => {
        isSyncingFromStoreRef.current = false
      }, 0)
    }
  }, [storeValue, previewValue, isPreview, blockId, isReady])

  // Update store whenever conditional blocks change
  useEffect(() => {
    if (
      isSyncingFromStoreRef.current ||
      !isReady ||
      conditionalBlocks.length === 0 ||
      isPreview ||
      !shouldPersistRef.current
    )
      return

    const newValue = JSON.stringify(conditionalBlocks)

    if (newValue !== prevStoreValueRef.current) {
      prevStoreValueRef.current = newValue
      setStoreValue(newValue)
      updateNodeInternals(blockId)
    }
  }, [
    conditionalBlocks,
    blockId,
    subBlockId,
    setStoreValue,
    updateNodeInternals,
    isReady,
    isPreview,
  ])

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      hasInitializedRef.current = false
      prevStoreValueRef.current = null
      isSyncingFromStoreRef.current = false
    }
  }, [])

  // Handle drops from connection blocks - updated for individual blocks
  const handleDrop = (blockId: string, e: React.DragEvent) => {
    if (isPreview || disabled) return
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const editorHandle = editorRefs.current[blockId]
      const currentValue = editorHandle?.getEditor()?.getValue() ?? ''
      const dropPosition = editorHandle?.getCursorOffset() ?? currentValue.length

      shouldPersistRef.current = true
      setConditionalBlock(blockId, (block) => ({
        ...block,
        value: `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`,
        showTags: true,
        cursorPosition: dropPosition + 1,
        activeSourceBlockId: data.connectionData?.sourceBlockId || null,
      }))

      focusEditor(blockId, dropPosition + 1)
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  const applyImmediateSelection = (
    targetBlockId: string,
    newValue: string,
    updates: Partial<
      Pick<ConditionalBlock, 'showTags' | 'showEnvVars' | 'searchTerm' | 'activeSourceBlockId'>
    >
  ) => {
    if (isPreview || disabled) return

    const updatedBlocks = updateConditionBlock(conditionalBlocks, targetBlockId, (block) => ({
      ...block,
      value: newValue,
      ...updates,
    }))

    shouldPersistRef.current = true
    setConditionalBlocks(updatedBlocks)
    emitTagSelection(JSON.stringify(updatedBlocks))
    focusEditor(targetBlockId)
  }

  const handleTagSelectImmediate = (blockId: string, newValue: string) => {
    applyImmediateSelection(blockId, newValue, {
      showTags: false,
      activeSourceBlockId: null,
    })
  }

  const handleEnvVarSelectImmediate = (blockId: string, newValue: string) => {
    applyImmediateSelection(blockId, newValue, {
      showEnvVars: false,
      searchTerm: '',
    })
  }

  // Keep block IDs stable as conditions are inserted/reordered.
  const addBlock = (afterId: string) => {
    if (isPreview || disabled) return

    const blockIndex = conditionalBlocks.findIndex((block) => block.id === afterId)
    if (isElseBranchTitle(conditionalBlocks[blockIndex]?.title ?? '')) return

    const newBlockId = generateStableId(blockId, `else-if-${Date.now()}`)

    const newBlock: ConditionalBlock = {
      id: newBlockId,
      title: '',
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    }

    const newBlocks = [...conditionalBlocks]
    newBlocks.splice(blockIndex + 1, 0, newBlock)
    shouldPersistRef.current = true
    setConditionalBlocks(applyConditionBlockTitles(newBlocks))
    focusEditor(newBlock.id)
  }

  const removeBlock = (id: string) => {
    if (isPreview || disabled || conditionalBlocks.length <= 2) return

    // Remove any associated edges before removing the block
    edges.forEach((edge) => {
      if (edge.sourceHandle?.startsWith(`condition-${id}`)) {
        removeEdge(edge.id)
      }
    })

    if (conditionalBlocks.length === 1) return
    shouldPersistRef.current = true
    setConditionalBlocks((blocks) =>
      applyConditionBlockTitles(blocks.filter((block) => block.id !== id))
    )

    setTimeout(() => updateNodeInternals(blockId), 0)
  }

  const moveBlock = (id: string, direction: 'up' | 'down') => {
    if (isPreview || disabled) return

    const blockIndex = conditionalBlocks.findIndex((block) => block.id === id)
    if (blockIndex === -1) return

    if (isElseBranchTitle(conditionalBlocks[blockIndex]?.title ?? '')) return

    if (
      (direction === 'up' && blockIndex === 0) ||
      (direction === 'down' && blockIndex === conditionalBlocks.length - 1)
    )
      return

    const newBlocks = [...conditionalBlocks]
    const targetIndex = direction === 'up' ? blockIndex - 1 : blockIndex + 1

    if (direction === 'down' && isElseBranchTitle(newBlocks[targetIndex]?.title ?? '')) return

    ;[newBlocks[blockIndex], newBlocks[targetIndex]] = [
      newBlocks[targetIndex],
      newBlocks[blockIndex],
    ]
    shouldPersistRef.current = true
    setConditionalBlocks(applyConditionBlockTitles(newBlocks))

    setTimeout(() => updateNodeInternals(blockId), 0)
  }

  // Show loading or empty state if not ready or no blocks
  if (!isReady || conditionalBlocks.length === 0) {
    return (
      <div className='flex min-h-[150px] items-center justify-center text-muted-foreground'>
        {copy.loadingConditions}
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {conditionalBlocks.map((block, index) => (
        <div
          key={block.id}
          className='group relative overflow-visible rounded-lg border bg-background'
        >
          <div
            className={cn(
              'flex h-10 items-center justify-between overflow-hidden bg-card px-3',
              isElseBranchTitle(block.title) ? 'rounded-lg border-0' : 'rounded-t-lg border-b'
            )}
          >
            <span className='font-medium text-sm'>
              {getLocalizedConditionBranchTitle(locale, block.title)}
            </span>
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => addBlock(block.id)}
                    disabled={isPreview || disabled || isElseBranchTitle(block.title)}
                    className='h-8 w-8'
                  >
                    <Plus className='h-4 w-4' />
                    <span className='sr-only'>{copy.addBlock}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copy.addBlock}</TooltipContent>
              </Tooltip>

              <div className='flex items-center'>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => moveBlock(block.id, 'up')}
                      disabled={
                        isPreview || index === 0 || disabled || isElseBranchTitle(block.title)
                      }
                      className='h-8 w-8'
                    >
                      <ChevronUp className='h-4 w-4' />
                      <span className='sr-only'>{copy.moveUp}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copy.moveUp}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => moveBlock(block.id, 'down')}
                      disabled={
                        isPreview ||
                        disabled ||
                        index === conditionalBlocks.length - 1 ||
                        isElseBranchTitle(conditionalBlocks[index + 1]?.title ?? '') ||
                        isElseBranchTitle(block.title)
                      }
                      className='h-8 w-8'
                    >
                      <ChevronDown className='h-4 w-4' />
                      <span className='sr-only'>{copy.moveDown}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copy.moveDown}</TooltipContent>
                </Tooltip>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => removeBlock(block.id)}
                    disabled={isPreview || conditionalBlocks.length === 1 || disabled}
                    className='h-8 w-8 text-destructive hover:text-destructive'
                  >
                    <Trash className='h-4 w-4' />
                    <span className='sr-only'>{copy.deleteBlock}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copy.deleteCondition}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {!isElseBranchTitle(block.title) && (
            <div
              className={cn(
                'relative min-h-[100px] rounded-b-lg bg-background font-mono text-sm',
                isConnecting && 'ring-2 ring-blue-500 ring-offset-2'
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(block.id, e)}
            >
              <div className='relative mt-0 pt-0'>
                <MonacoEditor
                  ref={(instance) => {
                    editorRefs.current[block.id] = instance
                  }}
                  value={block.value}
                  onChange={(newCode) => {
                    if (!isPreview && !disabled) {
                      const editorHandle = editorRefs.current[block.id]
                      const pos = editorHandle?.getCursorOffset() ?? newCode.length

                      const tagTrigger = checkTagTrigger(newCode, pos)
                      const envVarTrigger = checkEnvVarTrigger(newCode, pos)

                      shouldPersistRef.current = true
                      setConditionalBlock(block.id, (currentBlock) => ({
                        ...currentBlock,
                        value: newCode,
                        showTags: tagTrigger.show,
                        showEnvVars: envVarTrigger.show,
                        searchTerm: envVarTrigger.show ? envVarTrigger.searchTerm : '',
                        cursorPosition: pos,
                        activeSourceBlockId: tagTrigger.show
                          ? currentBlock.activeSourceBlockId
                          : null,
                      }))
                    }
                  }}
                  onCursorChange={(offset) => {
                    if (isPreview || disabled) return
                    const currentValue =
                      editorRefs.current[block.id]?.getEditor()?.getValue() ?? block.value
                    const tagTrigger = checkTagTrigger(currentValue, offset)
                    const envVarTrigger = checkEnvVarTrigger(currentValue, offset)

                    setConditionalBlock(block.id, (currentBlock) => ({
                      ...currentBlock,
                      cursorPosition: offset,
                      showTags: tagTrigger.show,
                      showEnvVars: envVarTrigger.show,
                      searchTerm: envVarTrigger.show ? envVarTrigger.searchTerm : '',
                      activeSourceBlockId: tagTrigger.show
                        ? currentBlock.activeSourceBlockId
                        : null,
                    }))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setConditionalBlock(block.id, (currentBlock) => ({
                        ...currentBlock,
                        showTags: false,
                        showEnvVars: false,
                      }))
                    }
                  }}
                  language='javascript'
                  placeholder={block.value.length === 0 ? copy.placeholder : ''}
                  decorations={getDecorations(block.value)}
                  autoHeight
                  minHeight={46}
                  className={cn('focus:outline-none', isPreview && 'cursor-not-allowed opacity-50')}
                  readOnly={isPreview || disabled}
                  options={{
                    lineNumbers: 'on',
                    padding: { top: 8, bottom: 8 },
                  }}
                />

                {block.showEnvVars && (
                  <EnvVarDropdown
                    visible={block.showEnvVars}
                    onSelect={(newValue) => handleEnvVarSelectImmediate(block.id, newValue)}
                    searchTerm={block.searchTerm}
                    inputValue={block.value}
                    cursorPosition={block.cursorPosition}
                    workspaceId={workspaceId}
                    onClose={() => {
                      setConditionalBlock(block.id, (currentBlock) => ({
                        ...currentBlock,
                        showEnvVars: false,
                        searchTerm: '',
                      }))
                    }}
                  />
                )}

                {block.showTags && (
                  <TagDropdown
                    visible={block.showTags}
                    onSelect={(newValue) => handleTagSelectImmediate(block.id, newValue)}
                    blockId={blockId}
                    activeSourceBlockId={block.activeSourceBlockId}
                    inputValue={block.value}
                    cursorPosition={block.cursorPosition}
                    onClose={() => {
                      setConditionalBlock(block.id, (currentBlock) => ({
                        ...currentBlock,
                        showTags: false,
                        activeSourceBlockId: null,
                      }))
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
