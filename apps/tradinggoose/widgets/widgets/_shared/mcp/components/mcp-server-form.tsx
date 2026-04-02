'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
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
import { cn } from '@/lib/utils'
import type { McpServerTestResult } from '@/hooks/use-mcp-server-test'
import type { McpServerFormData } from '@/widgets/widgets/_shared/mcp/utils'

interface McpServerFormProps {
  formData: McpServerFormData
  setFormData: Dispatch<SetStateAction<McpServerFormData>>
  testResult: McpServerTestResult | null
  isTestingConnection: boolean
  workspaceId: string
  clearTestResult: () => void
  className?: string
}

export function McpServerForm({
  formData,
  setFormData,
  testResult,
  isTestingConnection,
  workspaceId,
  clearTestResult,
  className,
}: McpServerFormProps) {
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [envSearchTerm, setEnvSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeInputField, setActiveInputField] = useState<
    'url' | 'header-key' | 'header-value' | null
  >(null)
  const [activeHeaderIndex, setActiveHeaderIndex] = useState<number | null>(null)
  const [urlScrollLeft, setUrlScrollLeft] = useState(0)
  const [headerScrollLeft, setHeaderScrollLeft] = useState<Record<string, number>>({})

  const handleEnvVarSelect = useCallback(
    (newValue: string) => {
      if (activeInputField === 'url') {
        setFormData((prev) => ({ ...prev, url: newValue }))
      } else if (activeInputField === 'header-key' && activeHeaderIndex !== null) {
        const headerEntries = Object.entries(formData.headers || {})
        const [oldKey, value] = headerEntries[activeHeaderIndex] || ['', '']
        const newHeaders = { ...(formData.headers || {}) }
        delete newHeaders[oldKey]
        newHeaders[newValue.replace(/[{}]/g, '')] = value
        setFormData((prev) => ({ ...prev, headers: newHeaders }))
      } else if (activeInputField === 'header-value' && activeHeaderIndex !== null) {
        const headerEntries = Object.entries(formData.headers || {})
        const [key] = headerEntries[activeHeaderIndex] || ['', '']
        setFormData((prev) => ({
          ...prev,
          headers: { ...(prev.headers || {}), [key]: newValue },
        }))
      }

      setShowEnvVars(false)
      setActiveInputField(null)
      setActiveHeaderIndex(null)
    },
    [activeHeaderIndex, activeInputField, formData.headers, setFormData]
  )

  const handleInputChange = useCallback(
    (field: 'url' | 'header-key' | 'header-value', value: string, headerIndex?: number) => {
      const input = document.activeElement as HTMLInputElement | null
      const pos = input?.selectionStart || 0

      setCursorPosition(pos)
      if (testResult) {
        clearTestResult()
      }

      const envVarTrigger = checkEnvVarTrigger(value, pos)
      setShowEnvVars(envVarTrigger.show)
      setEnvSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

      if (envVarTrigger.show) {
        setActiveInputField(field)
        setActiveHeaderIndex(headerIndex ?? null)
      } else {
        setActiveInputField(null)
        setActiveHeaderIndex(null)
      }

      if (field === 'url') {
        setFormData((prev) => ({ ...prev, url: value }))
        return
      }

      if (typeof headerIndex !== 'number') {
        return
      }

      const headerEntries = Object.entries(formData.headers || {})

      if (field === 'header-key') {
        const [oldKey, headerValue] = headerEntries[headerIndex] || ['', '']
        const newHeaders = { ...(formData.headers || {}) }
        delete newHeaders[oldKey]
        newHeaders[value] = headerValue

        const isLastRow = headerIndex === headerEntries.length - 1
        const hasContent = value.trim() !== '' && headerValue.trim() !== ''
        if (isLastRow && hasContent) {
          newHeaders[''] = ''
        }

        setFormData((prev) => ({ ...prev, headers: newHeaders }))
        return
      }

      const [key] = headerEntries[headerIndex] || ['', '']
      const newHeaders = { ...(formData.headers || {}), [key]: value }

      const isLastRow = headerIndex === headerEntries.length - 1
      const hasContent = key.trim() !== '' && value.trim() !== ''
      if (isLastRow && hasContent) {
        newHeaders[''] = ''
      }

      setFormData((prev) => ({
        ...prev,
        headers: newHeaders,
      }))
    },
    [clearTestResult, formData.headers, setFormData, testResult]
  )

  const headerEntries = Object.entries(formData.headers || {})

  return (
    <div className={cn('w-full rounded-md border bg-background shadow-xs', className)}>
      <div className='space-y-4'>
        <div>
          <Label htmlFor='transport'>Transport Type</Label>
          <Select
            value={formData.transport}
            onValueChange={(value: 'http' | 'sse' | 'streamable-http') => {
              if (testResult) clearTestResult()
              setFormData((prev) => ({ ...prev, transport: value }))
            }}
          >
            <SelectTrigger id='transport' className='h-9'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='streamable-http'>Streamable HTTP</SelectItem>
              <SelectItem value='http'>HTTP</SelectItem>
              <SelectItem value='sse'>Server-Sent Events</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className='relative'>
          <Label htmlFor='server-url'>Server URL</Label>
          <div className='relative'>
            <Input
              id='server-url'
              placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
              value={formData.url}
              onChange={(event) => handleInputChange('url', event.target.value)}
              onScroll={(event) => setUrlScrollLeft(event.currentTarget.scrollLeft)}
              onInput={(event) => setUrlScrollLeft(event.currentTarget.scrollLeft)}
              className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
            />
            <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
              <div
                className='whitespace-nowrap'
                style={{ transform: `translateX(-${urlScrollLeft}px)` }}
              >
                {formatDisplayText(formData.url || '')}
              </div>
            </div>
          </div>

          {showEnvVars && activeInputField === 'url' && (
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={handleEnvVarSelect}
              searchTerm={envSearchTerm}
              inputValue={formData.url || ''}
              cursorPosition={cursorPosition}
              workspaceId={workspaceId}
              onClose={() => {
                setShowEnvVars(false)
                setActiveInputField(null)
              }}
              className='w-full'
              maxHeight='250px'
              style={{ position: 'absolute', top: '100%', left: 0, zIndex: 99999 }}
            />
          )}
        </div>

        <div>
          <Label>Headers (Optional)</Label>
          <div className='space-y-2'>
            {headerEntries.map(([key, value], index) => (
              <div key={`${key || 'header'}-${index}`} className='relative flex gap-2'>
                <div className='relative flex-1'>
                  <Input
                    placeholder='Name'
                    value={key}
                    onChange={(event) => handleInputChange('header-key', event.target.value, index)}
                    onScroll={(event) => {
                      const scrollLeft = event.currentTarget.scrollLeft
                      setHeaderScrollLeft((prev) => ({ ...prev, [`key-${index}`]: scrollLeft }))
                    }}
                    onInput={(event) => {
                      const scrollLeft = event.currentTarget.scrollLeft
                      setHeaderScrollLeft((prev) => ({ ...prev, [`key-${index}`]: scrollLeft }))
                    }}
                    className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                  />
                  <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                    <div
                      className='whitespace-nowrap'
                      style={{
                        transform: `translateX(-${headerScrollLeft[`key-${index}`] || 0}px)`,
                      }}
                    >
                      {formatDisplayText(key || '')}
                    </div>
                  </div>
                </div>

                {showEnvVars &&
                  activeInputField === 'header-key' &&
                  activeHeaderIndex === index && (
                    <EnvVarDropdown
                      visible={showEnvVars}
                      onSelect={handleEnvVarSelect}
                      searchTerm={envSearchTerm}
                      inputValue={key}
                      cursorPosition={cursorPosition}
                      workspaceId={workspaceId}
                      onClose={() => {
                        setShowEnvVars(false)
                        setActiveInputField(null)
                        setActiveHeaderIndex(null)
                      }}
                      className='w-full'
                      maxHeight='150px'
                      style={{ position: 'absolute', top: '100%', left: 0, zIndex: 99999 }}
                    />
                  )}

                <div className='relative flex-1'>
                  <Input
                    placeholder='Value'
                    value={value}
                    onChange={(event) =>
                      handleInputChange('header-value', event.target.value, index)
                    }
                    onScroll={(event) => {
                      const scrollLeft = event.currentTarget.scrollLeft
                      setHeaderScrollLeft((prev) => ({ ...prev, [`value-${index}`]: scrollLeft }))
                    }}
                    onInput={(event) => {
                      const scrollLeft = event.currentTarget.scrollLeft
                      setHeaderScrollLeft((prev) => ({ ...prev, [`value-${index}`]: scrollLeft }))
                    }}
                    className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                  />
                  <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                    <div
                      className='whitespace-nowrap'
                      style={{
                        transform: `translateX(-${headerScrollLeft[`value-${index}`] || 0}px)`,
                      }}
                    >
                      {formatDisplayText(value || '')}
                    </div>
                  </div>
                </div>

                {showEnvVars &&
                  activeInputField === 'header-value' &&
                  activeHeaderIndex === index && (
                    <EnvVarDropdown
                      visible={showEnvVars}
                      onSelect={handleEnvVarSelect}
                      searchTerm={envSearchTerm}
                      inputValue={value}
                      cursorPosition={cursorPosition}
                      workspaceId={workspaceId}
                      onClose={() => {
                        setShowEnvVars(false)
                        setActiveInputField(null)
                        setActiveHeaderIndex(null)
                      }}
                      className='w-full'
                      maxHeight='250px'
                      style={{ position: 'absolute', top: '100%', right: 0, zIndex: 99999 }}
                    />
                  )}

                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    if (headerEntries.length === 1) {
                      setFormData((prev) => ({ ...prev, headers: { '': '' } }))
                      return
                    }

                    const nextHeaders = { ...(formData.headers || {}) }
                    delete nextHeaders[key]
                    setFormData((prev) => ({ ...prev, headers: nextHeaders }))
                  }}
                  className='h-9 w-9 p-0 text-muted-foreground hover:text-foreground'
                >
                  <X className='h-3 w-3' />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className='flex items-center justify-center pt-1 pb-2'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => {
              setFormData((prev) => ({
                ...prev,
                headers: { ...(prev.headers || {}), '': '' },
              }))
            }}
            className='h-9 text-foreground'
          >
            <Plus className='mr-2 h-3 w-3' />
            Add Header
          </Button>
        </div>

        <div className='border-t pt-4'>
          {isTestingConnection ? (
            <p className='text-muted-foreground text-xs'>Testing connection...</p>
          ) : testResult?.success ? (
            <p className='text-green-600 text-xs'>Connection successful.</p>
          ) : testResult ? (
            <div className='rounded border border-red-200 bg-red-50 px-2 py-1.5 text-red-600 text-xs'>
              <div className='font-medium'>Connection failed</div>
              <div className='text-red-500'>{testResult.error || testResult.message}</div>
            </div>
          ) : (
            <p className='text-muted-foreground text-xs'>
              Use the header controls to test the connection, cancel, or save changes.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
