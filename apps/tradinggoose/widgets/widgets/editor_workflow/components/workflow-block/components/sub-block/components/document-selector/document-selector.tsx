'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, FileText, RefreshCw } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { SubBlockConfig } from '@/blocks/types'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import { useMessages } from 'next-intl'
import { formatTemplate } from '@/i18n/utils'
import type { LocaleCode } from '@/i18n/utils'
import { useDependsOnGate } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: string
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  processingError: string | null
  enabled: boolean
  uploadedAt: Date
}

interface DocumentSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onDocumentSelect?: (documentId: string) => void
}

export function DocumentSelector({
  blockId,
  subBlock,
  disabled = false,
  onDocumentSelect,
}: DocumentSelectorProps) {
  const locale = useLocale() as LocaleCode
  const selectorCopy = useMessages().workspace.widgets.blockEditor.documentSelector
  type DocumentSelectorErrorCode = keyof typeof selectorCopy.errors | 'noKnowledgeBaseSelected'
  const [documents, setDocuments] = useState<DocumentData[]>([])
  const [error, setError] = useState<DocumentSelectorErrorCode | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<DocumentData | null>(null)
  const [loading, setLoading] = useState(false)

  // Use the proper hook to get the current value and setter
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  // Get the knowledge base ID from the same block's knowledgeBaseId subblock
  const [knowledgeBaseId] = useSubBlockValue(blockId, 'knowledgeBaseId')

  const { finalDisabled } = useDependsOnGate(blockId, subBlock, { disabled })
  const isDisabled = finalDisabled

  // Fetch documents for the selected knowledge base
  const fetchDocuments = useCallback(async () => {
    if (!knowledgeBaseId) {
      setDocuments([])
      setError('noKnowledgeBaseSelected')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`)

      if (!response.ok) {
        console.error('Failed to fetch knowledge base documents', {
          knowledgeBaseId,
          status: response.status,
          statusText: response.statusText,
        })
        throw new Error('failedToFetchDocuments')
      }

      const result = await response.json()

      if (!result.success) {
        console.error('Documents API returned an error', { knowledgeBaseId, result })
        throw new Error('failedToFetchDocuments')
      }

      const fetchedDocuments = result.data.documents || result.data || []
      setDocuments(fetchedDocuments)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      console.error('Failed to fetch knowledge base documents', err)
      setError('failedToFetchDocuments')
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }, [knowledgeBaseId])

  // Handle dropdown open/close - fetch documents when opening
  const handleOpenChange = (isOpen: boolean) => {
    if (isDisabled) return

    setOpen((prev) => (prev === isOpen ? prev : isOpen))

    // Fetch fresh documents when opening the dropdown
    if (isOpen) {
      fetchDocuments()
    }
  }

  // Handle document selection
  const handleSelectDocument = (document: DocumentData) => {
    setSelectedDocument(document)
    setStoreValue(document.id)
    onDocumentSelect?.(document.id)
    setOpen(false)
  }

  // Sync selected document with value prop
  useEffect(() => {
    if (isDisabled) return
    if (storeValue && documents.length > 0) {
      const docInfo = documents.find((doc) => doc.id === storeValue)
      setSelectedDocument(docInfo || null)
    } else {
      setSelectedDocument(null)
    }
  }, [storeValue, documents, isDisabled])

  // Reset documents when knowledge base changes
  useEffect(() => {
    setDocuments([])
    setSelectedDocument(null)
    setError(null)
  }, [knowledgeBaseId])

  // Fetch documents when knowledge base is available
  useEffect(() => {
    if (knowledgeBaseId && !isDisabled) {
      fetchDocuments()
    }
  }, [knowledgeBaseId, isDisabled, fetchDocuments])

  const formatDocumentName = (document: DocumentData) => {
    return document.filename
  }

  const getDocumentDescription = (document: DocumentData) => {
    const statusMap: Record<string, string> = {
      pending: translateWorkflowLabel(locale, 'processingPending'),
      processing: translateWorkflowLabel(locale, 'processing'),
      completed: translateWorkflowLabel(locale, 'ready'),
      failed: translateWorkflowLabel(locale, 'processingFailed'),
    }

    const status = statusMap[document.processingStatus] || document.processingStatus
    const chunkTemplate =
      document.chunkCount === 1 ? selectorCopy.chunkCountSingular : selectorCopy.chunkCountPlural
    const chunkText = formatTemplate(chunkTemplate, { count: document.chunkCount })

    return `${status} • ${chunkText}`
  }

  const label = subBlock.placeholder || translateWorkflowLabel(locale, 'selectDocument')

  return (
    <div className='w-full'>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='relative w-full justify-between'
            disabled={isDisabled}
          >
            <div className='flex max-w-[calc(100%-20px)] items-center gap-2 overflow-hidden'>
              <FileText className='h-4 w-4 text-muted-foreground' />
              {selectedDocument ? (
                <span className='truncate font-normal'>{formatDocumentName(selectedDocument)}</span>
              ) : (
                <span className='truncate text-muted-foreground'>{label}</span>
              )}
            </div>
            <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandInput placeholder={translateWorkflowLabel(locale, 'searchDocuments')} />
            <CommandList>
              <CommandEmpty>
                {loading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>
                      {translateWorkflowLabel(locale, 'loadingDocuments')}
                    </span>
                  </div>
                ) : error && error !== 'noKnowledgeBaseSelected' ? (
                  <div className='p-4 text-center'>
                    <p className='text-destructive text-sm'>{selectorCopy.errors[error]}</p>
                  </div>
                ) : !knowledgeBaseId || error === 'noKnowledgeBaseSelected' ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>
                      {translateWorkflowLabel(locale, 'noKnowledgeBaseSelected')}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {translateWorkflowLabel(locale, 'pleaseSelectAKnowledgeBaseFirst')}
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>
                      {translateWorkflowLabel(locale, 'noDocumentsFound')}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {translateWorkflowLabel(
                        locale,
                        'uploadDocumentsToThisKnowledgeBaseToGetStarted'
                      )}
                    </p>
                  </div>
                )}
              </CommandEmpty>

              {documents.length > 0 && (
                <CommandGroup>
                  <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                    {translateWorkflowLabel(locale, 'documents')}
                  </div>
                  {documents.map((document) => (
                    <CommandItem
                      key={document.id}
                      value={`doc-${document.id}-${document.filename}`}
                      onSelect={() => handleSelectDocument(document)}
                      className='cursor-pointer'
                    >
                      <div className='flex items-center gap-1 overflow-hidden'>
                        <FileText className='h-4 w-4 text-muted-foreground' />
                        <div className='min-w-0 flex-1 overflow-hidden'>
                          <div className='truncate font-normal'>{formatDocumentName(document)}</div>
                          <div className='truncate text-muted-foreground text-xs'>
                            {getDocumentDescription(document)}
                          </div>
                        </div>
                      </div>
                      {document.id === storeValue && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
