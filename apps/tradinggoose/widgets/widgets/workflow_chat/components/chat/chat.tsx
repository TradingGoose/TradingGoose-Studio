'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, File, FileText, Image, Paperclip, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { createChatOutputEventReader } from '@/lib/workflows/chat-output'
import { useWorkflowExecution } from '@/hooks/workflow/use-workflow-execution'
import { useChatStore } from '@/stores/chat/store'
import type { ChatMessage as StoredChatMessage } from '@/stores/chat/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { ChatMessage } from '..'

const logger = createLogger('ChatPanel')

interface ChatFile {
  id: string
  name: string
  size: number
  type: string
  file: File
}

interface ChatProps {
  chatMessage: string
  setChatMessage: (message: string) => void
  hideScrollbar?: boolean
}

export function Chat({ chatMessage, setChatMessage, hideScrollbar = true }: ChatProps) {
  const { workflowId: currentWorkflowId } = useWorkflowRoute()

  const { messages, addMessage, selectedWorkflowOutputs, getConversationId } = useChatStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Prompt history state
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [streamingMessage, setStreamingMessage] = useState<StoredChatMessage | null>(null)

  // File upload state
  const [chatFiles, setChatFiles] = useState<ChatFile[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [dragCounter, setDragCounter] = useState(0)
  const isDragOver = dragCounter > 0
  // Scroll state
  const [isNearBottom, setIsNearBottom] = useState(true)

  // Use the execution store state to track if a workflow is executing
  const { isExecuting } = useExecutionStore()

  // Get workflow execution functionality
  const { handleRunWorkflow } = useWorkflowExecution()

  // Get filtered messages for current workflow
  const workflowMessages = useMemo(() => {
    if (!currentWorkflowId) return []
    return messages
      .filter((msg) => msg.workflowId === currentWorkflowId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [messages, currentWorkflowId])

  const visibleMessages = useMemo(() => {
    return streamingMessage ? [...workflowMessages, streamingMessage] : workflowMessages
  }, [streamingMessage, workflowMessages])

  // Memoize user messages for performance
  const userMessages = useMemo(() => {
    return workflowMessages
      .filter((msg) => msg.type === 'user')
      .map((msg) => msg.content)
      .filter((content): content is string => typeof content === 'string')
  }, [workflowMessages])

  // Update prompt history when workflow changes
  useEffect(() => {
    if (!currentWorkflowId) {
      setPromptHistory([])
      setHistoryIndex(-1)
      setStreamingMessage(null)
      return
    }

    setPromptHistory(userMessages)
    setHistoryIndex(-1)
  }, [currentWorkflowId, userMessages])

  // Get selected workflow outputs (shared by workflow)
  const selectedOutputs = useMemo(() => {
    if (!currentWorkflowId) return []
    const outputs = selectedWorkflowOutputs[currentWorkflowId]
    return outputs?.length ? [...new Set(outputs)] : []
  }, [currentWorkflowId, selectedWorkflowOutputs])

  // Focus input helper with proper cleanup
  const focusInput = useCallback((delay = 0) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      if (inputRef.current && document.contains(inputRef.current)) {
        inputRef.current.focus({ preventScroll: true })
      }
    }, delay)
  }, [])

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Find the viewport element inside the ScrollArea
    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // Consider "near bottom" if within 100px of bottom
    const nearBottom = distanceFromBottom <= 100
    setIsNearBottom(nearBottom)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Attach scroll listener
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Find the viewport element inside the ScrollArea
    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    viewport.addEventListener('scroll', handleScroll, { passive: true })

    // Also listen for scrollend event if available (for smooth scrolling)
    if ('onscrollend' in viewport) {
      viewport.addEventListener('scrollend', handleScroll, { passive: true })
    }

    // Initial scroll state check with small delay to ensure DOM is ready
    setTimeout(handleScroll, 100)

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      if ('onscrollend' in viewport) {
        viewport.removeEventListener('scrollend', handleScroll)
      }
    }
  }, [handleScroll])

  // Auto-scroll to bottom when new messages are added, but only if user is near bottom
  // Exception: Always scroll when sending a new message
  useEffect(() => {
    if (visibleMessages.length === 0) return

    const lastMessage = visibleMessages[visibleMessages.length - 1]
    const isNewUserMessage = lastMessage?.type === 'user'

    // Always scroll for new user messages, or only if near bottom for assistant messages
    if ((isNewUserMessage || isNearBottom) && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      // Let the scroll event handler update the state naturally after animation completes
    }
  }, [visibleMessages, isNearBottom])

  // Handle send message
  const handleSendMessage = useCallback(async () => {
    if ((!chatMessage.trim() && chatFiles.length === 0) || !currentWorkflowId || isExecuting) return

    // Store the message being sent for reference
    const sentMessage = chatMessage.trim()

    // Add to prompt history if it's not already the most recent
    if (
      sentMessage &&
      (promptHistory.length === 0 || promptHistory[promptHistory.length - 1] !== sentMessage)
    ) {
      setPromptHistory((prev) => [...prev, sentMessage])
    }

    // Reset history index
    setHistoryIndex(-1)

    // Get the conversationId for this workflow before adding the message
    const conversationId = getConversationId(currentWorkflowId)
    let result: any = null
    const streamState = {
      id: crypto.randomUUID(),
      content: '',
      timestamp: new Date().toISOString(),
      errorShown: false,
    }
    const outputReader = createChatOutputEventReader(selectedOutputs)
    const appendStreamContent = (content: string, blockId: string) => {
      if (!content) return

      streamState.content = `${streamState.content}${content}`
      setStreamingMessage({
        id: streamState.id,
        content: streamState.content,
        workflowId: currentWorkflowId,
        type: 'workflow',
        timestamp: streamState.timestamp,
        blockId,
      })
    }
    const appendStreamError = (message: string, blockId = 'workflow') => {
      if (streamState.errorShown) return
      streamState.errorShown = true
      const prefix = streamState.content ? '\n\n' : ''
      appendStreamContent(`${prefix}Error: ${message}`, blockId)
    }
    const appendOutputEvents = (events: ReturnType<typeof outputReader.readEvent>) => {
      for (const event of events) {
        if (event.type === 'content') appendStreamContent(event.content, event.blockId)
        if (event.type === 'error') appendStreamError(event.message, event.blockId)
      }
    }

    try {
      // Read files as data URLs for display in chat (only images to avoid localStorage quota issues)
      const attachmentsWithData = await Promise.all(
        chatFiles.map(async (file) => {
          let dataUrl = ''
          // Only read images as data URLs to avoid storing large files in localStorage
          if (file.type.startsWith('image/')) {
            try {
              dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as string)
                reader.onerror = reject
                reader.readAsDataURL(file.file)
              })
            } catch (error) {
              logger.error('Error reading file as data URL:', error)
            }
          }
          return {
            id: file.id,
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl,
          }
        })
      )

      // Add user message with attachments (include all files, even non-images without dataUrl)
      addMessage({
        content:
          sentMessage || (chatFiles.length > 0 ? `Uploaded ${chatFiles.length} file(s)` : ''),
        workflowId: currentWorkflowId,
        type: 'user',
        attachments: attachmentsWithData,
      })

      // Prepare workflow input
      const workflowInput: any = {
        input: sentMessage,
        conversationId: conversationId,
      }

      // Add files if any (pass the File objects directly)
      if (chatFiles.length > 0) {
        workflowInput.files = chatFiles.map((chatFile) => ({
          name: chatFile.name,
          size: chatFile.size,
          type: chatFile.type,
          file: chatFile.file, // Pass the actual File object
        }))
        workflowInput.onUploadError = (message: string) => {
          setUploadErrors((prev) => [...prev, message])
        }
      }

      // Clear input and files, refocus immediately
      setChatMessage('')
      setChatFiles([])
      setUploadErrors([])
      setStreamingMessage(null)
      focusInput(10)

      // Execute the workflow to generate a response
      result = await handleRunWorkflow({
        input: workflowInput,
        triggerType: 'chat',
        selectedOutputs,
        onEvent: (event) => appendOutputEvents(outputReader.readEvent(event)),
      })
    } catch (error) {
      logger.error('Error in handleSendMessage:', error)
      return
    }

    if (outputReader.hasEmittedContent()) {
      if (result && 'success' in result && !result.success && !streamState.errorShown) {
        appendStreamError('error' in result ? result.error : 'Workflow execution failed.')
      }
      addMessage({
        content: streamState.content,
        workflowId: currentWorkflowId,
        type: 'workflow',
      })
      setStreamingMessage(null)
    } else if (result && 'success' in result && !result.success) {
      addMessage({
        content: `Error: ${'error' in result ? result.error : 'Workflow execution failed.'}`,
        workflowId: currentWorkflowId,
        type: 'workflow',
      })
    }

    // Restore focus after workflow execution completes
    focusInput(100)
  }, [
    chatMessage,
    chatFiles,
    currentWorkflowId,
    isExecuting,
    promptHistory,
    getConversationId,
    addMessage,
    handleRunWorkflow,
    selectedOutputs,
    focusInput,
    setChatMessage,
    setChatFiles,
    setUploadErrors,
  ])

  // Handle key press
  const handleKeyPress = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (promptHistory.length > 0) {
          const newIndex =
            historyIndex === -1 ? promptHistory.length - 1 : Math.max(0, historyIndex - 1)
          setHistoryIndex(newIndex)
          setChatMessage(promptHistory[newIndex])
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex >= 0) {
          const newIndex = historyIndex + 1
          if (newIndex >= promptHistory.length) {
            setHistoryIndex(-1)
            setChatMessage('')
          } else {
            setHistoryIndex(newIndex)
            setChatMessage(promptHistory[newIndex])
          }
        }
      }
    },
    [handleSendMessage, promptHistory, historyIndex, setChatMessage]
  )

  return (
    <div className='flex h-full flex-col p-2'>
      {/* Main layout with fixed heights to ensure input stays visible */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        {/* Chat messages section - Scrollable area */}
        <div className='relative flex-1 overflow-hidden'>
          {visibleMessages.length === 0 ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              No messages yet
            </div>
          ) : (
            <div ref={scrollAreaRef} className='h-full'>
              <ScrollArea
                className={cn('h-full px-3 pb-2', !hideScrollbar)}
                hideScrollbar={hideScrollbar}
              >
                <div className='space-y-2'>
                  {visibleMessages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Input section - Fixed height */}
        <div
          className='-mt-[1px] relative flex-none pt-1'
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!(!currentWorkflowId || isExecuting)) {
              setDragCounter((prev) => prev + 1)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!(!currentWorkflowId || isExecuting)) {
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragCounter((prev) => Math.max(0, prev - 1))
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragCounter(0)
            if (!(!currentWorkflowId || isExecuting)) {
              const droppedFiles = Array.from(e.dataTransfer.files)
              if (droppedFiles.length > 0) {
                const remainingSlots = Math.max(0, 5 - chatFiles.length)
                const candidateFiles = droppedFiles.slice(0, remainingSlots)
                const errors: string[] = []
                const validNewFiles: ChatFile[] = []

                for (const file of candidateFiles) {
                  if (file.size > 10 * 1024 * 1024) {
                    errors.push(`${file.name} is too large (max 10MB)`)
                    continue
                  }

                  const isDuplicate = chatFiles.some(
                    (existingFile) =>
                      existingFile.name === file.name && existingFile.size === file.size
                  )
                  if (isDuplicate) {
                    errors.push(`${file.name} already added`)
                    continue
                  }

                  validNewFiles.push({
                    id: crypto.randomUUID(),
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    file,
                  })
                }

                if (errors.length > 0) {
                  setUploadErrors(errors)
                }

                if (validNewFiles.length > 0) {
                  setChatFiles([...chatFiles, ...validNewFiles])
                  setUploadErrors([]) // Clear errors when files are successfully added
                }
              }
            }
          }}
        >
          {/* Error messages */}
          {uploadErrors.length > 0 && (
            <div className='mb-2'>
              <div className='rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-950/20'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400' />
                  <div className='flex-1'>
                    <div className='mb-1 font-medium text-red-800 text-sm dark:text-red-300'>
                      File upload error
                    </div>
                    <div className='space-y-1'>
                      {uploadErrors.map((err, idx) => (
                        <div key={idx} className='text-red-700 text-sm dark:text-red-400'>
                          {err}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Combined input container matching copilot style */}
          <div
            className={`rounded-md border border-border bg-background p-2 shadow-xs transition-all duration-200 dark:border-[#414141] ${
              isDragOver
                ? 'border-primary-hover bg-amber-50/50 dark:border-primary-hover dark:bg-amber-950/20'
                : ''
            }`}
          >
            {/* File thumbnails */}
            {chatFiles.length > 0 && (
              <div className='mb-2 flex flex-wrap gap-1.5'>
                {chatFiles.map((file) => {
                  const isImage = file.type.startsWith('image/')
                  let previewUrl: string | null = null
                  if (isImage) {
                    const blobUrl = URL.createObjectURL(file.file)
                    if (blobUrl.startsWith('blob:')) {
                      previewUrl = blobUrl
                    }
                  }
                  const getFileIcon = (type: string) => {
                    if (type.includes('pdf'))
                      return <FileText className='h-5 w-5 text-muted-foreground' />
                    if (type.startsWith('image/'))
                      return <Image className='h-5 w-5 text-muted-foreground' />
                    if (type.includes('text') || type.includes('json'))
                      return <FileText className='h-5 w-5 text-muted-foreground' />
                    return <File className='h-5 w-5 text-muted-foreground' />
                  }
                  const formatFileSize = (bytes: number) => {
                    if (bytes === 0) return '0 B'
                    const k = 1024
                    const sizes = ['B', 'KB', 'MB', 'GB']
                    const i = Math.floor(Math.log(bytes) / Math.log(k))
                    return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
                  }

                  return (
                    <div
                      key={file.id}
                      className={`group relative overflow-hidden rounded-md border border-border/50 bg-muted/20 ${
                        previewUrl
                          ? 'h-16 w-16'
                          : 'flex h-16 min-w-[120px] max-w-[200px] items-center gap-2 px-2'
                      }`}
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <>
                          <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-background/50'>
                            {getFileIcon(file.type)}
                          </div>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate font-medium text-foreground text-xs'>
                              {file.name}
                            </div>
                            <div className='text-[10px] text-muted-foreground'>
                              {formatFileSize(file.size)}
                            </div>
                          </div>
                        </>
                      )}

                      {/* Remove button */}
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={(e) => {
                          e.stopPropagation()
                          if (previewUrl) URL.revokeObjectURL(previewUrl)
                          setChatFiles(chatFiles.filter((f) => f.id !== file.id))
                        }}
                        className='absolute top-0.5 right-0.5 h-5 w-5 bg-gray-800/80 p-0 text-white opacity-0 transition-opacity hover:bg-gray-800/80 hover:text-white group-hover:opacity-100 dark:bg-black/70 dark:hover:bg-black/70 dark:hover:text-white'
                      >
                        <X className='h-3 w-3' />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Input row */}
            <div className='flex items-center gap-1'>
              {/* Attach button */}
              <Button
                variant='ghost'
                size='icon'
                onClick={() => document.getElementById('chat-file-input')?.click()}
                disabled={!currentWorkflowId || isExecuting || chatFiles.length >= 5}
                className='h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground'
                title='Attach files'
              >
                <Paperclip className='h-3 w-3' />
              </Button>

              {/* Hidden file input */}
              <input
                id='chat-file-input'
                type='file'
                multiple
                accept='.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.xml,.rtf,image/*'
                onChange={(e) => {
                  const files = e.target.files
                  if (!files) return

                  const newFiles: ChatFile[] = []
                  const errors: string[] = []
                  for (let i = 0; i < files.length; i++) {
                    if (chatFiles.length + newFiles.length >= 5) {
                      errors.push('Maximum 5 files allowed')
                      break
                    }
                    const file = files[i]
                    if (file.size > 10 * 1024 * 1024) {
                      errors.push(`${file.name} is too large (max 10MB)`)
                      continue
                    }

                    // Check for duplicates
                    const isDuplicate = chatFiles.some(
                      (existingFile) =>
                        existingFile.name === file.name && existingFile.size === file.size
                    )
                    if (isDuplicate) {
                      errors.push(`${file.name} already added`)
                      continue
                    }

                    newFiles.push({
                      id: crypto.randomUUID(),
                      name: file.name,
                      size: file.size,
                      type: file.type,
                      file,
                    })
                  }
                  if (errors.length > 0) setUploadErrors(errors)
                  if (newFiles.length > 0) {
                    setChatFiles([...chatFiles, ...newFiles])
                    setUploadErrors([]) // Clear errors when files are successfully added
                  }
                  e.target.value = ''
                }}
                className='hidden'
                disabled={!currentWorkflowId || isExecuting}
              />

              {/* Text input */}
              <Input
                ref={inputRef}
                value={chatMessage}
                onChange={(e) => {
                  setChatMessage(e.target.value)
                  setHistoryIndex(-1)
                }}
                onKeyDown={handleKeyPress}
                placeholder={isDragOver ? 'Drop files here...' : 'Type a message...'}
                className='h-7 flex-1 border-0 bg-transparent font-sans text-foreground text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                disabled={!currentWorkflowId || isExecuting}
              />

              {/* Send button */}
              <Button
                onClick={handleSendMessage}
                size='icon'
                disabled={
                  (!chatMessage.trim() && chatFiles.length === 0) ||
                  !currentWorkflowId ||
                  isExecuting
                }
                className='h-6 w-6 shrink-0 rounded-sm bg-primary-hover text-black shadow-[0_0_0_0_var(--primary-hover)] transition-all duration-200 hover:bg-primary-hover '
              >
                <Send className='h-3 w-3' />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
