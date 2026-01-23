'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Maximize2,
  Minimize2,
  MoreVertical,
  Plus,
  Trash,
} from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import { MonacoEditor } from '@/components/monaco-editor'
import { createLogger } from '@/lib/logs/console/logger'
import { validateName } from '@/lib/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable, VariableType } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Variables')

type VariablesProps = {
  workflowId?: string
  hideAddButtons?: boolean
}

export function Variables({ workflowId: workflowIdProp, hideAddButtons = false }: VariablesProps = {}) {
  const activeWorkflowId = useWorkflowRegistry((state) => state.getActiveWorkflowId())
  const workflowId = workflowIdProp ?? activeWorkflowId
  const { getVariablesByWorkflowId } = useVariablesStore()
  const {
    collaborativeUpdateVariable,
    collaborativeAddVariable,
    collaborativeDeleteVariable,
    collaborativeDuplicateVariable,
  } = useCollaborativeWorkflow()

  // Get variables for the current workflow
  const workflowVariables = workflowId ? getVariablesByWorkflowId(workflowId) : []

  // Track editor references
  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Track which variables are currently being edited
  const [_activeEditors, setActiveEditors] = useState<Record<string, boolean>>({})

  // Collapsed state per variable
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({})

  const toggleCollapsed = (variableId: string) => {
    setCollapsedById((prev) => ({
      ...prev,
      [variableId]: !prev[variableId],
    }))
  }

  // Handle variable name change with validation
  const handleVariableNameChange = (variableId: string, newName: string) => {
    const validatedName = validateName(newName)
    collaborativeUpdateVariable(variableId, 'name', validatedName)
  }

  const handleAddVariable = () => {
    if (!workflowId) return

    const id = collaborativeAddVariable({
      name: '',
      type: 'string',
      value: '',
      workflowId,
    })

    return id
  }

  const getTypeIcon = (type: VariableType) => {
    switch (type) {
      case 'plain':
        return 'Abc'
      case 'number':
        return '123'
      case 'boolean':
        return '0/1'
      case 'object':
        return '{ }'
      case 'array':
        return '[ ]'
      case 'string':
        return 'Abc'
      default:
        return '?'
    }
  }

  const getPlaceholder = (type: VariableType) => {
    switch (type) {
      case 'plain':
        return 'Plain text value'
      case 'number':
        return '42'
      case 'boolean':
        return 'true'
      case 'object':
        return '{\n  "key": "value"\n}'
      case 'array':
        return '[\n  1,\n  2,\n  3\n]'
      case 'string':
        return 'Plain text value'
      default:
        return ''
    }
  }

  const getEditorLanguage = (type: VariableType) => {
    switch (type) {
      case 'plain':
      case 'string':
        return 'plaintext'
      case 'object':
      case 'array':
      case 'boolean':
      case 'number':
        return 'javascript'
      default:
        return 'plaintext'
    }
  }

  const handleEditorChange = (variable: Variable, newValue: string) => {
    collaborativeUpdateVariable(variable.id, 'value', newValue)
  }

  const handleEditorBlur = (variableId: string) => {
    setActiveEditors((prev) => ({
      ...prev,
      [variableId]: false,
    }))
  }

  const handleEditorFocus = (variableId: string) => {
    setActiveEditors((prev) => ({
      ...prev,
      [variableId]: true,
    }))
  }

  const formatValue = (variable: Variable) => {
    if (variable.value === '') return ''

    return typeof variable.value === 'string' ? variable.value : JSON.stringify(variable.value)
  }

  const getValidationStatus = (variable: Variable): string | undefined => {
    if (variable.value === '') return undefined
    switch (variable.type) {
      case 'number':
        return Number.isNaN(Number(variable.value)) ? 'Not a valid number' : undefined
      case 'boolean':
        return !/^(true|false)$/i.test(String(variable.value).trim())
          ? 'Expected "true" or "false"'
          : undefined
      case 'object':
        try {
          const valueToEvaluate = String(variable.value).trim()

          if (!valueToEvaluate.startsWith('{') || !valueToEvaluate.endsWith('}')) {
            return 'Not a valid object format'
          }

          const parsed = new Function(`return ${valueToEvaluate}`)()

          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'Not a valid object'
          }

          return undefined
        } catch (e) {
          logger.info('Object parsing error:', e)
          return 'Invalid object syntax'
        }
      case 'array':
        try {
          const valueToEvaluate = String(variable.value).trim()

          if (!valueToEvaluate.startsWith('[') || !valueToEvaluate.endsWith(']')) {
            return 'Not a valid array format'
          }

          const parsed = new Function(`return ${valueToEvaluate}`)()

          if (!Array.isArray(parsed)) {
            return 'Not a valid array'
          }

          return undefined
        } catch (e) {
          logger.info('Array parsing error:', e)
          return 'Invalid array syntax'
        }
      default:
        return undefined
    }
  }

  useEffect(() => {
    Object.keys(editorRefs.current).forEach((id) => {
      if (!workflowVariables.some((v) => v.id === id)) {
        delete editorRefs.current[id]
      }
    })
  }, [workflowVariables])

  return (
    <div className='h-full pt-2'>
      {workflowVariables.length === 0 ? (
        hideAddButtons ? (
          <div className='flex h-full items-center justify-center px-4 text-muted-foreground text-sm'>
            No variables defined.
          </div>
        ) : (
          <div className='flex h-full items-center justify-center'>
            <Button
              onClick={handleAddVariable}
              className='h-9 rounded-lg border border-[#E5E5E5] bg-background px-3 py-1.5 font-normal text-muted-foreground text-sm shadow-xs transition-colors hover:text-muted-foreground dark:border-[#414141]  dark:hover:text-muted-foreground'
              variant='outline'
            >
              <Plus className='h-4 w-4' />
              Add variable
            </Button>
          </div>
        )
      ) : (
        <ScrollArea className='h-full' hideScrollbar={false}>
          <div className='space-y-4'>
            {workflowVariables.map((variable) => (
              <div key={variable.id} className='space-y-2'>
                {/* Header: Variable name | Variable type | Options dropdown */}
                <div className='flex items-center gap-2'>
                  <Input
                    className='h-9 flex-1 rounded-lg border-none bg-secondary/50 px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0'
                    placeholder='Variable name'
                    value={variable.name}
                    onChange={(e) => handleVariableNameChange(variable.id, e.target.value)}
                  />

                  {/* Type selector */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <div className='flex h-9 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-secondary/50 px-3'>
                        <span className='font-normal text-sm'>{getTypeIcon(variable.type)}</span>
                        <ChevronDown className='ml-1 h-3 w-3 text-muted-foreground' />
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      className='min-w-32 rounded-lg border-[#E5E5E5] bg-background shadow-xs dark:border-[#414141] '
                    >
                      <DropdownMenuItem
                        onClick={() => collaborativeUpdateVariable(variable.id, 'type', 'plain')}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>Abc</div>
                        <span className='font-[380]'>Plain</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => collaborativeUpdateVariable(variable.id, 'type', 'number')}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>123</div>
                        <span className='font-[380]'>Number</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => collaborativeUpdateVariable(variable.id, 'type', 'boolean')}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>0/1</div>
                        <span className='font-[380]'>Boolean</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => collaborativeUpdateVariable(variable.id, 'type', 'object')}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>{'{}'}</div>
                        <span className='font-[380]'>Object</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => collaborativeUpdateVariable(variable.id, 'type', 'array')}
                        className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <div className='mr-2 w-5 text-center font-[380] text-sm'>[]</div>
                        <span className='font-[380]'>Array</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Options dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-9 w-9 shrink-0 rounded-lg bg-secondary/50 p-0 text-muted-foreground hover:bg-secondary/70 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0'
                      >
                        <MoreVertical className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='end'
                      className='min-w-32 rounded-lg border-[#E5E5E5] bg-background shadow-xs dark:border-[#414141] '
                    >
                      <DropdownMenuItem
                        onClick={() => toggleCollapsed(variable.id)}
                        className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        {(collapsedById[variable.id] ?? false) ? (
                          <Maximize2 className='mr-2 h-4 w-4 text-muted-foreground' />
                        ) : (
                          <Minimize2 className='mr-2 h-4 w-4 text-muted-foreground' />
                        )}
                        {(collapsedById[variable.id] ?? false) ? 'Expand' : 'Collapse'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => collaborativeDuplicateVariable(variable.id)}
                        className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                      >
                        <Copy className='mr-2 h-4 w-4 text-muted-foreground' />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => collaborativeDeleteVariable(variable.id)}
                        className='cursor-pointer rounded-md px-3 py-2 font-[380] text-destructive text-sm hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive'
                      >
                        <Trash className='mr-2 h-4 w-4' />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Value area */}
                {!(collapsedById[variable.id] ?? false) && (
                  <div className='relative rounded-lg bg-secondary/50'>
                    {/* Validation indicator */}
                    {variable.value !== '' && getValidationStatus(variable) && (
                      <div className='absolute top-2 right-2 z-10'>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className='cursor-help'>
                              <AlertTriangle className='h-3 w-3 text-muted-foreground' />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side='bottom' className='max-w-xs'>
                            <p>{getValidationStatus(variable)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}

                    {/* Editor */}
                    <div className='relative overflow-hidden'>
                      <div
                        className='relative min-h-[36px] w-full max-w-full px-3 py-2 font-normal text-sm'
                        ref={(el) => {
                          editorRefs.current[variable.id] = el
                        }}
                        style={{ maxWidth: '100%' }}
                      >
                        {variable.value === '' && (
                          <div className='pointer-events-none absolute inset-0 flex select-none items-start justify-start px-3 py-2 font-[380] text-muted-foreground text-sm leading-normal'>
                            <div style={{ lineHeight: '20px' }}>
                              {getPlaceholder(variable.type)}
                            </div>
                          </div>
                        )}
                        <MonacoEditor
                          key={`editor-${variable.id}-${variable.type}`}
                          value={formatValue(variable)}
                          onChange={(nextValue) => handleEditorChange(variable, nextValue)}
                          onBlur={() => handleEditorBlur(variable.id)}
                          onFocus={() => handleEditorFocus(variable.id)}
                          language={getEditorLanguage(variable.type)}
                          autoHeight
                          minHeight={20}
                          className='w-full font-[380] text-foreground text-sm leading-normal'
                          options={{
                            lineNumbers: 'off',
                            scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
                            padding: { top: 0, bottom: 0 },
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add Variable Button */}
            {!hideAddButtons ? (
              <Button
                onClick={handleAddVariable}
                className='mt-2 h-9 w-full rounded-lg border border-[#E5E5E5] bg-background px-3 py-1.5 font-[380] text-muted-foreground text-sm shadow-xs transition-colors hover:text-muted-foreground dark:border-[#414141]  dark:hover:text-muted-foreground'
                variant='outline'
              >
                <Plus className='h-4 w-4' />
                Add variable
              </Button>
            ) : null}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
