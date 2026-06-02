import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Paperclip, Plus, Trash } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { LISTING_IDENTITY_VALUE_TYPE, type ListingInputValue } from '@/lib/listing/identity'
import { cn } from '@/lib/utils'
import type { WorkflowFieldType } from '@/lib/workflows/value-types'
import { useAccessibleReferencePrefixes } from '@/hooks/workflow/use-accessible-reference-prefixes'
import { formatTemplate } from '@/i18n/client-messages'
import { ListingSelectorInput } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/listing-selector/listing-selector'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowBlockEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

type FieldType = WorkflowFieldType

interface Field {
  id: string
  name: string
  type?: FieldType
  value?: unknown
  collapsed?: boolean
}

interface FieldFormatProps {
  blockId: string
  subBlockId: string
  variant?: 'field' | 'input' | 'response'
  isPreview?: boolean
  previewValue?: Field[] | null
  disabled?: boolean
  title?: string
  placeholder?: string
  emptyMessage?: string
  showType?: boolean
  showValue?: boolean
  valuePlaceholder?: string
  isConnecting?: boolean
  config?: any
}

// Default values
const DEFAULT_FIELD: Field = {
  id: crypto.randomUUID(),
  name: '',
  type: 'string',
  value: '',
  collapsed: false,
}

const stringifyFieldValue = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : (JSON.stringify(value, null, 2) ?? '')

export function FieldFormat({
  blockId,
  subBlockId,
  variant = 'field',
  isPreview = false,
  previewValue,
  disabled = false,
  title,
  placeholder,
  emptyMessage,
  showType = true,
  showValue = false,
  valuePlaceholder,
  isConnecting = false,
  config,
}: FieldFormatProps) {
  const copy = useWorkflowBlockEditorCopy().inputFormat
  const resolvedTitle = title ?? copy.fieldTitle
  const resolvedPlaceholder =
    placeholder ??
    (variant === 'response' ? copy.responseFieldPlaceholder : copy.fieldNamePlaceholder)
  const resolvedEmptyMessage =
    emptyMessage ??
    (variant === 'input'
      ? copy.noInputFieldsDefined
      : variant === 'response'
        ? copy.noResponseFieldsDefined
        : copy.noFieldsDefined)
  const resolvedValuePlaceholder =
    valuePlaceholder ??
    (variant === 'response' ? copy.returnValuePlaceholder : copy.testValuePlaceholder)
  const [storeValue, setStoreValue] = useSubBlockValue<Field[]>(blockId, subBlockId)
  const [dragHighlight, setDragHighlight] = useState<Record<string, boolean>>({})
  const valueInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const [localValues, setLocalValues] = useState<Record<string, string>>({})
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const value = isPreview ? previewValue : storeValue
  const fields: Field[] = Array.isArray(value) ? value : []
  const formatAddTitle = (label: string) => formatTemplate(copy.addTitle, { title: label })
  const getFieldTypeLabel = (fieldType?: FieldType) => {
    switch (fieldType) {
      case 'string':
        return copy.stringType
      case 'number':
        return copy.numberType
      case 'boolean':
        return copy.booleanType
      case 'object':
        return copy.objectType
      case LISTING_IDENTITY_VALUE_TYPE:
        return copy.listingIdentityType
      case 'array':
        return copy.arrayType
      case 'files':
        return copy.filesType
      default:
        return fieldType ?? ''
    }
  }

  useEffect(() => {
    const initial: Record<string, string> = {}
    ;(fields || []).forEach((f) => {
      if (localValues[f.id] === undefined) {
        initial[f.id] = stringifyFieldValue(f.value)
      }
    })
    if (Object.keys(initial).length > 0) {
      setLocalValues((prev) => ({ ...prev, ...initial }))
    }
  }, [fields])

  // Field operations
  const addField = () => {
    if (isPreview || disabled) return

    const newField: Field = {
      ...DEFAULT_FIELD,
      id: crypto.randomUUID(),
    }
    setStoreValue([...(fields || []), newField])
  }

  const removeField = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue((fields || []).filter((field: Field) => field.id !== id))
  }

  const validateFieldName = (name: string): string => {
    return name.replace(/[\x00-\x1F"\\]/g, '').trim()
  }

  const handleValueInputChange = (fieldId: string, newValue: string, caretPosition?: number) => {
    setLocalValues((prev) => ({ ...prev, [fieldId]: newValue }))

    const position = typeof caretPosition === 'number' ? caretPosition : newValue.length
    setCursorPosition(position)
    setActiveFieldId(fieldId)
    const trigger = checkTagTrigger(newValue, position)
    setShowTags(trigger.show)
  }

  const handleValueInputBlur = (field: Field) => {
    if (isPreview || disabled) return

    const inputEl = valueInputRefs.current[field.id]
    if (!inputEl) return

    const current = localValues[field.id] ?? inputEl.value ?? ''
    updateField(field.id, 'value', current)
  }

  // Drag and drop handlers for connection blocks
  const handleDragOver = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragHighlight((prev) => ({ ...prev, [fieldId]: true }))
  }

  const handleDragLeave = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [fieldId]: false }))
  }

  const handleDrop = (e: React.DragEvent, fieldId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [fieldId]: false }))
    const input = valueInputRefs.current[fieldId]
    input?.focus()

    if (input) {
      const currentValue =
        localValues[fieldId] ?? stringifyFieldValue(fields.find((f) => f.id === fieldId)?.value)
      const dropPosition = (input as any).selectionStart ?? currentValue.length
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`
      setLocalValues((prev) => ({ ...prev, [fieldId]: newValue }))
      setActiveFieldId(fieldId)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'))
        if (data?.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }
      } catch {}

      setTimeout(() => {
        const el = valueInputRefs.current[fieldId]
        if (el && typeof (el as any).selectionStart === 'number') {
          ;(el as any).selectionStart = dropPosition + 1
          ;(el as any).selectionEnd = dropPosition + 1
        }
      }, 0)
    }
  }

  const handleValueScroll = (fieldId: string, e: React.UIEvent<HTMLInputElement>) => {
    const overlay = overlayRefs.current[fieldId]
    if (overlay) {
      overlay.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const handleValuePaste = (fieldId: string) => {
    setTimeout(() => {
      const input = valueInputRefs.current[fieldId] as HTMLInputElement | undefined
      const overlay = overlayRefs.current[fieldId]
      if (input && overlay) overlay.scrollLeft = input.scrollLeft
    }, 0)
  }

  // Update handlers
  const updateField = (id: string, field: keyof Field, value: any) => {
    if (isPreview || disabled) return

    // Validate field name if it's being updated
    if (field === 'name' && typeof value === 'string') {
      value = validateFieldName(value)
    }

    setStoreValue((fields || []).map((f: Field) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  const toggleCollapse = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue(
      (fields || []).map((f: Field) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f))
    )
  }

  // Field header
  const renderFieldHeader = (field: Field, index: number) => {
    const isUnconfigured = !field.name || field.name.trim() === ''

    return (
      <div
        className='flex h-9 cursor-pointer items-center justify-between px-3 py-1'
        onClick={() => toggleCollapse(field.id)}
      >
        <div className='flex items-center'>
          <span
            className={cn(
              'text-sm',
              isUnconfigured ? 'text-muted-foreground/50' : 'text-foreground'
            )}
          >
            {field.name ? field.name : `${resolvedTitle} ${index + 1}`}
          </span>
          {field.name && showType && (
            <Badge variant='outline' className='ml-2 h-5 bg-muted py-0 font-normal text-xs'>
              {getFieldTypeLabel(field.type)}
            </Badge>
          )}
        </div>
        <div className='flex items-center gap-1' onClick={(e) => e.stopPropagation()}>
          <Button
            variant='ghost'
            size='icon'
            onClick={addField}
            disabled={isPreview || disabled}
            className='h-6 w-6 rounded-full'
          >
            <Plus className='h-3.5 w-3.5' />
            <span className='sr-only'>{formatAddTitle(resolvedTitle)}</span>
          </Button>

          <Button
            variant='ghost'
            size='icon'
            onClick={() => removeField(field.id)}
            disabled={isPreview || disabled}
            className='h-6 w-6 rounded-full text-destructive hover:text-destructive'
          >
            <Trash className='h-3.5 w-3.5' />
            <span className='sr-only'>{copy.deleteField}</span>
          </Button>
        </div>
      </div>
    )
  }

  // Main render
  return (
    <div className='space-y-2'>
      {fields.length === 0 ? (
        <div className='flex flex-col items-center justify-center rounded-md border border-input/50 border-dashed py-8'>
          <p className='mb-3 text-muted-foreground text-sm'>{resolvedEmptyMessage}</p>
          <Button
            variant='outline'
            size='sm'
            onClick={addField}
            disabled={isPreview || disabled}
            className='h-8'
          >
            <Plus className='mr-1.5 h-3.5 w-3.5' />
            {formatAddTitle(resolvedTitle)}
          </Button>
        </div>
      ) : (
        fields.map((field, index) => {
          const isUnconfigured = !field.name || field.name.trim() === ''

          return (
            <div
              key={field.id}
              data-field-id={field.id}
              className={cn(
                'rounded-md border shadow-sm',
                isUnconfigured ? 'border-input/50' : 'border-input',
                field.collapsed ? 'overflow-hidden' : 'overflow-visible'
              )}
            >
              {renderFieldHeader(field, index)}

              {!field.collapsed && (
                <div className='space-y-2 border-t px-3 pt-1.5 pb-2'>
                  <div className='space-y-1.5'>
                    <Label className='text-xs'>{copy.name}</Label>
                    <Input
                      name='name'
                      value={field.name}
                      onChange={(e) => updateField(field.id, 'name', e.target.value)}
                      placeholder={resolvedPlaceholder}
                      disabled={isPreview || disabled}
                      className='h-9 border border-input placeholder:text-muted-foreground/50 dark:border-input/60 dark:bg-background'
                    />
                  </div>

                  {showType && (
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>{copy.type}</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='outline'
                            disabled={isPreview || disabled}
                            className='h-9 w-full justify-between font-normal'
                          >
                            <div className='flex items-center'>
                              <span>{getFieldTypeLabel(field.type)}</span>
                            </div>
                            <ChevronDown className='h-4 w-4 opacity-50' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end' className='w-[200px]'>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'string')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 w-6 text-center font-mono'>Aa</span>
                            <span>{copy.stringType}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'number')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 w-6 text-center font-mono'>123</span>
                            <span>{copy.numberType}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'boolean')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 w-6 text-center font-mono'>0/1</span>
                            <span>{copy.booleanType}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'object')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 w-6 text-center font-mono'>{'{}'}</span>
                            <span>{copy.objectType}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              updateField(field.id, 'type', LISTING_IDENTITY_VALUE_TYPE)
                            }
                            className='cursor-pointer'
                          >
                            <span className='mr-2 w-6 text-center font-mono'>ID</span>
                            <span>{copy.listingIdentityType}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'array')}
                            className='cursor-pointer'
                          >
                            <span className='mr-2 w-6 text-center font-mono'>[]</span>
                            <span>{copy.arrayType}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => updateField(field.id, 'type', 'files')}
                            className='cursor-pointer'
                          >
                            <div className='mr-2 flex w-6 justify-center'>
                              <Paperclip className='h-4 w-4' />
                            </div>
                            <span>{copy.filesType}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  {showValue && (
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>{copy.value}</Label>
                      <div className='relative'>
                        {field.type === 'boolean' ? (
                          <Select
                            value={localValues[field.id] ?? stringifyFieldValue(field.value)}
                            onValueChange={(v) => {
                              setLocalValues((prev) => ({ ...prev, [field.id]: v }))
                              if (!isPreview && !disabled) updateField(field.id, 'value', v)
                            }}
                          >
                            <SelectTrigger className='h-9 w-full justify-between font-normal'>
                              <SelectValue placeholder={copy.selectValue} className='truncate' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='true'>{copy.trueValue}</SelectItem>
                              <SelectItem value='false'>{copy.falseValue}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : field.type === LISTING_IDENTITY_VALUE_TYPE ? (
                          <ListingSelectorInput
                            blockId={blockId}
                            subBlockId={`${subBlockId}-${field.id}`}
                            value={field.value as ListingInputValue}
                            disabled={isPreview || disabled}
                            onChange={(value) => updateField(field.id, 'value', value)}
                          />
                        ) : field.type === 'object' || field.type === 'array' ? (
                          <Textarea
                            ref={(el) => {
                              if (el) valueInputRefs.current[field.id] = el
                            }}
                            name='value'
                            value={localValues[field.id] ?? stringifyFieldValue(field.value)}
                            onChange={(e) =>
                              handleValueInputChange(
                                field.id,
                                e.target.value,
                                e.target.selectionStart ?? undefined
                              )
                            }
                            onBlur={() => handleValueInputBlur(field)}
                            placeholder={
                              field.type === 'object'
                                ? copy.objectValuePlaceholder
                                : copy.arrayValuePlaceholder
                            }
                            disabled={isPreview || disabled}
                            className={cn(
                              'min-h-[120px] border border-input font-mono text-sm placeholder:text-muted-foreground/50 dark:border-input/60 dark:bg-background',
                              dragHighlight[field.id] && 'ring-2 ring-blue-500 ring-offset-2',
                              isConnecting &&
                                config?.connectionDroppable !== false &&
                                'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
                            )}
                            onDrop={(e) => handleDrop(e, field.id)}
                            onDragOver={(e) =>
                              handleDragOver(e as unknown as React.DragEvent, field.id)
                            }
                            onDragLeave={(e) =>
                              handleDragLeave(e as unknown as React.DragEvent, field.id)
                            }
                          />
                        ) : (
                          <>
                            <Input
                              ref={(el) => {
                                if (el) valueInputRefs.current[field.id] = el
                              }}
                              name='value'
                              value={localValues[field.id] ?? stringifyFieldValue(field.value)}
                              onChange={(e) =>
                                handleValueInputChange(
                                  field.id,
                                  e.target.value,
                                  e.target.selectionStart ?? undefined
                                )
                              }
                              onBlur={() => handleValueInputBlur(field)}
                              onDragOver={(e) => handleDragOver(e, field.id)}
                              onDragLeave={(e) => handleDragLeave(e, field.id)}
                              onDrop={(e) => handleDrop(e, field.id)}
                              onScroll={(e) => handleValueScroll(field.id, e)}
                              onPaste={() => handleValuePaste(field.id)}
                              placeholder={resolvedValuePlaceholder}
                              disabled={isPreview || disabled}
                              className={cn(
                                'allow-scroll h-9 w-full overflow-auto border border-input text-transparent caret-foreground placeholder:text-muted-foreground/50 dark:border-input/60 dark:bg-background',
                                dragHighlight[field.id] && 'ring-2 ring-blue-500 ring-offset-2',
                                isConnecting &&
                                  config?.connectionDroppable !== false &&
                                  'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
                              )}
                              style={{ overflowX: 'auto' }}
                            />
                            <div
                              ref={(el) => {
                                if (el) overlayRefs.current[field.id] = el
                              }}
                              className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-3 text-sm'
                              style={{ overflowX: 'auto' }}
                            >
                              <div
                                className='w-full whitespace-pre'
                                style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
                              >
                                {formatDisplayText(
                                  localValues[field.id] ?? stringifyFieldValue(field.value),
                                  accessiblePrefixes
                                    ? { accessiblePrefixes }
                                    : { highlightAll: true }
                                )}
                              </div>
                            </div>
                          </>
                        )}
                        {/* Tag dropdown for response value field */}
                        <TagDropdown
                          visible={showTags && activeFieldId === field.id}
                          onSelect={(newValue) => {
                            setLocalValues((prev) => ({ ...prev, [field.id]: newValue }))
                            if (!isPreview && !disabled) updateField(field.id, 'value', newValue)
                            setShowTags(false)
                            setActiveSourceBlockId(null)
                          }}
                          blockId={blockId}
                          activeSourceBlockId={activeSourceBlockId}
                          inputValue={localValues[field.id] ?? stringifyFieldValue(field.value)}
                          cursorPosition={cursorPosition}
                          onClose={() => setShowTags(false)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

export function InputFormat(
  props: Omit<
    FieldFormatProps,
    'emptyMessage' | 'placeholder' | 'title' | 'valuePlaceholder' | 'variant'
  >
) {
  return <FieldFormat {...props} variant='input' />
}

export function ResponseFormat(
  props: Omit<
    FieldFormatProps,
    | 'emptyMessage'
    | 'placeholder'
    | 'showType'
    | 'showValue'
    | 'title'
    | 'valuePlaceholder'
    | 'variant'
  >
) {
  return <FieldFormat {...props} variant='response' showType={false} showValue={true} />
}

export type { Field as InputField, Field as ResponseField }
