'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { useOptionalWorkflowRoute } from '@/app/workspace/[workspaceId]/w/[workflowId]/context/workflow-route-context'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import type { EnvironmentVariable as StoreEnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentVariables')

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr),minmax(0,1fr),88px] gap-4'

const generateRowId = (() => {
  let counter = 0
  return () => {
    counter += 1
    return Date.now() + counter
  }
})()

const createEmptyEnvVar = (): UIEnvironmentVariable => ({
  key: '',
  value: '',
  id: generateRowId(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const getMaskedValue = (value: string): string => {
  const source = value || ''
  if (!source) return ''

  const prefixLength = Math.min(4, source.length)
  const suffixLength = Math.min(4, source.length - prefixLength)
  const prefix = source.slice(0, prefixLength)
  const suffix = source.slice(source.length - suffixLength)

  const maskedLength = Math.max(source.length - (prefixLength + suffixLength), 3)
  if (maskedLength <= 0) return `${prefix}${suffix}`

  return `${prefix}${'.'.repeat(maskedLength)}${suffix}`
}

const formatDateTime = (value?: string) => {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value))
  } catch {
    return '—'
  }
}

interface UIEnvironmentVariable extends StoreEnvironmentVariable {
  id?: number
  createdAt?: string
  updatedAt?: string
}

interface EnvironmentVariablesProps {
  onOpenChange?: (open: boolean) => void
  registerCloseHandler?: (handler: (open: boolean) => void) => void
  workspaceId?: string
  variant?: 'modal' | 'page'
  searchTerm?: string
  onSearchTermChange?: (value: string) => void
  keyScope?: 'workspace' | 'personal'
  onLoadingChange?: (isLoading: boolean) => void
}

export interface EnvironmentVariablesHandle {
  addVariable: (scope?: 'workspace' | 'personal') => void
  saveChanges: () => Promise<void>
}

const EnvironmentVariablesComponent = (
  {
    onOpenChange,
    registerCloseHandler,
    workspaceId: workspaceIdProp,
    variant = 'modal',
    searchTerm: controlledSearchTerm,
    onSearchTermChange,
    keyScope = 'workspace',
    onLoadingChange,
  }: EnvironmentVariablesProps,
  ref: Ref<EnvironmentVariablesHandle>
) => {
  const params = useParams<{ workspaceId: string }>()
  const workflowRoute = useOptionalWorkflowRoute()
  const workspaceId = workspaceIdProp ?? workflowRoute?.workspaceId ?? params?.workspaceId
  const isModalVariant = variant === 'modal'
  const isPageVariant = variant === 'page'
  const {
    variables,
    isLoading,
    loadWorkspaceEnvironment,
    upsertWorkspaceEnvironment,
    removeWorkspaceEnvironmentKeys,
  } = useEnvironmentStore()
  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false)
  const [workspaceVars, setWorkspaceVars] = useState<UIEnvironmentVariable[]>([])
  const [conflicts, setConflicts] = useState<string[]>([])
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true)
  const initialWorkspaceVarsRef = useRef<UIEnvironmentVariable[]>([])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingClose = useRef(false)
  const initialVarsRef = useRef<UIEnvironmentVariable[]>([])
  const [internalSearchTerm, setInternalSearchTerm] = useState('')
  const resolvedSearchTerm = controlledSearchTerm ?? internalSearchTerm
  const handleSearchTermChange = onSearchTermChange ?? setInternalSearchTerm
  const [revealedValues, setRevealedValues] = useState<Record<number, boolean>>({})
  const [copiedVarId, setCopiedVarId] = useState<number | null>(null)
  const [editingVarId, setEditingVarId] = useState<number | null>(null)
  const [editingScope, setEditingScope] = useState<'workspace' | 'personal'>('personal')
  const [editingKeyName, setEditingKeyName] = useState('')
  const [editingValue, setEditingValue] = useState('')
  const editValueInputRef = useRef<HTMLInputElement | null>(null)

  const filteredEnvVars = useMemo(() => {
    if (!resolvedSearchTerm.trim()) {
      return envVars.map((envVar, index) => ({ envVar, originalIndex: index }))
    }

    return envVars
      .map((envVar, index) => ({ envVar, originalIndex: index }))
      .filter(({ envVar }) =>
        envVar.key.toLowerCase().includes(resolvedSearchTerm.toLowerCase())
      )
  }, [envVars, resolvedSearchTerm])

  const filteredWorkspaceVars = useMemo(() => {
    if (!resolvedSearchTerm.trim()) {
      return workspaceVars.map((envVar, index) => ({ envVar, originalIndex: index }))
    }

    return workspaceVars
      .map((envVar, index) => ({ envVar, originalIndex: index }))
      .filter(({ envVar }) =>
        envVar.key.toLowerCase().includes(resolvedSearchTerm.toLowerCase())
      )
  }, [workspaceVars, resolvedSearchTerm])

  const personalHeaderMarginClass = useMemo(() => {
    if (!resolvedSearchTerm.trim()) return 'mt-8'
    return filteredWorkspaceVars.length > 0 ? 'mt-8' : 'mt-0'
  }, [resolvedSearchTerm, filteredWorkspaceVars])

  const hasChanges = useMemo(() => {
    const toMap = (vars: UIEnvironmentVariable[]) =>
      new Map(vars.filter((v) => v.key || v.value).map((v) => [v.key, v.value]))

    const initialPersonal = toMap(initialVarsRef.current)
    const currentPersonal = toMap(envVars)
    if (initialPersonal.size !== currentPersonal.size) return true
    for (const [key, value] of currentPersonal) {
      if (initialPersonal.get(key) !== value) return true
    }
    for (const key of initialPersonal.keys()) {
      if (!currentPersonal.has(key)) return true
    }

    const initialWorkspace = toMap(initialWorkspaceVarsRef.current)
    const currentWorkspace = toMap(workspaceVars)
    if (initialWorkspace.size !== currentWorkspace.size) return true
    for (const [key, value] of currentWorkspace) {
      if (initialWorkspace.get(key) !== value) return true
    }
    for (const key of initialWorkspace.keys()) {
      if (!currentWorkspace.has(key)) return true
    }

    return false
  }, [envVars, workspaceVars])

  const workspaceKeySet = useMemo(
    () =>
      new Set(workspaceVars.map((envVar) => envVar.key).filter((key) => key.length > 0)),
    [workspaceVars]
  )
  const isBusy = isLoading || isWorkspaceLoading
  const hasConflicts = useMemo(() => {
    return envVars.some((envVar) => !!envVar.key && workspaceKeySet.has(envVar.key))
  }, [envVars, workspaceKeySet])
  const footerJustifyClass = isModalVariant ? 'justify-between' : 'justify-end'

  const handleModalClose = (open: boolean) => {
    if (!isModalVariant) {
      onOpenChange?.(open)
      return
    }

    if (!open && hasChanges) {
      setShowUnsavedChanges(true)
      pendingClose.current = true
    } else {
      onOpenChange?.(open)
    }
  }

  useEffect(() => {
    const existingVars = Object.values(variables)
    const initialVars = existingVars.length
      ? existingVars.map((envVar) => ({
        ...envVar,
        id: generateRowId(),
      }))
      : [createEmptyEnvVar()]
    initialVarsRef.current = JSON.parse(JSON.stringify(initialVars))
    setEnvVars(JSON.parse(JSON.stringify(initialVars)))
    pendingClose.current = false
  }, [variables])

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isBusy)
    }
  }, [isBusy, onLoadingChange])

  useEffect(() => {
    let mounted = true
      ; (async () => {
        if (!workspaceId) {
          setIsWorkspaceLoading(false)
          return
        }
        setIsWorkspaceLoading(true)
        try {
          const data = await loadWorkspaceEnvironment(workspaceId)
          if (!mounted) return
          const toUIVariables = (
            input: Record<string, string>,
            meta?: { createdAt?: string | null; updatedAt?: string | null }
          ) =>
            Object.entries(input || {}).map(([key, value]) => ({
              key,
              value,
              id: generateRowId(),
              createdAt: meta?.createdAt ?? undefined,
              updatedAt: meta?.updatedAt ?? meta?.createdAt ?? undefined,
            }))

          const workspaceList = toUIVariables(data.workspace || {}, data.workspaceMeta)
          const personalList = toUIVariables(data.personal || {}, data.personalMeta)

          setWorkspaceVars(workspaceList)
          initialWorkspaceVarsRef.current = JSON.parse(JSON.stringify(workspaceList))
          if (personalList.length) {
            setEnvVars(personalList)
            initialVarsRef.current = JSON.parse(JSON.stringify(personalList))
          }
          setConflicts(data.conflicts || [])
        } finally {
          if (mounted) {
            setIsWorkspaceLoading(false)
          }
        }
      })()
    return () => {
      mounted = false
    }
  }, [workspaceId, loadWorkspaceEnvironment])

  useEffect(() => {
    if (!isModalVariant) return
    if (registerCloseHandler) {
      registerCloseHandler(handleModalClose)
    }
  }, [registerCloseHandler, hasChanges, isModalVariant])

  useEffect(() => {
    if (shouldScrollToBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
      setShouldScrollToBottom(false)
    }
  }, [shouldScrollToBottom])

  useEffect(() => {
    const personalKeys = envVars.map((envVar) => envVar.key.trim()).filter((key) => key.length > 0)

    const uniquePersonalKeys = Array.from(new Set(personalKeys))

    const workspaceKeys = new Set(
      workspaceVars.map((envVar) => envVar.key.trim()).filter((key) => key.length > 0)
    )
    const computedConflicts = uniquePersonalKeys.filter((key) => workspaceKeys.has(key))

    setConflicts((prev) => {
      if (prev.length === computedConflicts.length) {
        const sameKeys = prev.every((key) => computedConflicts.includes(key))
        if (sameKeys) return prev
      }
      return computedConflicts
    })
  }, [envVars, workspaceVars])

  const addVariable = (scope?: 'workspace' | 'personal') => {
    const targetScope = scope ?? (isPageVariant ? keyScope : 'personal')
    const newVar = createEmptyEnvVar()
    if (targetScope === 'workspace') {
      setWorkspaceVars((prev) => [...prev, newVar])
    } else {
      setEnvVars((prev) => [...prev, newVar])
    }
    handleSearchTermChange('')
    setShouldScrollToBottom(true)
  }

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newEnvVars = [...envVars]
    newEnvVars[index][field] = value
    newEnvVars[index].updatedAt = new Date().toISOString()
    setEnvVars(newEnvVars)
  }

  const updateWorkspaceVar = (index: number, field: 'key' | 'value', value: string) => {
    const next = [...workspaceVars]
    next[index][field] = value
    next[index].updatedAt = new Date().toISOString()
    setWorkspaceVars(next)
  }

  const removeEnvVar = (index: number) => {
    const newEnvVars = envVars.filter((_, i) => i !== index)
    setEnvVars(newEnvVars.length ? newEnvVars : [createEmptyEnvVar()])
  }

  const removeWorkspaceVar = (index: number) => {
    const next = workspaceVars.filter((_, i) => i !== index)
    setWorkspaceVars(next.length ? next : [createEmptyEnvVar()])
  }

  const removeVarById = (scope: 'workspace' | 'personal', id: number) => {
    if (scope === 'workspace') {
      setWorkspaceVars((prev) => {
        const next = prev.filter((item) => item.id !== id)
        return next.length ? next : [createEmptyEnvVar()]
      })
    } else {
      setEnvVars((prev) => {
        const next = prev.filter((item) => item.id !== id)
        return next.length ? next : [createEmptyEnvVar()]
      })
    }
  }

  const toggleReveal = (id: number) => {
    setRevealedValues((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const handleCopyValue = async (value: string, id: number) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedVarId(id)
      setTimeout(() => setCopiedVarId(null), 1800)
    } catch (error) {
      logger.error('Failed to copy environment variable', error)
    }
  }

  const startEditingVar = (scope: 'workspace' | 'personal', envVar: UIEnvironmentVariable) => {
    if (!envVar.id) return
    setEditingScope(scope)
    setEditingVarId(envVar.id)
    setEditingKeyName(envVar.key)
    setEditingValue(envVar.value)
    setTimeout(() => {
      editValueInputRef.current?.focus()
    }, 0)
  }

  const cancelEditingVar = () => {
    setEditingVarId(null)
    setEditingKeyName('')
    setEditingValue('')
  }

  const commitEditingVar = () => {
    if (!editingVarId) return
    const isWorkspace = editingScope === 'workspace'
    const applyUpdate = (item: UIEnvironmentVariable): UIEnvironmentVariable =>
      item.id === editingVarId
        ? {
          ...item,
          key: editingKeyName,
          value: editingValue,
          updatedAt: new Date().toISOString(),
        }
        : item

    if (isWorkspace) {
      setWorkspaceVars((prev) => prev.map(applyUpdate))
    } else {
      setEnvVars((prev) => prev.map(applyUpdate))
    }

    cancelEditingVar()
  }
  const handleValueFocus = (index: number, e: React.FocusEvent<HTMLInputElement>) => {
    setFocusedValueIndex(index)
    e.target.scrollLeft = 0
  }

  const handleValueClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.currentTarget.scrollLeft = 0
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = e.clipboardData.getData('text').trim()
    if (!text) return

    const lines = text.split('\n').filter((line) => line.trim())
    if (lines.length === 0) return

    e.preventDefault()

    const inputType = (e.target as HTMLInputElement).getAttribute('data-input-type') as
      | 'key'
      | 'value'

    if (inputType) {
      const hasValidEnvVarPattern = lines.some((line) => {
        const equalIndex = line.indexOf('=')
        if (equalIndex === -1 || equalIndex === 0) return false

        const potentialKey = line.substring(0, equalIndex).trim()
        const envVarPattern = /^[A-Za-z_][A-Za-z0-9_]*$/
        return envVarPattern.test(potentialKey)
      })

      if (!hasValidEnvVarPattern) {
        handleSingleValuePaste(text, index, inputType)
        return
      }
    }

    handleKeyValuePaste(lines)
  }

  const handleSingleValuePaste = (text: string, index: number, inputType: 'key' | 'value') => {
    const newEnvVars = [...envVars]
    newEnvVars[index][inputType] = text
    setEnvVars(newEnvVars)
  }

  const handleKeyValuePaste = (lines: string[]) => {
    const parsedVars = lines
      .map((line) => {
        const equalIndex = line.indexOf('=')

        if (equalIndex === -1 || equalIndex === 0) {
          return null
        }

        const potentialKey = line.substring(0, equalIndex).trim()

        const envVarPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

        if (!envVarPattern.test(potentialKey)) {
          return null
        }

        const key = potentialKey
        const value = line.substring(equalIndex + 1).trim()

        return {
          key,
          value,
          id: generateRowId(),
        }
      })
      .filter((parsed): parsed is NonNullable<typeof parsed> => parsed !== null)
      .filter(({ key, value }) => key && value)

    if (parsedVars.length > 0) {
      const existingVars = envVars.filter((v) => v.key || v.value)
      setEnvVars([...existingVars, ...parsedVars])
      setShouldScrollToBottom(true)
    }
  }

  const handleCancel = () => {
    setEnvVars(JSON.parse(JSON.stringify(initialVarsRef.current)))
    setWorkspaceVars(JSON.parse(JSON.stringify(initialWorkspaceVarsRef.current)))
    setShowUnsavedChanges(false)
    if (pendingClose.current && isModalVariant) {
      onOpenChange?.(false)
    }
  }

  const handleSave = async () => {
    try {
      setShowUnsavedChanges(false)
      if (isModalVariant) {
        onOpenChange?.(false)
      }
      setIsWorkspaceLoading(true)

      const toRecord = (vars: UIEnvironmentVariable[]) =>
        vars
          .filter((v) => v.key && v.value)
          .reduce(
            (acc, { key, value }) => ({
              ...acc,
              [key]: value,
            }),
            {}
          )

      const validVariables = toRecord(envVars)
      await useEnvironmentStore.getState().saveEnvironmentVariables(validVariables)

      const before = toRecord(initialWorkspaceVarsRef.current)
      const after = toRecord(workspaceVars)
      const toUpsert: Record<string, string> = {}
      const toDelete: string[] = []

      for (const [k, v] of Object.entries(after)) {
        if (!(k in before) || before[k] !== v) {
          toUpsert[k] = v
        }
      }
      for (const k of Object.keys(before)) {
        if (!(k in after)) toDelete.push(k)
      }

      if (workspaceId) {
        if (Object.keys(toUpsert).length) {
          await upsertWorkspaceEnvironment(workspaceId, toUpsert)
        }
        if (toDelete.length) {
          await removeWorkspaceEnvironmentKeys(workspaceId, toDelete)
        }
      }

      initialWorkspaceVarsRef.current = JSON.parse(JSON.stringify(workspaceVars))
    } catch (error) {
      logger.error('Failed to save environment variables:', error)
    } finally {
      setIsWorkspaceLoading(false)
    }
  }

  useImperativeHandle(ref, () => ({
    addVariable,
    saveChanges: handleSave,
  }))

  const renderEnvVarRow = (envVar: UIEnvironmentVariable, originalIndex: number) => {
    const isConflict = !!envVar.key && workspaceKeySet.has(envVar.key)
    return (
      <>
        <div className={`${GRID_COLS} items-center`}>
          <Input
            data-input-type='key'
            value={envVar.key}
            onChange={(e) => updateEnvVar(originalIndex, 'key', e.target.value)}
            onPaste={(e) => handlePaste(e, originalIndex)}
            placeholder='API_KEY'
            name={`env_variable_name_${envVar.id || originalIndex}_${Math.random()}`}
            autoComplete='off'
            autoCapitalize='off'
            spellCheck='false'
            readOnly
            onFocus={(e) => e.target.removeAttribute('readOnly')}
            className={`h-9 rounded-sm border-none px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isConflict ? 'border border-red-500 bg-[#F6D2D2] outline-none ring-0 disabled:bg-[#F6D2D2] disabled:opacity-100 dark:bg-[#442929] disabled:dark:bg-[#442929]' : 'bg-muted'}`}
          />
          <Input
            data-input-type='value'
            value={envVar.value}
            onChange={(e) => updateEnvVar(originalIndex, 'value', e.target.value)}
            type={focusedValueIndex === originalIndex ? 'text' : 'password'}
            onFocus={(e) => {
              if (!isConflict) {
                e.target.removeAttribute('readOnly')
                handleValueFocus(originalIndex, e)
              }
            }}
            onClick={handleValueClick}
            onBlur={() => setFocusedValueIndex(null)}
            onPaste={(e) => handlePaste(e, originalIndex)}
            placeholder={isConflict ? 'Workspace override active' : 'Enter value'}
            disabled={isConflict}
            aria-disabled={isConflict}
            name={`env_variable_value_${envVar.id || originalIndex}_${Math.random()}`}
            autoComplete='new-password'
            autoCapitalize='off'
            spellCheck='false'
            readOnly={isConflict}
            className={`allow-scroll h-9 rounded-sm border-none px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isConflict ? 'cursor-not-allowed border border-red-500 bg-[#F6D2D2] outline-none ring-0 disabled:bg-[#F6D2D2] disabled:opacity-100 dark:bg-[#442929] disabled:dark:bg-[#442929]' : 'bg-muted'}`}
          />
          <div className='flex items-center justify-end gap-2'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  disabled={!envVar.key || !envVar.value || isConflict || !workspaceId}
                  onClick={() => {
                    if (!envVar.key || !envVar.value || !workspaceId) return
                    setWorkspaceVars((prev) => [
                      ...prev,
                      { ...envVar, id: generateRowId() },
                    ])
                    setEnvVars((prev) => {
                      const filtered = prev.filter((entry) => entry !== envVar)
                      return filtered.length ? filtered : [createEmptyEnvVar()]
                    })
                  }}
                  className='h-9 w-9 rounded-sm bg-muted p-0 text-muted-foreground hover:bg-card/70'
                >
                  <Share2 className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Make it workspace scoped</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => removeEnvVar(originalIndex)}
                  className='h-9 w-9 rounded-sm bg-muted p-0 text-muted-foreground hover:bg-card/70'
                >
                  ×
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete environment variable</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {isConflict && (
          <div className='col-span-3 mt-1 text-[#DC2626] text-[12px] leading-tight dark:text-[#F87171]'>
            Workspace variable with the same name overrides this. Rename your personal key to use
            it.
          </div>
        )}
      </>
    )
  }

  const renderTableView = () => {
    const scope = keyScope
    const scopeLabel = scope === 'workspace' ? 'Workspace' : 'Personal'
    const filteredList = scope === 'workspace' ? filteredWorkspaceVars : filteredEnvVars
    const baseList = scope === 'workspace' ? workspaceVars : envVars
    const isLoadingAny = isBusy

    const renderRows = () => {
      if (isLoadingAny) {
        return [0, 1, 2].map((row) => (
          <tr key={`loading-${row}`} className='border-b'>
            <td className='px-4 py-4'>
              <Skeleton className='h-4 w-2/3' />
            </td>
            <td className='px-4 py-4'>
              <Skeleton className='h-9 w-full max-w-sm rounded-md' />
            </td>
            <td className='px-4 py-4'>
              <Skeleton className='h-4 w-2/3' />
            </td>
            <td className='px-4 py-4'>
              <Skeleton className='h-4 w-2/3' />
            </td>
            <td className='px-4 py-4'>
              <div className='flex justify-end gap-2'>
                <Skeleton className='h-8 w-8 rounded-full' />
                <Skeleton className='h-8 w-8 rounded-full' />
              </div>
            </td>
          </tr>
        ))
      }

      if (baseList.length === 0) {
        return (
          <tr>
            <td colSpan={5} className='px-4 py-12 text-center'>
              <p className='font-medium text-lg'>No {scopeLabel.toLowerCase()} variables yet</p>
              <p className='mt-2 text-muted-foreground'>Create one to start configuring.</p>
              <Button className='mt-6' onClick={() => addVariable(scope)}>
                <Plus className='mr-2 h-4 w-4' />
                Create {scopeLabel} Environment Variable
              </Button>
            </td>
          </tr>
        )
      }

      if (resolvedSearchTerm.trim() && filteredList.length === 0) {
        return (
          <tr>
            <td colSpan={5} className='px-4 py-12 text-center text-muted-foreground'>
              No {scopeLabel.toLowerCase()} environment variables found matching "
              {resolvedSearchTerm}".
            </td>
          </tr>
        )
      }

      return filteredList.map(({ envVar, originalIndex }) => {
        const rowId = envVar.id ?? originalIndex
        const isRevealed = typeof rowId === 'number' ? Boolean(revealedValues[rowId]) : false
        const displayValue = envVar.value
          ? isRevealed
            ? envVar.value
            : getMaskedValue(envVar.value)
          : '—'
        const isCopied = typeof rowId === 'number' ? copiedVarId === rowId : false
        const isEditing =
          typeof rowId === 'number' ? editingVarId === rowId && editingScope === scope : false
        const hasWorkspaceConflict =
          scope === 'personal' && envVar.key && workspaceKeySet.has(envVar.key)

        return (
          <tr key={rowId} className='border-b transition-colors hover:bg-card/30'>
            <td className='px-4 py-4 text-center align-top'>
              <span className='text-muted-foreground text-sm'>
                {formatDateTime(envVar.createdAt)}
              </span>
            </td>
            <td className='px-4 py-4 text-center align-top'>
              {isEditing ? (
                <div className='space-y-2'>
                  <div className='flex max-w-md items-center gap-2'>
                    <Input
                      value={editingKeyName}
                      onChange={(event) => setEditingKeyName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitEditingVar()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEditingVar()
                        }
                      }}
                      autoComplete='off'
                      autoCapitalize='off'
                      spellCheck='false'
                      className='h-8 flex-1'
                    />
                  </div>
                </div>
              ) : (
                <div className='space-y-1'>
                  <p className='font-medium text-sm'>{envVar.key || 'Untitled variable'}</p>
                  {hasWorkspaceConflict && (
                    <p className='text-destructive text-xs'>Overridden by workspace variable</p>
                  )}
                </div>
              )}
            </td>
            <td className='px-4 py-4 text-center align-top'>
              {isEditing ? (
                <Input
                  ref={(el) => {
                    if (isEditing) {
                      editValueInputRef.current = el
                    }
                  }}
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitEditingVar()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelEditingVar()
                    }
                  }}
                  autoComplete='off'
                  autoCapitalize='off'
                  spellCheck='false'
                  className='h-9'
                />
              ) : (
                <div className='flex flex-wrap items-center justify-center gap-2 md:flex-nowrap'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    disabled={!envVar.value}
                    className='h-8 w-8 text-muted-foreground'
                    onClick={() => {
                      if (typeof rowId === 'number') toggleReveal(rowId)
                    }}
                  >
                    {isRevealed ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                    <span className='sr-only'>
                      {isRevealed ? 'Hide value' : 'Reveal value'}
                    </span>
                  </Button>
                  <div className='min-w-0 flex-1'>
                    <div className='flex h-9 items-center justify-center rounded-md bg-muted/70 px-3 text-center'>
                      <code className='truncate font-mono text-xs'>{displayValue}</code>
                    </div>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    disabled={!envVar.value}
                    className='h-8 w-8 text-muted-foreground'
                    onClick={() => {
                      if (typeof rowId === 'number') handleCopyValue(envVar.value ?? '', rowId)
                    }}
                  >
                    {isCopied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
                    <span className='sr-only'>Copy environment value</span>
                  </Button>
                </div>
              )}
            </td>
            <td className='px-4 py-4 text-center align-top'>
              <span className='text-muted-foreground text-sm'>
                {formatDateTime(envVar.updatedAt ?? envVar.createdAt)}
              </span>
            </td>
            <td className='px-4 py-4 text-center align-top'>
              <div className='flex items-center justify-end gap-1.5'>
                {isEditing ? (
                  <>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-8 w-8 text-muted-foreground'
                      onClick={commitEditingVar}
                    >
                      <Check className='h-4 w-4' />
                      <span className='sr-only'>Save environment variable</span>
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-8 w-8 text-muted-foreground'
                      onClick={cancelEditingVar}
                    >
                      <X className='h-4 w-4' />
                      <span className='sr-only'>Cancel editing</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground'
                    onClick={() => startEditingVar(scope, envVar)}
                  >
                    <Pencil className='h-4 w-4' />
                    <span className='sr-only'>Edit environment variable</span>
                  </Button>
                )}
                {!isEditing && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-destructive'
                    onClick={() => {
                      if (typeof rowId === 'number') removeVarById(scope, rowId)
                    }}
                  >
                    <Trash2 className='h-4 w-4' />
                    <span className='sr-only'>Delete environment variable</span>
                  </Button>
                )}
              </div>
            </td>
          </tr>
        )
      })
    }

    return (
      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg '>
        <div className='shrink-0 overflow-x-auto border-b bg-muted/40'>
          <table className='w-full min-w-[960px] table-fixed'>
            <colgroup>
              <col className='w-[10%]' />
              <col className='w-[20%]' />
              <col className='w-[40%]' />
              <col className='w-[10%]' />
              <col className='w-[20%]' />
            </colgroup>
            <thead>
              <tr>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Created At
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Variable
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Value
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Updated At
                  </span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center font-medium'>
                  <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
          </table>
        </div>

        <div className='min-h-0 flex-1 overflow-auto'>
          <table className='w-full min-w-[960px] table-fixed'>
            <colgroup>
              <col className='w-[10%]' />
              <col className='w-[20%]' />
              <col className='w-[40%]' />
              <col className='w-[10%]' />
              <col className='w-[20%]' />
            </colgroup>
            <tbody>{renderRows()}</tbody>
          </table>
        </div>
      </div>
    )
  }

  if (isPageVariant) {
    return (
      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden space-y-4'>
        {renderTableView()}
      </div>
    )
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Hidden dummy input to prevent autofill */}
      <input type='text' name='hidden' style={{ display: 'none' }} autoComplete='false' />
      {/* Fixed Header */}
      {isModalVariant && (
        <div className='px-6 pt-4 pb-2'>
          {/* Search Input */}
          {isLoading ? (
            <Skeleton className='h-9 w-56 rounded-sm' />
          ) : (
            <div className='flex h-9 w-56 items-center gap-2 rounded-sm border bg-transparent pr-2 pl-3'>
              <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
              <Input
                placeholder='Search variables...'
                value={resolvedSearchTerm}
                onChange={(e) => handleSearchTermChange(e.target.value)}
                name='env_search_field'
                autoComplete='off'
                autoCapitalize='off'
                spellCheck='false'
                readOnly
                onFocus={(e) => e.target.removeAttribute('readOnly')}
                className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
          )}
        </div>
      )}

      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'
      >
        <div className='h-full space-y-2 py-2'>
          {isLoading || isWorkspaceLoading ? (
            <>
              {/* Show 3 skeleton rows */}
              {[1, 2, 3].map((index) => (
                <div key={index} className={`${GRID_COLS} items-center`}>
                  <Skeleton className='h-9 rounded-sm' />
                  <Skeleton className='h-9 rounded-sm' />
                  <Skeleton className='h-9 w-9 rounded-sm' />
                </div>
              ))}
            </>
          ) : (
            <>
              {/* Workspace section */}
              {!resolvedSearchTerm.trim() ? (
                <div className='mb-6 space-y-2'>
                  <div className='font-medium text-[13px] text-foreground'>Workspace</div>
                  {workspaceVars.length === 0 ? (
                    <div className='text-muted-foreground text-sm'>No workspace variables yet.</div>
                  ) : (
                    workspaceVars.map((envVar, index) => (
                      <div
                        key={envVar.id || envVar.key || index}
                        className={`${GRID_COLS} items-center`}
                      >
                        <Input
                          value={envVar.key}
                          onChange={(e) => updateWorkspaceVar(index, 'key', e.target.value)}
                          name={`workspace_env_key_${envVar.key || envVar.id || index}`}
                          autoComplete='off'
                          autoCapitalize='off'
                          spellCheck='false'
                          readOnly
                          onFocus={(e) => e.target.removeAttribute('readOnly')}
                          className='h-9 rounded-sm border-none bg-muted px-3 text-sm'
                        />
                        <Input
                          value={envVar.value ? '•'.repeat(envVar.value.length) : ''}
                          readOnly
                          autoComplete='off'
                          autoCorrect='off'
                          autoCapitalize='off'
                          spellCheck='false'
                          className='h-9 rounded-sm border-none bg-muted px-3 text-sm'
                        />
                        <div className='flex justify-end'>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant='ghost'
                                size='icon'
                                onClick={() => removeWorkspaceVar(index)}
                                className='h-9 w-9 rounded-sm bg-muted p-0 text-muted-foreground hover:bg-card/70'
                              >
                                ×
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete environment variable</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : filteredWorkspaceVars.length > 0 ? (
                <div className='mb-6 space-y-2'>
                  <div className='font-medium text-[13px] text-foreground'>Workspace</div>
                  {filteredWorkspaceVars.map(({ envVar, originalIndex }) => (
                    <div
                      key={envVar.id || envVar.key || originalIndex}
                      className={`${GRID_COLS} items-center`}
                    >
                      <Input
                        value={envVar.key}
                        onChange={(e) => updateWorkspaceVar(originalIndex, 'key', e.target.value)}
                        name={`workspace_env_key_filtered_${envVar.key || envVar.id || originalIndex}`}
                        autoComplete='off'
                        autoCapitalize='off'
                        spellCheck='false'
                        readOnly
                        onFocus={(e) => e.target.removeAttribute('readOnly')}
                        className='h-9 rounded-sm border-none bg-muted px-3 text-sm'
                      />
                      <Input
                        value={envVar.value ? '•'.repeat(envVar.value.length) : ''}
                        readOnly
                        autoComplete='off'
                        autoCorrect='off'
                        autoCapitalize='off'
                        spellCheck='false'
                        className='h-9 rounded-sm border-none bg-muted px-3 text-sm'
                      />
                      <div className='flex justify-end'>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={() => removeWorkspaceVar(originalIndex)}
                              className='h-9 w-9 rounded-sm bg-muted p-0 text-muted-foreground hover:bg-card/70'
                            >
                              ×
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete environment variable</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Personal section */}
              <div
                className={`${personalHeaderMarginClass} mb-2 font-medium text-[13px] text-foreground`}
              >
                {' '}
                Personal{' '}
              </div>
              {filteredEnvVars.map(({ envVar, originalIndex }) => (
                <div key={envVar.id || originalIndex}>{renderEnvVarRow(envVar, originalIndex)}</div>
              ))}
              {/* Show message when search has no results across both sections */}
              {resolvedSearchTerm.trim() &&
                filteredEnvVars.length === 0 &&
                filteredWorkspaceVars.length === 0 &&
                (envVars.length > 0 || workspaceVars.length > 0) && (
                  <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
                    No environment variables found matching "{resolvedSearchTerm}"
                  </div>
                )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className='bg-background'>
        <div className={`flex w-full items-center px-6 py-4 ${footerJustifyClass}`}>
          {isLoading ? (
            isModalVariant ? (
              <>
                <Skeleton className='h-9 w-[117px] rounded-sm' />
                <Skeleton className='h-9 w-[108px] rounded-sm' />
              </>
            ) : (
              <Skeleton className='h-9 w-[108px] rounded-sm' />
            )
          ) : (
            <>
              {isModalVariant && (
                <Button
                  onClick={() => addVariable('personal')}
                  variant='ghost'
                  className='h-9 rounded-sm border bg-background px-3 shadow-xs hover:bg-card focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                >
                  <Plus className='h-4 w-4 stroke-[2px]' />
                  Add Variable
                </Button>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleSave}
                    disabled={!hasChanges || hasConflicts}
                    className={`h-9 rounded-sm ${hasConflicts ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    Save Changes
                  </Button>
                </TooltipTrigger>
                {hasConflicts && (
                  <TooltipContent>Resolve all conflicts before saving</TooltipContent>
                )}
              </Tooltip>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={showUnsavedChanges} onOpenChange={setShowUnsavedChanges}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              {hasConflicts
                ? 'You have unsaved changes, but conflicts must be resolved before saving. You can discard your changes to close the modal.'
                : 'You have unsaved changes. Do you want to save them before closing?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              onClick={handleCancel}
              className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              Discard Changes
            </AlertDialogCancel>
            {hasConflicts ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogAction
                    disabled={true}
                    className='h-9 w-full cursor-not-allowed rounded-sm bg-primary text-black opacity-50 transition-all duration-200'
                  >
                    Save Changes
                  </AlertDialogAction>
                </TooltipTrigger>
                <TooltipContent>Resolve all conflicts before saving</TooltipContent>
              </Tooltip>
            ) : (
              <AlertDialogAction
                onClick={handleSave}
                className='h-9 w-full rounded-sm bg-primary text-black transition-all duration-200 hover:bg-[var(--primary)]/90'
              >
                Save Changes
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

EnvironmentVariablesComponent.displayName = 'EnvironmentVariables'

export const EnvironmentVariables = forwardRef(EnvironmentVariablesComponent)
