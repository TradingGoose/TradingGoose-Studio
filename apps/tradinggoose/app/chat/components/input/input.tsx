'use client'

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Paperclip, Send, Square, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTemplate } from '@/i18n/utils'
import type { Messages } from 'next-intl'

type ChatMessages = Messages['chat']
import { VoiceInput } from '@/app/chat/components/input/voice-input'

const MAX_TEXTAREA_HEIGHT = 120 // Max height in pixels (e.g., for about 3-4 lines)
const MAX_TEXTAREA_HEIGHT_MOBILE = 100 // Smaller for mobile

interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  file: File
  dataUrl?: string
}

export const ChatInput: React.FC<{
  onSubmit?: (value: string, isVoiceInput?: boolean, files?: AttachedFile[]) => void
  isLoading: boolean
  isStreaming?: boolean
  onStopStreaming?: () => void
  onVoiceStart?: () => void
  voiceOnly?: boolean
  copy: ChatMessages
}> = ({
  onSubmit,
  isLoading,
  isStreaming = false,
  onStopStreaming,
  onVoiceStart,
  voiceOnly = false,
  copy,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isActive, setIsActive] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [dragCounter, setDragCounter] = useState(0)
  const isDragOver = dragCounter > 0

  const isSttAvailable =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto'
      const scrollHeight = el.scrollHeight

      const isMobile = window.innerWidth < 768
      const maxHeight = isMobile ? MAX_TEXTAREA_HEIGHT_MOBILE : MAX_TEXTAREA_HEIGHT

      if (scrollHeight > maxHeight) {
        el.style.height = `${maxHeight}px`
        el.style.overflowY = 'auto'
      } else {
        el.style.height = `${scrollHeight}px`
        el.style.overflowY = 'hidden'
      }
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [inputValue])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        if (!inputValue) {
          setIsActive(false)
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.overflowY = 'hidden'
          }
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [inputValue])

  useEffect(() => {
    if (isActive && textareaRef.current) {
      textareaRef.current.focus()
      adjustTextareaHeight()
    }
  }, [isActive])

  const handleActivate = () => {
    setIsActive(true)
  }

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return

    const newFiles: AttachedFile[] = []
    const maxSize = 10 * 1024 * 1024
    const maxFiles = 5

    for (let i = 0; i < selectedFiles.length; i++) {
      if (attachedFiles.length + newFiles.length >= maxFiles) break

      const file = selectedFiles[i]

      if (file.size > maxSize) {
        setUploadErrors((prev) => [
          ...prev,
          formatTemplate(copy.input.fileTooLarge, { name: file.name }),
        ])
        continue
      }

      const isDuplicate = attachedFiles.some(
        (existingFile) => existingFile.name === file.name && existingFile.size === file.size
      )
      if (isDuplicate) {
        setUploadErrors((prev) => [
          ...prev,
          formatTemplate(copy.input.fileAlreadyAdded, { name: file.name }),
        ])
        continue
      }

      let dataUrl: string | undefined
      if (file.type.startsWith('image/')) {
        try {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
        } catch (error) {
          console.error('Error reading file:', error)
        }
      }

      newFiles.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        file,
        dataUrl,
      })
    }

    if (newFiles.length > 0) {
      setAttachedFiles([...attachedFiles, ...newFiles])
      setUploadErrors([])
    }
  }

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles(attachedFiles.filter((f) => f.id !== fileId))
  }

  const handleSubmit = () => {
    if (isLoading || (!inputValue.trim() && attachedFiles.length === 0)) return
    onSubmit?.(inputValue.trim(), false, attachedFiles)
    setInputValue('')
    setAttachedFiles([])
    setUploadErrors([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.overflowY = 'hidden'
    }
    setIsActive(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value)
  }

  const handleVoiceStart = () => {
    onVoiceStart?.()
  }

  if (voiceOnly) {
    return (
      <div className='flex items-center justify-center'>
        {isSttAvailable && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <div>
                    <VoiceInput
                      onVoiceStart={handleVoiceStart}
                      disabled={isStreaming}
                      large={true}
                      title={copy.input.startVoiceConversation}
                    />
                  </div>
                }
              />
              <TooltipContent side='top'>
                <p>{copy.input.startVoiceConversation}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    )
  }

  return (
    <>
      <div className='fixed right-0 bottom-0 left-0 flex w-full items-center justify-center bg-gradient-to-t from-white to-transparent px-4 pb-4 text-black md:px-0 md:pb-4'>
        <div ref={wrapperRef} className='w-full max-w-3xl md:max-w-[748px]'>
          {uploadErrors.length > 0 && (
            <div className='mb-3'>
              <div className='rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-950/20'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400' />
                  <div className='flex-1'>
                    <div className='mb-1 font-medium text-red-800 text-sm dark:text-red-300'>
                      {copy.input.fileUploadErrorTitle}
                    </div>
                    <div className='space-y-1'>
                      {uploadErrors.map((error, idx) => (
                        <div key={idx} className='text-red-700 text-sm dark:text-red-400'>
                          {error}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <motion.div
            className={`rounded-2xl border shadow-sm transition-all duration-200 md:rounded-3xl ${
              isDragOver
                ? 'border-amber-500 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-950/20'
                : 'border-gray-200'
            }`}
            onClick={handleActivate}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isStreaming) {
                setDragCounter((prev) => prev + 1)
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!isStreaming) {
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
              if (!isStreaming) {
                handleFileSelect(e.dataTransfer.files)
              }
            }}
          >
            {attachedFiles.length > 0 && (
              <div className='mb-2 flex flex-wrap gap-2 px-3 pt-3 md:px-4'>
                {attachedFiles.map((file) => {
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
                      className={`group relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 ${
                        file.dataUrl
                          ? 'h-16 w-16 md:h-20 md:w-20'
                          : 'flex h-16 min-w-[120px] max-w-[200px] items-center gap-2 px-2 md:h-20 md:min-w-[140px] md:max-w-[220px] md:px-3'
                      }`}
                      title=''
                    >
                      {file.dataUrl ? (
                        <img
                          src={file.dataUrl}
                          alt={file.name}
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <>
                          <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-gray-100 md:h-10 md:w-10 dark:bg-gray-700'>
                            <Paperclip
                              size={16}
                              className='text-gray-500 md:h-5 md:w-5 dark:text-gray-400'
                            />
                          </div>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate font-medium text-gray-800 text-xs dark:text-gray-200'>
                              {file.name}
                            </div>
                            <div className='text-[10px] text-gray-500 dark:text-gray-400'>
                              {formatFileSize(file.size)}
                            </div>
                          </div>
                        </>
                      )}
                      <button
                        type='button'
                        onClick={() => handleRemoveFile(file.id)}
                        aria-label={formatTemplate(copy.input.removeFile, { name: file.name })}
                        className='absolute top-1 right-1 rounded-full bg-gray-800/80 p-1 text-white opacity-0 transition-opacity hover:bg-gray-800/80 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100 dark:bg-black/70 dark:hover:bg-black/70 dark:hover:text-white'
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className='flex items-center gap-2 p-3 md:p-4'>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type='button'
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming || attachedFiles.length >= 5}
                        aria-label={copy.input.attachFiles}
                        className='flex items-center justify-center rounded-full p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 md:p-2'
                      >
                        <Paperclip size={16} className='md:h-5 md:w-5' />
                      </button>
                    }
                  />
                  <TooltipContent side='top'>
                    <p>{copy.input.attachFiles}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <input
                ref={fileInputRef}
                type='file'
                aria-label={copy.input.attachFiles}
                multiple
                accept='.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.xml,.rtf,image/*'
                onChange={(e) => {
                  handleFileSelect(e.target.files)
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ''
                  }
                }}
                className='hidden'
                disabled={isStreaming}
              />

              <div className='relative flex-1'>
                <textarea
                  ref={textareaRef}
                  aria-label={copy.input.placeholderDesktop}
                  value={inputValue}
                  onChange={handleInputChange}
                  className='flex w-full resize-none items-center overflow-hidden rounded-sm bg-transparent text-base placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:font-[330]'
                  placeholder={isDragOver ? copy.input.dropFilesHere : isActive ? '' : ''}
                  rows={1}
                  style={{
                    minHeight: window.innerWidth >= 768 ? '24px' : '28px',
                    lineHeight: '1.4',
                    paddingTop: window.innerWidth >= 768 ? '4px' : '3px',
                    paddingBottom: window.innerWidth >= 768 ? '4px' : '3px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                />

                <div className='pointer-events-none absolute top-0 left-0 flex h-full w-full items-center'>
                  {!isActive && !inputValue && (
                    <>
                      <div
                        className='-translate-y-1/2 absolute top-1/2 left-0 transform select-none text-base text-gray-400 md:hidden'
                        style={{ paddingTop: '3px', paddingBottom: '3px' }}
                      >
                        {isDragOver ? copy.input.dropFilesHere : copy.input.placeholderMobile}
                      </div>
                      <div
                        className='-translate-y-1/2 absolute top-1/2 left-0 hidden transform select-none font-[330] text-base text-gray-400 md:block'
                        style={{ paddingTop: '4px', paddingBottom: '4px' }}
                      >
                        {isDragOver ? copy.input.dropFilesHere : copy.input.placeholderDesktop}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {isSttAvailable && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div>
                          <VoiceInput
                            onVoiceStart={handleVoiceStart}
                            disabled={isStreaming}
                            minimal
                            title={copy.input.startVoiceConversation}
                          />
                        </div>
                      }
                    />
                    <TooltipContent side='top'>
                      <p>{copy.input.startVoiceConversation}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <button
                className={`flex items-center justify-center rounded-full p-1.5 text-white transition-colors md:p-2 ${
                  inputValue.trim() || attachedFiles.length > 0
                    ? 'bg-black hover:bg-zinc-700'
                    : 'cursor-default bg-gray-300 hover:bg-gray-400'
                }`}
                title={isStreaming ? copy.input.stop : copy.input.send}
                aria-label={isStreaming ? copy.input.stop : copy.input.send}
                aria-busy={isLoading && !isStreaming}
                disabled={isLoading && !isStreaming}
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  if (isStreaming) {
                    onStopStreaming?.()
                  } else {
                    handleSubmit()
                  }
                }}
              >
                {isStreaming ? (
                  <>
                    <Square size={16} className='md:hidden' />
                    <Square size={18} className='hidden md:block' />
                  </>
                ) : (
                  <>
                    <Send size={16} className='md:hidden' />
                    <Send size={18} className='hidden md:block' />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  )
}
