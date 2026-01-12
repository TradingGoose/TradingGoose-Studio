'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store-client'

const sanitizeHexColor = (value?: string) => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

interface OutputSelectProps {
  workflowId: string | null
  selectedOutputs: string[]
  onOutputSelect: (outputIds: string[]) => void
  disabled?: boolean
  placeholder?: string
  valueMode?: 'id' | 'label'
  triggerClassName?: string
}

export function OutputSelect({
  workflowId,
  selectedOutputs = [],
  onOutputSelect,
  disabled = false,
  placeholder = 'Select output sources',
  valueMode = 'id',
  triggerClassName,
}: OutputSelectProps) {
  const [isOutputDropdownOpen, setIsOutputDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const [portalStyle, setPortalStyle] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  const blocks = useWorkflowStore((state) => state.blocks)
  const { isShowingDiff, isDiffReady, diffWorkflow } = useWorkflowDiffStore()
  // Find all scrollable ancestors so the dropdown can stay pinned on scroll
  const getScrollableAncestors = (el: HTMLElement | null): (HTMLElement | Window)[] => {
    const ancestors: (HTMLElement | Window)[] = []
    let node: HTMLElement | null = el?.parentElement || null
    const isScrollable = (elem: HTMLElement) => {
      const style = window.getComputedStyle(elem)
      const overflowY = style.overflowY
      const overflow = style.overflow
      const hasScroll = elem.scrollHeight > elem.clientHeight
      return (
        hasScroll &&
        (overflowY === 'auto' ||
          overflowY === 'scroll' ||
          overflow === 'auto' ||
          overflow === 'scroll')
      )
    }

    while (node && node !== document.body) {
      if (isScrollable(node)) ancestors.push(node)
      node = node.parentElement
    }

    // Always include window as a fallback
    ancestors.push(window)
    return ancestors
  }

  // Track subblock store state to ensure proper reactivity
  // Use diff blocks when in diff mode AND diff is ready, otherwise use main blocks
  const workflowBlocks = isShowingDiff && isDiffReady && diffWorkflow ? diffWorkflow.blocks : blocks

  // Get workflow outputs for the dropdown
  const workflowOutputs = useMemo(() => {
    const outputs: {
      id: string
      label: string
      blockId: string
      blockName: string
      blockType: string
      path: string
    }[] = []

    if (!workflowId) return outputs

    // Check if workflowBlocks is defined
    if (!workflowBlocks || typeof workflowBlocks !== 'object') {
      return outputs
    }

    // Check if we actually have blocks to process
    const blockArray = Object.values(workflowBlocks)
    if (blockArray.length === 0) {
      return outputs
    }

    // Process blocks to extract outputs
    blockArray.forEach((block) => {
      if (!block || !block.id || !block.type) {
        return
      }

      const blockConfig = getBlock(block.type)
      if (blockConfig?.category === 'triggers') {
        return
      }

      // Add defensive check to ensure block.name exists and is a string
      const blockName =
        block.name && typeof block.name === 'string'
          ? block.name.replace(/\s+/g, '').toLowerCase()
          : `block-${block.id}`

      // Check for custom response format first
      // In diff mode, get value from diff blocks; otherwise use store
      const outputsToProcess: Record<string, any> = blockConfig?.outputs || {}

      // Add response outputs
      if (Object.keys(outputsToProcess).length > 0) {
        const addOutput = (path: string, outputObj: any, prefix = '') => {
          const fullPath = prefix ? `${prefix}.${path}` : path

          // If not an object or is null, treat as leaf node
          if (typeof outputObj !== 'object' || outputObj === null) {
            const output = {
              id: `${block.id}_${fullPath}`,
              label: `${blockName}.${fullPath}`,
              blockId: block.id,
              blockName: block.name || `Block ${block.id}`,
              blockType: block.type,
              path: fullPath,
            }
            outputs.push(output)
            return
          }

          // If has 'type' property, treat as schema definition (leaf node)
          if ('type' in outputObj && typeof outputObj.type === 'string') {
            const output = {
              id: `${block.id}_${fullPath}`,
              label: `${blockName}.${fullPath}`,
              blockId: block.id,
              blockName: block.name || `Block ${block.id}`,
              blockType: block.type,
              path: fullPath,
            }
            outputs.push(output)
            return
          }

          // For objects without type, recursively add each property
          if (!Array.isArray(outputObj)) {
            Object.entries(outputObj).forEach(([key, value]) => {
              addOutput(key, value, fullPath)
            })
          } else {
            // For arrays, treat as leaf node
            outputs.push({
              id: `${block.id}_${fullPath}`,
              label: `${blockName}.${fullPath}`,
              blockId: block.id,
              blockName: block.name || `Block ${block.id}`,
              blockType: block.type,
              path: fullPath,
            })
          }
        }

        // Process all output properties directly (flattened structure)
        Object.entries(outputsToProcess).forEach(([key, value]) => {
          addOutput(key, value)
        })
      }
    })

    return outputs
  }, [workflowBlocks, workflowId, isShowingDiff, isDiffReady, diffWorkflow, blocks])

  // Utility to check selected by id or label
  const isSelectedValue = (o: { id: string; label: string }) =>
    selectedOutputs.includes(o.id) || selectedOutputs.includes(o.label)

  // Get selected outputs display text
  const selectedOutputsDisplayText = useMemo(() => {
    if (!selectedOutputs || selectedOutputs.length === 0) {
      return placeholder
    }

    // Ensure all selected outputs exist in the workflowOutputs array by id or label
    const validOutputs = selectedOutputs.filter((val) =>
      workflowOutputs.some((o) => o.id === val || o.label === val)
    )

    if (validOutputs.length === 0) {
      return placeholder
    }

    if (validOutputs.length === 1) {
      const output = workflowOutputs.find(
        (o) => o.id === validOutputs[0] || o.label === validOutputs[0]
      )
      if (output) {
        return output.label
      }
      return placeholder
    }

    return `${validOutputs.length} outputs selected`
  }, [selectedOutputs, workflowOutputs, placeholder])

  // Get first selected output info for display icon
  const selectedOutputInfo = useMemo(() => {
    if (!selectedOutputs || selectedOutputs.length === 0) return null

    const validOutputs = selectedOutputs.filter((val) =>
      workflowOutputs.some((o) => o.id === val || o.label === val)
    )
    if (validOutputs.length === 0) return null

    const output = workflowOutputs.find(
      (o) => o.id === validOutputs[0] || o.label === validOutputs[0]
    )
    if (!output) return null

    return {
      blockName: output.blockName,
      blockId: output.blockId,
      blockType: output.blockType,
      path: output.path,
    }
  }, [selectedOutputs, workflowOutputs])

  // Group output options by block
  const groupedOutputs = useMemo(() => {
    const groups: Record<string, typeof workflowOutputs> = {}
    const blockDistances: Record<string, number> = {}
    const edges = useWorkflowStore.getState().edges

    const triggerBlocks = Object.values(blocks).filter((block) => {
      const config = getBlock(block.type)
      return config?.category === 'triggers'
    })

    if (triggerBlocks.length > 0) {
      const adjList: Record<string, string[]> = {}
      for (const edge of edges) {
        if (!adjList[edge.source]) {
          adjList[edge.source] = []
        }
        adjList[edge.source].push(edge.target)
      }

      const visited = new Set<string>()
      const queue: [string, number][] = triggerBlocks.map((block) => [block.id, 0])

      while (queue.length > 0) {
        const [currentNodeId, distance] = queue.shift()!

        if (visited.has(currentNodeId)) continue
        visited.add(currentNodeId)
        blockDistances[currentNodeId] = distance

        const outgoingNodeIds = adjList[currentNodeId] || []
        for (const targetId of outgoingNodeIds) {
          queue.push([targetId, distance + 1])
        }
      }
    }

    // Group by block name
    workflowOutputs.forEach((output) => {
      if (!groups[output.blockName]) {
        groups[output.blockName] = []
      }
      groups[output.blockName].push(output)
    })

    // Convert to array of [blockName, outputs] for sorting
    const groupsArray = Object.entries(groups).map(([blockName, outputs]) => {
      // Find the blockId for this group (using the first output's blockId)
      const blockId = outputs[0]?.blockId
      // Get the distance for this block (or default to 0 if not found)
      const distance = blockId ? blockDistances[blockId] || 0 : 0
      return { blockName, outputs, distance }
    })

    // Sort by distance (descending - furthest first)
    groupsArray.sort((a, b) => b.distance - a.distance)

    // Convert back to record
    return groupsArray.reduce(
      (acc, { blockName, outputs }) => {
        acc[blockName] = outputs
        return acc
      },
      {} as Record<string, typeof workflowOutputs>
    )
  }, [workflowOutputs, blocks])

  // Get block color for an output
  const getOutputColor = (blockType: string) => {
    // Try to get the block's color from its configuration
    const blockConfig = getBlock(blockType)
    return sanitizeHexColor(blockConfig?.bgColor)
  }

  const renderBlockIcon = (blockType: string, blockName: string, color?: string) => {
    const blockConfig = getBlock(blockType)
    const Icon = blockConfig?.icon

    if (Icon) {
      return <Icon className='!h-3.5 !w-3.5' style={{ color: color ?? '#FFFFFF' }} />
    }

    const fallback = blockName?.charAt(0)?.toUpperCase() ?? '?'
    return (
      <div className='font-bold text-xs leading-none' style={{ color: color ?? '#FFFFFF' }}>
        {fallback}
      </div>
    )
  }

  const selectedOutputColor = selectedOutputInfo
    ? getOutputColor(selectedOutputInfo.blockType)
    : undefined

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const insideTrigger = dropdownRef.current?.contains(target)
      const insidePortal = portalRef.current?.contains(target)
      if (!insideTrigger && !insidePortal) {
        setIsOutputDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Position the portal dropdown relative to the trigger button
  useEffect(() => {
    const updatePosition = () => {
      if (!isOutputDropdownOpen || !dropdownRef.current) return
      const rect = dropdownRef.current.getBoundingClientRect()
      const available = Math.max(140, window.innerHeight - rect.bottom - 12)
      const height = Math.min(available, 240)
      setPortalStyle({ top: rect.bottom + 4, left: rect.left, width: rect.width, height })
    }

    let attachedScrollTargets: (HTMLElement | Window)[] = []
    let rafId: number | null = null
    if (isOutputDropdownOpen) {
      updatePosition()
      window.addEventListener('resize', updatePosition)
      attachedScrollTargets = getScrollableAncestors(dropdownRef.current)
      attachedScrollTargets.forEach((target) =>
        target.addEventListener('scroll', updatePosition, { passive: true })
      )
      const loop = () => {
        updatePosition()
        rafId = requestAnimationFrame(loop)
      }
      rafId = requestAnimationFrame(loop)
    }

    return () => {
      window.removeEventListener('resize', updatePosition)
      attachedScrollTargets.forEach((target) =>
        target.removeEventListener('scroll', updatePosition)
      )
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [isOutputDropdownOpen])

  // Handle output selection - toggle selection
  const handleOutputSelection = (value: string) => {
    const emittedValue =
      valueMode === 'label' ? value : workflowOutputs.find((o) => o.label === value)?.id || value
    let newSelectedOutputs: string[]
    const index = selectedOutputs.indexOf(emittedValue)

    if (index === -1) {
      newSelectedOutputs = [...new Set([...selectedOutputs, emittedValue])]
    } else {
      newSelectedOutputs = selectedOutputs.filter((id) => id !== emittedValue)
    }

    onOutputSelect(newSelectedOutputs)
  }

  return (
    <div className='relative w-full' ref={dropdownRef}>
      <button
        type='button'
        onClick={() => setIsOutputDropdownOpen(!isOutputDropdownOpen)}
        className={
          triggerClassName ||
          cn(
            'flex h-9 w-full items-center justify-between rounded-sm px-3 py-1.5 font-normal text-sm shadow-xs transition-colors',
            isOutputDropdownOpen
              ? 'bg-background text-muted-foreground'
              : 'bg-background text-muted-foreground hover:text-muted-foreground'
          )
        }
        disabled={workflowOutputs.length === 0 || disabled}
      >
        {selectedOutputInfo ? (
          <div className='flex w-[calc(100%-24px)] items-center gap-2 overflow-hidden text-left'>
            <div
              className={'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs bg-secondary text-' + selectedOutputColor ? selectedOutputColor : 'foreground'}
              style={{
                backgroundColor: selectedOutputColor ? `${selectedOutputColor}30` : undefined,
              }}
            >
              {renderBlockIcon(
                selectedOutputInfo.blockType,
                selectedOutputInfo.blockName,
                selectedOutputColor
              )}
            </div>
            <span className='truncate text-left'>{selectedOutputsDisplayText}</span>
          </div>
        ) : (
          <div className='flex w-[calc(100%-24px)] items-center gap-2 overflow-hidden text-left'>
            <div className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs bg-muted'>
              <div className='font-bold text-foreground text-xs leading-none'>?</div>
            </div>
            <span className='w-[calc(100%-24px)] truncate text-left'>
              {selectedOutputsDisplayText}
            </span>
          </div>
        )}
        <ChevronDown
          className={`ml-1 h-4 w-4 flex-shrink-0 transition-transform ${isOutputDropdownOpen ? 'rotate-180' : ''}`}
        />
      </button >

      {isOutputDropdownOpen &&
        workflowOutputs.length > 0 &&
        portalStyle &&
        createPortal(
          <div
            ref={portalRef}
            style={{
              position: 'fixed',
              top: portalStyle.top - 1, // overlap border by 1px to avoid visible gap
              left: portalStyle.left,
              width: portalStyle.width,
              zIndex: 2147483647,
              pointerEvents: 'auto',
            }}
            className='mt-0'
            data-rs-scroll-lock-ignore
          >
            <div className='overflow-hidden rounded-sm bg-background pt-1 shadow-xs border border-border'>
              <div
                className='overflow-y-auto overscroll-contain'
                style={{ maxHeight: portalStyle.height }}
                onWheel={(e) => {
                  // Keep wheel scroll inside the dropdown and avoid dialog/body scroll locks
                  e.stopPropagation()
                }}
              >
                {Object.entries(groupedOutputs).map(([blockName, outputs]) => {
                  return (
                    <div key={blockName}>
                      <div className='border-t px-3 pt-1.5 pb-0.5 font-normal text-muted-foreground text-xs first:border-t-0 border-transparent'>
                        {blockName}
                      </div>
                      <div>
                        {outputs.map((output) => {
                          const outputColor = getOutputColor(output.blockType)
                          return (
                            <button
                              type='button'
                              key={output.id}
                              onClick={() => handleOutputSelection(output.label)}
                              className={cn(
                                'flex w-full items-center gap-2 px-3 py-1.5 text-left font-normal text-sm',
                                'hover:bg-card hover:text-accent-foreground',
                                'focus:bg-accent focus:text-accent-foreground focus:outline-none'
                              )}
                            >
                              <div
                                className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs'
                                style={{
                                  backgroundColor: outputColor ? `${outputColor}30` : undefined,
                                  color: outputColor || undefined,
                                }}
                              >
                                {renderBlockIcon(output.blockType, blockName, outputColor)}
                              </div>
                              <span className='flex-1 truncate'>{output.path}</span>
                              {isSelectedValue(output) && (
                                <Check className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div >
  )
}
