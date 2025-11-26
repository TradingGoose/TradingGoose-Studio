'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { SettingsModal } from '../../settings-modal'

const helpLogger = createLogger('HelpModal')

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const TARGET_SIZE_MB = 2
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
const SCROLL_DELAY_MS = 100
const SUCCESS_RESET_DELAY_MS = 2000
const DEFAULT_REQUEST_TYPE = 'bug'

const formSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other'], {
    required_error: 'Please select a request type',
  }),
})

type FormValues = z.infer<typeof formSchema>

interface ImageWithPreview extends File {
  preview: string
}

export interface HelpModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HelpModal({ open, onOpenChange }: HelpModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [images, setImages] = useState<ImageWithPreview[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subject: '',
      message: '',
      type: DEFAULT_REQUEST_TYPE,
    },
    mode: 'onSubmit',
  })

  useEffect(() => {
    if (open) {
      setSubmitStatus(null)
      setErrorMessage('')
      setImageError(null)
      setImages([])
      setIsDragging(false)
      setIsProcessing(false)
      reset({
        subject: '',
        message: '',
        type: DEFAULT_REQUEST_TYPE,
      })
    }
  }, [open, reset])

  useEffect(() => {
    setValue('type', DEFAULT_REQUEST_TYPE)
  }, [setValue])

  useEffect(() => {
    return () => {
      images.forEach((image) => URL.revokeObjectURL(image.preview))
    }
  }, [images])

  useEffect(() => {
    if (submitStatus === 'success') {
      const timer = setTimeout(() => {
        setSubmitStatus(null)
      }, SUCCESS_RESET_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [submitStatus])

  useEffect(() => {
    if (images.length > 0 && scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current
      setTimeout(() => {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }, SCROLL_DELAY_MS)
    }
  }, [images.length])

  const compressImage = useCallback(async (file: File): Promise<File> => {
    if (file.size < TARGET_SIZE_MB * 1024 * 1024 || file.type === 'image/gif') {
      return file
    }

    const options = {
      maxSizeMB: TARGET_SIZE_MB,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type,
      initialQuality: 0.8,
      alwaysKeepResolution: true,
    }

    try {
      const compressedFile = await imageCompression(file, options)
      return new File([compressedFile], file.name, {
        type: file.type,
        lastModified: Date.now(),
      })
    } catch (error) {
      helpLogger.warn('Image compression failed, using original file:', { error })
      return file
    }
  }, [])

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      setImageError(null)

      if (!files || files.length === 0) return

      setIsProcessing(true)

      try {
        const newImages: ImageWithPreview[] = []
        let hasError = false

        for (const file of Array.from(files)) {
          if (file.size > MAX_FILE_SIZE) {
            setImageError(`File ${file.name} is too large. Maximum size is 20MB.`)
            hasError = true
            continue
          }

          if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
            setImageError(
              `File ${file.name} has an unsupported format. Please use JPEG, PNG, WebP, or GIF.`
            )
            hasError = true
            continue
          }

          const compressedFile = await compressImage(file)
          const imageWithPreview = Object.assign(compressedFile, {
            preview: URL.createObjectURL(compressedFile),
          }) as ImageWithPreview

          newImages.push(imageWithPreview)
        }

        if (!hasError && newImages.length > 0) {
          setImages((prev) => [...prev, ...newImages])
        }
      } catch (error) {
        helpLogger.error('Error processing images:', { error })
        setImageError('An error occurred while processing images. Please try again.')
      } finally {
        setIsProcessing(false)

        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [compressImage]
  )

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        await processFiles(e.target.files)
      }
    },
    [processFiles]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await processFiles(e.dataTransfer.files)
      }
    },
    [processFiles]
  )

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const onSubmit = useCallback(
    async (data: FormValues) => {
      setIsSubmitting(true)
      setSubmitStatus(null)
      setErrorMessage('')

      try {
        const formData = new FormData()
        formData.append('subject', data.subject)
        formData.append('message', data.message)
        formData.append('type', data.type)

        images.forEach((image, index) => {
          formData.append(`image_${index}`, image)
        })

        const response = await fetch('/api/help', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to submit help request')
        }

        setSubmitStatus('success')
        reset()

        images.forEach((image) => URL.revokeObjectURL(image.preview))
        setImages([])
      } catch (error) {
        helpLogger.error('Error submitting help request:', { error })
        setSubmitStatus('error')
        setErrorMessage(error instanceof Error ? error.message : 'An unknown error occurred')
      } finally {
        setIsSubmitting(false)
      }
    },
    [images, reset]
  )

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title='Help & Support'
      contentClassName='flex h-[75vh] flex-col p-0'
    >
      <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
        <div ref={scrollContainerRef} className='scrollbar-hide min-h-0 flex-1 overflow-y-auto pb-20'>
          <div className='px-6'>
            <div className='space-y-4'>
              <div className='space-y-1'>
                <Label htmlFor='type'>Request</Label>
                <Select
                  defaultValue={DEFAULT_REQUEST_TYPE}
                  onValueChange={(value) => setValue('type', value as FormValues['type'])}
                >
                  <SelectTrigger
                    id='type'
                    className={cn('h-9 rounded-sm', errors.type && 'border-red-500')}
                  >
                    <SelectValue placeholder='Select a request type' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='bug'>Bug Report</SelectItem>
                    <SelectItem value='feedback'>Feedback</SelectItem>
                    <SelectItem value='feature_request'>Feature Request</SelectItem>
                    <SelectItem value='other'>Other</SelectItem>
                  </SelectContent>
                </Select>
                {errors.type && <p className='mt-1 text-red-500 text-sm'>{errors.type.message}</p>}
              </div>

              <div className='space-y-1'>
                <Label htmlFor='subject'>Subject</Label>
                <Input
                  id='subject'
                  placeholder='Brief description of your request'
                  {...register('subject')}
                  className={cn('h-9 rounded-sm', errors.subject && 'border-red-500')}
                />
                {errors.subject && (
                  <p className='mt-1 text-red-500 text-sm'>{errors.subject.message}</p>
                )}
              </div>

              <div className='space-y-1'>
                <Label htmlFor='message'>Message</Label>
                <Textarea
                  id='message'
                  placeholder='Please provide details about your request...'
                  rows={6}
                  {...register('message')}
                  className={cn('rounded-sm', errors.message && 'border-red-500')}
                />
                {errors.message && (
                  <p className='mt-1 text-red-500 text-sm'>{errors.message.message}</p>
                )}
              </div>

              <div className='mt-6 space-y-1'>
                <Label>Attach Images (Optional)</Label>
                <div
                  ref={dropZoneRef}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'cursor-pointer rounded-lg border-[1.5px] border-muted-foreground/25 border-dashed p-6 text-center transition-colors hover:bg-card/50',
                    isDragging && 'border-primary bg-[var(--primary)]/5'
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept={ACCEPTED_IMAGE_TYPES.join(',')}
                    onChange={handleFileChange}
                    className='hidden'
                    multiple
                  />
                  <p className='text-sm'>
                    {isDragging ? 'Drop images here!' : 'Drop images here or click to browse'}
                  </p>
                  <p className='mt-1 text-muted-foreground text-xs'>
                    JPEG, PNG, WebP, GIF (max 20MB each)
                  </p>
                </div>
                {imageError && <p className='mt-1 text-red-500 text-sm'>{imageError}</p>}
                {isProcessing && <p className='text-muted-foreground text-sm'>Processing images...</p>}
              </div>

              {images.length > 0 && (
                <div className='space-y-1'>
                  <Label>Uploaded Images</Label>
                  <div className='grid grid-cols-2 gap-4'>
                    {images.map((image, index) => (
                      <div key={index} className='group relative overflow-hidden rounded-md border'>
                        <div className='relative aspect-video'>
                          <Image src={image.preview} alt={`Preview ${index + 1}`} fill className='object-cover' />
                          <div
                            className='absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100'
                            onClick={() => removeImage(index)}
                          >
                            <X className='h-6 w-6 text-white' />
                          </div>
                        </div>
                        <div className='truncate bg-muted/50 p-2 text-xs'>{image.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className='border-t bg-background'>
          <div className='flex w-full items-center justify-between px-6 py-4'>
            <Button variant='outline' onClick={handleClose} type='button'>
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={isSubmitting || isProcessing}
              variant={
                submitStatus === 'error' || submitStatus === 'success' ? 'outline' : 'default'
              }
              className={cn(
                'font-[480] transition-all duration-200',
                submitStatus === 'error'
                  ? 'border border-red-500 bg-transparent text-red-500 hover:bg-red-500 hover:text-white dark:border-red-500 dark:text-red-500 dark:hover:bg-red-500'
                  : submitStatus === 'success'
                    ? 'border border-green-500 bg-transparent text-green-500 hover:bg-green-500 hover:text-white dark:border-green-500 dark:text-green-500 dark:hover:bg-green-500'
                    : 'bg-primary text-black  hover:bg-primary-hover disabled:opacity-50 disabled:hover:shadow-none'
              )}
            >
              {isSubmitting
                ? 'Submitting...'
                : submitStatus === 'error'
                  ? 'Error'
                  : submitStatus === 'success'
                    ? 'Success'
                    : 'Submit'}
            </Button>
          </div>
          {submitStatus === 'error' ? (
            <p className='px-6 pb-4 text-red-500 text-sm'>{errorMessage}</p>
          ) : null}
        </div>
      </form>
    </SettingsModal>
  )
}
