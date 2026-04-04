import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { useQueryClient } from '@tanstack/react-query'
import * as Y from 'yjs'
import { AlertTriangle, Code, FileJson } from 'lucide-react'
import type { MonacoEditorHandle } from '@/components/monaco-editor'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { Label } from '@/components/ui/label'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ENTITY_KIND_CUSTOM_TOOL, type ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { useEntitySession } from '@/lib/copilot/review-sessions/entity-session-host'
import { getFieldsMap } from '@/lib/yjs/entity-session'
import { useYjsStringField } from '@/lib/yjs/use-entity-fields'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { SaveErrorAlert } from '@/widgets/widgets/components/save-error-alert'
import { customToolsKeys } from '@/hooks/queries/custom-tools'
import { useWand } from '@/hooks/workflow/use-wand'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { WandPromptBar } from '@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar'
import { CodeEditor } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor'

const logger = createLogger('CustomToolEditor')

export type CustomToolEditorSection = 'schema' | 'code'

interface CustomToolSchema {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: {
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

interface CustomToolEditorProps {
  workspaceId: string
  descriptor: ReviewTargetDescriptor
  activeSection: CustomToolEditorSection
  blockId: string
  onSectionChange: (section: CustomToolEditorSection) => void
  saveRef: MutableRefObject<() => void>
  yjsDoc: Y.Doc
  onReviewTargetChange?: (descriptor: ReviewTargetDescriptor | null) => void
}

export function CustomToolEditor({
  workspaceId,
  descriptor,
  activeSection,
  blockId,
  onSectionChange,
  saveRef,
  yjsDoc,
  onReviewTargetChange,
}: CustomToolEditorProps) {
  const queryClient = useQueryClient()
  const entitySession = useEntitySession()

  const schemaYText = yjsDoc ? getFieldsMap(yjsDoc).get('schemaText') : null
  const codeYText = yjsDoc ? getFieldsMap(yjsDoc).get('codeText') : null

  const [, setTitle] = useYjsStringField(yjsDoc, 'title', '')
  const [jsonSchema, setJsonSchema] = useYjsStringField(yjsDoc, 'schemaText', '')
  const [functionCode, setFunctionCode] = useYjsStringField(yjsDoc, 'codeText', '')
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const codeEditorRef = useRef<HTMLDivElement>(null)
  const codeEditorHandleRef = useRef<MonacoEditorHandle | null>(null)
  const schemaParamsDropdownRef = useRef<HTMLDivElement>(null)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [showSchemaParams, setShowSchemaParams] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const [schemaParamSelectedIndex, setSchemaParamSelectedIndex] = useState(0)
  const jsonSchemaRef = useLatestRef(jsonSchema)
  const functionCodeRef = useLatestRef(functionCode)

  useEffect(() => {
    setSchemaError(null)
    setCodeError(null)
    setSaveError(null)
  }, [descriptor.reviewSessionId])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        schemaParamsDropdownRef.current &&
        !schemaParamsDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSchemaParams(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const validateJsonSchema = (value: string): CustomToolSchema | null => {
    if (!value.trim()) {
      setSchemaError(null)
      return null
    }

    try {
      const parsed = JSON.parse(value) as CustomToolSchema

      if (!parsed.type || parsed.type !== 'function') {
        setSchemaError('Missing "type": "function"')
        return null
      }

      if (!parsed.function || !parsed.function.name) {
        setSchemaError('Missing function.name field')
        return null
      }

      if (!parsed.function.parameters) {
        setSchemaError('Missing function.parameters object')
        return null
      }

      if (!parsed.function.parameters.type) {
        setSchemaError('Missing parameters.type field')
        return null
      }

      if (parsed.function.parameters.properties === undefined) {
        setSchemaError('Missing parameters.properties field')
        return null
      }

      if (
        typeof parsed.function.parameters.properties !== 'object' ||
        parsed.function.parameters.properties === null
      ) {
        setSchemaError('parameters.properties must be an object')
        return null
      }

      setSchemaError(null)
      setTitle(parsed.function.name)
      return parsed
    } catch {
      setSchemaError('Invalid JSON format')
      return null
    }
  }

  const handleJsonSchemaChange = (value: string) => {
    setJsonSchema(value)
    validateJsonSchema(value)
  }

  const handleFunctionCodeChange = (value: string) => {
    setFunctionCode(value)
    if (codeError) {
      setCodeError(null)
    }
  }

  const schemaGeneration = useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      prompt: `You are an expert programmer specializing in creating OpenAI function calling format JSON schemas for custom tools.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON schema MUST follow this specific format:
1. Top-level property "type" must be set to "function"
2. A "function" object containing:
   - "name": A concise, camelCase name for the function
   - "description": A clear description of what the function does
   - "parameters": A JSON Schema object describing the function's parameters with:
     - "type": "object"
     - "properties": An object containing parameter definitions
     - "required": An array of required parameter names

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.`,
      placeholder: 'Describe the function parameters and structure...',
      generationType: 'custom-tool-schema',
    },
    currentValue: jsonSchema,
    onGeneratedContent: (content) => {
      handleJsonSchemaChange(content)
      setSchemaError(null)
    },
    onStreamChunk: (chunk) => {
      const nextSchema = `${jsonSchemaRef.current}${chunk}`
      jsonSchemaRef.current = nextSchema
      setJsonSchema(nextSchema)
      validateJsonSchema(nextSchema)
    },
  })

  const codeGeneration = useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      prompt: `You are an expert JavaScript programmer.
Generate ONLY the raw body of a JavaScript function based on the user's request.
The code should be executable within an 'async function(params, environmentVariables) {...}' context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Current code: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>.
3. Function Body ONLY: Do NOT include the function signature.
4. Imports: Do NOT include external imports.
5. Output: Ensure the code returns a value if the function is expected to produce output.
6. Clarity: Write clean, readable code.
7. No Explanations: Do NOT include markdown formatting or extra commentary.`,
      placeholder: 'Describe the JavaScript function to generate...',
      generationType: 'javascript-function-body',
    },
    currentValue: functionCode,
    onGeneratedContent: (content) => {
      handleFunctionCodeChange(content)
      setCodeError(null)
    },
    onStreamChunk: (chunk) => {
      const nextCode = `${functionCodeRef.current}${chunk}`
      functionCodeRef.current = nextCode
      setFunctionCode(nextCode)
      if (codeError) {
        setCodeError(null)
      }
    },
  })

  useEffect(() => {
    if (activeSection === 'schema') {
      codeGeneration.hidePromptInline()
      setShowEnvVars(false)
      setShowTags(false)
      setShowSchemaParams(false)
      setActiveSourceBlockId(null)
      setSearchTerm('')
      return
    }

    schemaGeneration.hidePromptInline()
  }, [activeSection, codeGeneration, schemaGeneration])

  const schemaParameters = useMemo(() => {
    try {
      if (!jsonSchema) return []
      const parsed = JSON.parse(jsonSchema)
      const properties = parsed?.function?.parameters?.properties
      if (!properties) return []

      return Object.keys(properties).map((key) => ({
        name: key,
        type: properties[key].type || 'any',
        description: properties[key].description || '',
        required: parsed?.function?.parameters?.required?.includes(key) || false,
      }))
    } catch {
      return []
    }
  }, [jsonSchema])

  const isSchemaValid = useMemo(() => {
    if (!jsonSchema) return false

    try {
      const parsed = JSON.parse(jsonSchema)
      return Boolean(
        parsed.type === 'function' &&
          parsed.function?.name &&
          parsed.function?.parameters?.type &&
          parsed.function?.parameters?.properties !== undefined
      )
    } catch {
      return false
    }
  }, [jsonSchema])

  const handleSave = useCallback(async () => {
    setSchemaError(null)
    setCodeError(null)
    setSaveError(null)

    if (!descriptor.reviewSessionId) {
      setSaveError('Missing review session.')
      return
    }

    if (!jsonSchema) {
      setSchemaError('Schema cannot be empty')
      onSectionChange('schema')
      return
    }

    try {
      const schema = JSON.parse(jsonSchema) as CustomToolSchema

      if (!schema.type || schema.type !== 'function') {
        setSchemaError('Schema must have a "type" field set to "function"')
        onSectionChange('schema')
        return
      }

      if (!schema.function || !schema.function.name) {
        setSchemaError('Schema must have a "function" object with a "name" field')
        onSectionChange('schema')
        return
      }

      if (!schema.function.parameters) {
        setSchemaError('Missing function.parameters object')
        onSectionChange('schema')
        return
      }

      if (!schema.function.parameters.type) {
        setSchemaError('Missing parameters.type field')
        onSectionChange('schema')
        return
      }

      if (schema.function.parameters.properties === undefined) {
        setSchemaError('Missing parameters.properties field')
        onSectionChange('schema')
        return
      }

      if (
        typeof schema.function.parameters.properties !== 'object' ||
        schema.function.parameters.properties === null
      ) {
        setSchemaError('parameters.properties must be an object')
        onSectionChange('schema')
        return
      }

      const nextToolName = schema.function.name
      const existingTools = useCustomToolsStore.getState().getAllTools(workspaceId)
      const isDuplicate = existingTools.some((tool) => {
        if (descriptor.entityId && tool.id === descriptor.entityId) {
          return false
        }

        return tool.title === nextToolName || tool.schema.function.name === nextToolName
      })

      if (isDuplicate) {
        setSchemaError(`A tool with the name "${nextToolName}" already exists`)
        onSectionChange('schema')
        return
      }

      setIsSaving(true)
      setTitle(nextToolName)

      const response = await fetch('/api/copilot/review-entities/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityKind: ENTITY_KIND_CUSTOM_TOOL,
          workspaceId,
          reviewSessionId: descriptor.reviewSessionId,
          draftSessionId: descriptor.draftSessionId ?? undefined,
          customTool: {
            id: descriptor.entityId ?? undefined,
            schema,
            code: functionCode || '',
          },
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save custom tool.')
      }

      await queryClient.invalidateQueries({ queryKey: customToolsKeys.list(workspaceId) })
      if (payload?.reviewTarget) {
        onReviewTargetChange?.(payload.reviewTarget as ReviewTargetDescriptor)
      }
    } catch (error) {
      logger.error('Error saving custom tool:', { error })
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save custom tool. Please try again.'
      )
      onSectionChange('schema')
    } finally {
      setIsSaving(false)
    }
  }, [
    descriptor.draftSessionId,
    descriptor.entityId,
    descriptor.reviewSessionId,
    functionCode,
    jsonSchema,
    onSectionChange,
    onReviewTargetChange,
    queryClient,
    setTitle,
    workspaceId,
  ])

  useEffect(() => {
    saveRef.current = () => {
      void handleSave()
    }
  }, [handleSave, saveRef])

  const handleCursorChange = (
    offset: number,
    coords: { top: number; left: number; height: number } | null
  ) => {
    const currentValue = codeEditorHandleRef.current?.getEditor()?.getValue() ?? functionCode

    setCursorPosition(offset)

    if (coords && codeEditorRef.current) {
      const editorRect = codeEditorRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: coords.top + coords.height + 4,
        left: Math.min(coords.left, editorRect.width - 260),
      })
    }

    if (codeGeneration.isStreaming) {
      setShowEnvVars(false)
      setShowTags(false)
      setShowSchemaParams(false)
      setSearchTerm('')
      return
    }

    const envVarTrigger = checkEnvVarTrigger(currentValue, offset)
    setShowEnvVars(envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

    const tagTrigger = checkTagTrigger(currentValue, offset)
    setShowTags(tagTrigger.show)
    if (!tagTrigger.show) {
      setActiveSourceBlockId(null)
    }

    if (schemaParameters.length === 0) {
      return
    }

    const beforeCursor = currentValue.substring(0, offset)
    const words = beforeCursor.split(/[\s=();,{}[\]]+/)
    const currentWord = words[words.length - 1] || ''

    if (currentWord.length > 0 && /^[a-zA-Z_][\w]*$/.test(currentWord)) {
      const hasMatches = schemaParameters.some((param) =>
        param.name.toLowerCase().startsWith(currentWord.toLowerCase())
      )
      setShowSchemaParams(hasMatches)
      if (hasMatches) {
        setSchemaParamSelectedIndex(0)
      }
      return
    }

    setShowSchemaParams(false)
  }

  const handleSchemaParamSelect = (paramName: string) => {
    const editorHandle = codeEditorHandleRef.current
    const currentValue = editorHandle?.getEditor()?.getValue() ?? functionCode
    const beforeCursor = currentValue.substring(0, cursorPosition)
    const afterCursor = currentValue.substring(cursorPosition)
    const words = beforeCursor.split(/[\s=();,{}[\]]+/)
    const currentWord = words[words.length - 1] || ''
    const wordStart = beforeCursor.lastIndexOf(currentWord)
    const nextValue = beforeCursor.substring(0, wordStart) + paramName + afterCursor

    setFunctionCode(nextValue)
    setShowSchemaParams(false)
    setCursorPosition(wordStart + paramName.length)

    setTimeout(() => {
      editorHandle?.focus()
      editorHandle?.setCursorOffset(wordStart + paramName.length)
    }, 0)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (activeSection === 'schema' && schemaGeneration.isPromptVisible) {
        schemaGeneration.hidePromptInline()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (activeSection === 'code' && codeGeneration.isPromptVisible) {
        codeGeneration.hidePromptInline()
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (showEnvVars || showTags || showSchemaParams) {
        setShowEnvVars(false)
        setShowTags(false)
        setShowSchemaParams(false)
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    if (
      (activeSection === 'schema' && schemaGeneration.isStreaming) ||
      (activeSection === 'code' && codeGeneration.isStreaming)
    ) {
      event.preventDefault()
      return
    }

    if (showSchemaParams && schemaParameters.length > 0) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          event.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.min(prev + 1, schemaParameters.length - 1))
          return
        case 'ArrowUp':
          event.preventDefault()
          event.stopPropagation()
          setSchemaParamSelectedIndex((prev) => Math.max(prev - 1, 0))
          return
        case 'Escape':
          event.preventDefault()
          event.stopPropagation()
          setShowSchemaParams(false)
          return
      }
    }

    if ((showEnvVars || showTags) && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  if (activeSection === 'schema') {
    return (
      <div className='flex h-full w-full flex-col overflow-hidden p-3'>
        <WandPromptBar
          isVisible={schemaGeneration.isPromptVisible}
          isLoading={schemaGeneration.isLoading}
          isStreaming={schemaGeneration.isStreaming}
          promptValue={schemaGeneration.promptInputValue}
          onSubmit={(prompt: string) => schemaGeneration.generateStream({ prompt })}
          onCancel={
            schemaGeneration.isStreaming
              ? schemaGeneration.cancelGeneration
              : schemaGeneration.hidePromptInline
          }
          onChange={schemaGeneration.updatePromptValue}
          placeholder='Describe the JSON schema to generate...'
          className='!top-0 relative mb-2'
        />

        <div className='flex min-h-0 flex-1 flex-col'>
          <div className='mb-2 flex min-h-6 items-center gap-1'>
            <FileJson className='h-4 w-4' />
            <Label htmlFor='json-schema' className='font-medium'>
              Tool Config
            </Label>
            {!isSchemaValid && schemaError && !schemaGeneration.isStreaming ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className='h-4 w-4 cursor-pointer text-destructive' />
                </TooltipTrigger>
                <TooltipContent side='top'>
                  <p>{schemaError}</p>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          <div className='min-h-0 flex-1'>
            <CodeEditor
              value={jsonSchema}
              onChange={handleJsonSchemaChange}
              language='json'
              height='100%'
              minHeight='0'
              yText={schemaYText instanceof Y.Text ? schemaYText : null}
              awareness={entitySession?.awareness}
              showWandButton={true}
              onWandClick={() => {
                if (schemaGeneration.isPromptVisible) {
                  schemaGeneration.hidePromptInline()
                } else {
                  schemaGeneration.showPromptInline()
                }
              }}
              wandButtonDisabled={schemaGeneration.isLoading || schemaGeneration.isStreaming}
              placeholder={`{
  "type": "function",
  "function": {
    "name": "addItemToOrder",
    "description": "Add one quantity of a food item to the order.",
    "parameters": {
      "type": "object",
      "properties": {
        "itemName": {
          "type": "string",
          "description": "The name of the food item to add to order"
        }
      },
      "required": ["itemName"]
    }
  }
}`}
              className={cn(
                (schemaGeneration.isLoading || schemaGeneration.isStreaming) &&
                  'cursor-not-allowed opacity-50'
              )}
              disabled={schemaGeneration.isLoading || schemaGeneration.isStreaming || isSaving}
              onKeyDown={handleKeyDown}
            />
          </div>

          <SaveErrorAlert error={saveError} className='mt-3' />
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden p-3'>
      <WandPromptBar
        isVisible={codeGeneration.isPromptVisible}
        isLoading={codeGeneration.isLoading}
        isStreaming={codeGeneration.isStreaming}
        promptValue={codeGeneration.promptInputValue}
        onSubmit={(prompt: string) => codeGeneration.generateStream({ prompt })}
        onCancel={
          codeGeneration.isStreaming
            ? codeGeneration.cancelGeneration
            : codeGeneration.hidePromptInline
        }
        onChange={codeGeneration.updatePromptValue}
        placeholder='Describe the JavaScript code to generate...'
        className='!top-0 relative mb-2'
      />

      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='mb-1 flex min-h-6 items-center justify-between'>
          <div className='flex items-center gap-1'>
            <Code className='h-4 w-4' />
            <Label htmlFor='function-code' className='font-medium'>
              Tool Code
            </Label>
          </div>
          {codeError && !codeGeneration.isStreaming ? (
            <div className='ml-4 break-words text-red-600 text-sm'>{codeError}</div>
          ) : null}
        </div>

        {schemaParameters.length > 0 ? (
          <div className='mb-2 rounded-md bg-muted/50 p-2'>
            <p className='text-muted-foreground text-xs'>
              <span className='font-medium'>Available parameters:</span>{' '}
              {schemaParameters.map((param, index) => (
                <span key={param.name}>
                  <code className='rounded bg-background px-1 py-0.5 text-foreground'>
                    {param.name}
                  </code>
                  {index < schemaParameters.length - 1 ? ', ' : ''}
                </span>
              ))}
              {'. '}Start typing a parameter name for autocomplete.
            </p>
          </div>
        ) : null}

        <div ref={codeEditorRef} className='relative min-h-0 flex-1 rounded-md'>
          <CodeEditor
            value={functionCode}
            onChange={handleFunctionCodeChange}
            language='javascript'
            editorHandleRef={codeEditorHandleRef}
            onCursorChange={handleCursorChange}
            yText={codeYText instanceof Y.Text ? codeYText : null}
            awareness={entitySession?.awareness}
            showWandButton={true}
            onWandClick={() => {
              if (codeGeneration.isPromptVisible) {
                codeGeneration.hidePromptInline()
              } else {
                codeGeneration.showPromptInline()
              }
            }}
            wandButtonDisabled={codeGeneration.isLoading || codeGeneration.isStreaming}
            placeholder='// This code will be executed when the tool is called.'
            height='100%'
            minHeight='0'
            className={cn(
              codeError && !codeGeneration.isStreaming ? 'border-red-500' : '',
              (codeGeneration.isLoading || codeGeneration.isStreaming) &&
                'cursor-not-allowed opacity-50'
            )}
            highlightVariables={true}
            disabled={codeGeneration.isLoading || codeGeneration.isStreaming || isSaving}
            onKeyDown={handleKeyDown}
            schemaParameters={schemaParameters}
          />

          {showEnvVars ? (
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={(nextValue: string) => {
                setFunctionCode(nextValue)
                setShowEnvVars(false)
              }}
              searchTerm={searchTerm}
              inputValue={functionCode}
              cursorPosition={cursorPosition}
              workspaceId={workspaceId}
              onClose={() => {
                setShowEnvVars(false)
                setSearchTerm('')
              }}
              className='w-64'
              style={{
                position: 'absolute',
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
              }}
            />
          ) : null}

          {showTags ? (
            <TagDropdown
              visible={showTags}
              onSelect={(nextValue: string) => {
                setFunctionCode(nextValue)
                setShowTags(false)
                setActiveSourceBlockId(null)
              }}
              blockId={blockId}
              activeSourceBlockId={activeSourceBlockId}
              inputValue={functionCode}
              cursorPosition={cursorPosition}
              onClose={() => {
                setShowTags(false)
                setActiveSourceBlockId(null)
              }}
              className='w-64'
              style={{
                position: 'absolute',
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
              }}
            />
          ) : null}

          {showSchemaParams && schemaParameters.length > 0 ? (
            <div
              ref={schemaParamsDropdownRef}
              className='absolute z-[9999] mt-1 w-64 overflow-visible rounded-md border bg-popover shadow-md'
              style={{
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
              }}
            >
              <div className='py-1'>
                <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>
                  Available Parameters
                </div>
                <div>
                  {schemaParameters.map((param, index) => (
                    <button
                      key={param.name}
                      onClick={() => handleSchemaParamSelect(param.name)}
                      onMouseEnter={() => setSchemaParamSelectedIndex(index)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                        'hover:bg-card hover:text-accent-foreground',
                        'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                        index === schemaParamSelectedIndex && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <div
                        className='flex h-5 w-5 items-center justify-center rounded'
                        style={{ backgroundColor: '#2F8BFF' }}
                      >
                        <span className='h-3 w-3 font-bold text-white text-xs'>P</span>
                      </div>
                      <span className='flex-1 truncate'>{param.name}</span>
                      <span className='text-muted-foreground text-xs'>{param.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <SaveErrorAlert error={saveError} className='mt-3' />
      </div>
    </div>
  )
}
