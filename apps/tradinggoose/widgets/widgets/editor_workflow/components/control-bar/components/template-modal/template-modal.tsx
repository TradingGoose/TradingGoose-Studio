'use client'

import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Calculator,
  Cloud,
  Code,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Edit,
  Eye,
  FileText,
  Folder,
  Globe,
  HeadphonesIcon,
  Layers,
  Lightbulb,
  LineChart,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Phone,
  Play,
  Search,
  Server,
  Settings,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  User,
  Users,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
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
import { ColorPicker } from '@/components/ui/color-picker'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { buildWorkflowStateForTemplate } from '@/lib/workflows/state-builder'
import { categories } from '@/app/workspace/[workspaceId]/templates/templates'
import type { PublicCopy } from '@/i18n/client-messages'
import { useWorkspaceBlockEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

const logger = createLogger('TemplateModal')

type TemplateFormData = {
  name: string
  description: string
  author: string
  category: string
  icon: string
  color: string
}

interface TemplateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
}

const icons = [
  // Content & Documentation
  { value: 'FileText', component: FileText },
  { value: 'NotebookPen', component: NotebookPen },
  { value: 'BookOpen', component: BookOpen },
  { value: 'Edit', component: Edit },

  // Analytics & Charts
  { value: 'BarChart3', component: BarChart3 },
  { value: 'LineChart', component: LineChart },
  { value: 'TrendingUp', component: TrendingUp },
  { value: 'Target', component: Target },

  // Database & Storage
  { value: 'Database', component: Database },
  { value: 'Server', component: Server },
  { value: 'Cloud', component: Cloud },
  { value: 'Folder', component: Folder },

  // Marketing & Communication
  { value: 'Megaphone', component: Megaphone },
  { value: 'Mail', component: Mail },
  { value: 'MessageSquare', component: MessageSquare },
  { value: 'Phone', component: Phone },
  { value: 'Bell', component: Bell },

  // Sales & Finance
  { value: 'DollarSign', component: DollarSign },
  { value: 'CreditCard', component: CreditCard },
  { value: 'Calculator', component: Calculator },
  { value: 'ShoppingCart', component: ShoppingCart },
  { value: 'Briefcase', component: Briefcase },

  // Support & Service
  { value: 'HeadphonesIcon', component: HeadphonesIcon },
  { value: 'User', component: User },
  { value: 'Users', component: Users },
  { value: 'Settings', component: Settings },
  { value: 'Wrench', component: Wrench },

  // AI & Technology
  { value: 'Bot', component: Bot },
  { value: 'Brain', component: Brain },
  { value: 'Cpu', component: Cpu },
  { value: 'Code', component: Code },
  { value: 'Zap', component: Zap },

  // Workflow & Process
  { value: 'Workflow', component: Workflow },
  { value: 'Search', component: Search },
  { value: 'Play', component: Play },
  { value: 'Layers', component: Layers },

  // General
  { value: 'Lightbulb', component: Lightbulb },
  { value: 'Star', component: Star },
  { value: 'Globe', component: Globe },
  { value: 'Award', component: Award },
]

function getTemplateCategoryLabel(
  category: (typeof categories)[number]['value'],
  copy: PublicCopy['workspace']['widgets']['blockEditor']['templateModal']
) {
  switch (category) {
    case 'marketing':
      return copy.categories.marketing
    case 'sales':
      return copy.categories.sales
    case 'finance':
      return copy.categories.finance
    case 'support':
      return copy.categories.support
    case 'artificial-intelligence':
      return copy.categories.artificialIntelligence
    case 'other':
      return copy.categories.other
  }
}

function getTemplateIconLabel(
  icon: (typeof icons)[number]['value'],
  copy: PublicCopy['workspace']['widgets']['blockEditor']['templateModal']
) {
  switch (icon) {
    case 'FileText':
      return copy.icons.fileText
    case 'NotebookPen':
      return copy.icons.notebook
    case 'BookOpen':
      return copy.icons.book
    case 'Edit':
      return copy.icons.edit
    case 'BarChart3':
      return copy.icons.barChart
    case 'LineChart':
      return copy.icons.lineChart
    case 'TrendingUp':
      return copy.icons.trendingUp
    case 'Target':
      return copy.icons.target
    case 'Database':
      return copy.icons.database
    case 'Server':
      return copy.icons.server
    case 'Cloud':
      return copy.icons.cloud
    case 'Folder':
      return copy.icons.folder
    case 'Megaphone':
      return copy.icons.megaphone
    case 'Mail':
      return copy.icons.mail
    case 'MessageSquare':
      return copy.icons.message
    case 'Phone':
      return copy.icons.phone
    case 'Bell':
      return copy.icons.bell
    case 'DollarSign':
      return copy.icons.dollarSign
    case 'CreditCard':
      return copy.icons.creditCard
    case 'Calculator':
      return copy.icons.calculator
    case 'ShoppingCart':
      return copy.icons.shoppingCart
    case 'Briefcase':
      return copy.icons.briefcase
    case 'HeadphonesIcon':
      return copy.icons.headphones
    case 'User':
      return copy.icons.user
    case 'Users':
      return copy.icons.users
    case 'Settings':
      return copy.icons.settings
    case 'Wrench':
      return copy.icons.wrench
    case 'Bot':
      return copy.icons.bot
    case 'Brain':
      return copy.icons.brain
    case 'Cpu':
      return copy.icons.cpu
    case 'Code':
      return copy.icons.code
    case 'Zap':
      return copy.icons.zap
    case 'Workflow':
      return copy.icons.workflow
    case 'Search':
      return copy.icons.search
    case 'Play':
      return copy.icons.play
    case 'Layers':
      return copy.icons.layers
    case 'Lightbulb':
      return copy.icons.lightbulb
    case 'Star':
      return copy.icons.star
    case 'Globe':
      return copy.icons.globe
    case 'Award':
      return copy.icons.award
  }
}

export function TemplateModal({ open, onOpenChange, workflowId }: TemplateModalProps) {
  const copy = useWorkspaceBlockEditorCopy().templateModal
  const { data: session } = useSession()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false)
  const [existingTemplate, setExistingTemplate] = useState<any>(null)
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const templateSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, copy.validation.nameRequired)
          .max(100, copy.validation.nameTooLong),
        description: z
          .string()
          .min(1, copy.validation.descriptionRequired)
          .max(500, copy.validation.descriptionTooLong),
        author: z
          .string()
          .min(1, copy.validation.authorRequired)
          .max(100, copy.validation.authorTooLong),
        category: z.string().min(1, copy.validation.categoryRequired),
        icon: z.string().min(1, copy.validation.iconRequired),
        color: z.string().regex(/^#[0-9A-F]{6}$/i, copy.validation.colorInvalid),
      }),
    [copy.validation]
  )

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: '',
      description: '',
      author: session?.user?.name || session?.user?.email || '',
      category: '',
      icon: 'FileText',
      color: '#3972F6',
    },
  })

  // Watch form state to determine if all required fields are valid
  const formValues = form.watch()
  const isFormValid =
    form.formState.isValid &&
    formValues.name?.trim() &&
    formValues.description?.trim() &&
    formValues.author?.trim() &&
    formValues.category

  // Check for existing template when modal opens
  useEffect(() => {
    if (open && workflowId) {
      checkExistingTemplate()
    }
  }, [open, workflowId])

  const checkExistingTemplate = async () => {
    setIsLoadingTemplate(true)
    try {
      const response = await fetch(`/api/templates?workflowId=${workflowId}&limit=1`)
      if (response.ok) {
        const result = await response.json()
        const template = result.data?.[0] || null
        setExistingTemplate(template)

        // Pre-fill form with existing template data
        if (template) {
          form.reset({
            name: template.name,
            description: template.description,
            author: template.author,
            category: template.category,
            icon: template.icon,
            color: template.color,
          })
        } else {
          // No existing template found
          setExistingTemplate(null)
          // Reset form to defaults
          form.reset({
            name: '',
            description: '',
            author: session?.user?.name || session?.user?.email || '',
            category: '',
            icon: 'FileText',
            color: '#3972F6',
          })
        }
      }
    } catch (error) {
      logger.error('Error checking existing template:', error)
      setExistingTemplate(null)
    } finally {
      setIsLoadingTemplate(false)
    }
  }

  const onSubmit = async (data: TemplateFormData) => {
    if (!session?.user) {
      logger.error('User not authenticated')
      return
    }

    form.clearErrors('root')
    setIsSubmitting(true)

    try {
      // Create the template state from current workflow using the same format as deployment
      const templateState = buildWorkflowStateForTemplate(workflowId)
      if (!templateState) {
        form.setError('root', {
          type: 'manual',
          message: copy.errors.workflowNotReady,
        })
        return
      }

      const templateData = {
        workflowId,
        name: data.name,
        description: data.description || '',
        author: data.author,
        category: data.category,
        icon: data.icon,
        color: data.color,
        state: templateState,
      }

      let response
      if (existingTemplate) {
        // Update existing template
        response = await fetch(`/api/templates/${existingTemplate.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(templateData),
        })
      } else {
        // Create new template
        response = await fetch('/api/templates', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(templateData),
        })
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || (existingTemplate ? copy.errors.update : copy.errors.create))
      }

      const result = await response.json()
      logger.info(`Template ${existingTemplate ? 'updated' : 'created'} successfully:`, result)

      // Reset form and close modal
      form.reset()
      onOpenChange(false)

      // TODO: Show success toast/notification
    } catch (error) {
      logger.error('Failed to create template:', error)
      // TODO: Show error toast/notification
    } finally {
      setIsSubmitting(false)
    }
  }

  const SelectedIconComponent =
    icons.find((icon) => icon.value === form.watch('icon'))?.component || FileText
  const selectedIconLabel = getTemplateIconLabel(form.watch('icon'), copy)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='flex h-[70vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <DialogTitle className='font-medium text-lg'>
                {isLoadingTemplate
                  ? copy.title.loading
                  : existingTemplate
                    ? copy.title.update
                    : copy.title.publish}
              </DialogTitle>
              {existingTemplate && (
                <div className='flex items-center gap-1'>
                  {existingTemplate.stars > 0 && (
                    <div className='flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-1 dark:bg-yellow-900/20'>
                      <Star className='h-3 w-3 fill-yellow-400 text-yellow-400' />
                      <span className='font-medium text-xs text-yellow-700 dark:text-yellow-300'>
                        {existingTemplate.stars}
                      </span>
                    </div>
                  )}
                  {existingTemplate.views > 0 && (
                    <div className='flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 dark:bg-blue-900/20'>
                      <Eye className='h-3 w-3 text-blue-500' />
                      <span className='font-medium text-blue-700 text-xs dark:text-blue-300'>
                        {existingTemplate.views}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button
              variant='ghost'
              size='icon'
              className={cn(
                'h-8 w-8 rounded-md p-0 text-muted-foreground/70 transition-all duration-200',
                'hover:scale-105 hover:bg-card/50 hover:text-foreground',
                'active:scale-95',
                'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
              )}
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>{copy.actions.close}</span>
            </Button>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-1 flex-col overflow-hidden'
          >
            <div className='flex-1 overflow-y-auto px-6 py-4'>
              {isLoadingTemplate ? (
                <div className='space-y-6'>
                  {/* Icon and Color row */}
                  <div className='flex gap-3'>
                    <div className='w-20'>
                      <Skeleton className='mb-2 h-4 w-8' /> {/* Label */}
                      <Skeleton className='h-10 w-20' /> {/* Icon picker */}
                    </div>
                    <div className='w-20'>
                      <Skeleton className='mb-2 h-4 w-10' /> {/* Label */}
                      <Skeleton className='h-10 w-20' /> {/* Color picker */}
                    </div>
                  </div>

                  {/* Name field */}
                  <div>
                    <Skeleton className='mb-2 h-4 w-12' /> {/* Label */}
                    <Skeleton className='h-10 w-full' /> {/* Input */}
                  </div>

                  {/* Author and Category row */}
                  <div className='grid grid-cols-2 gap-4'>
                    <div>
                      <Skeleton className='mb-2 h-4 w-14' /> {/* Label */}
                      <Skeleton className='h-10 w-full' /> {/* Input */}
                    </div>
                    <div>
                      <Skeleton className='mb-2 h-4 w-16' /> {/* Label */}
                      <Skeleton className='h-10 w-full' /> {/* Select */}
                    </div>
                  </div>

                  {/* Description field */}
                  <div>
                    <Skeleton className='mb-2 h-4 w-20' /> {/* Label */}
                    <Skeleton className='h-20 w-full' /> {/* Textarea */}
                  </div>
                </div>
              ) : (
                <div className='space-y-5'>
                  <div className='flex gap-3'>
                    <FormField
                      control={form.control}
                      name='icon'
                      render={({ field }) => (
                        <FormItem className='w-20'>
                          <FormLabel className='!text-foreground font-medium text-sm'>
                            {copy.fields.icon}
                          </FormLabel>
                          <Popover open={iconPopoverOpen} onOpenChange={setIconPopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                variant='outline'
                                role='combobox'
                                aria-label={selectedIconLabel}
                                title={selectedIconLabel}
                                className='h-10 w-20 rounded-sm border-border/50 p-0 transition-all duration-200 hover:border-border hover:bg-card/50'
                              >
                                <SelectedIconComponent className='h-4 w-4' />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className='z-50 w-84 rounded-sm p-0' align='start'>
                              <div className='p-3'>
                                <div className='grid max-h-80 grid-cols-8 gap-2 overflow-y-auto'>
                                  {icons.map((icon) => {
                                    const IconComponent = icon.component
                                    return (
                                      <button
                                        key={icon.value}
                                        type='button'
                                        aria-label={getTemplateIconLabel(icon.value, copy)}
                                        title={getTemplateIconLabel(icon.value, copy)}
                                        onClick={() => {
                                          field.onChange(icon.value)
                                          setIconPopoverOpen(false)
                                        }}
                                        className={cn(
                                          'flex h-8 w-8 items-center justify-center rounded-md border border-border/40 transition-all duration-200',
                                          'hover:scale-105 hover:border-border hover:bg-card/50 active:scale-95',
                                          field.value === icon.value &&
                                          'border-primary/30 bg-[var(--primary)]/10 text-primary'
                                        )}
                                      >
                                        <IconComponent className='h-4 w-4' />
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name='color'
                      render={({ field }) => (
                        <FormItem className='w-20'>
                          <FormLabel className='!text-foreground font-medium text-sm'>
                            {copy.fields.color}
                          </FormLabel>
                          <FormControl>
                            <ColorPicker
                              value={field.value}
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                              className='h-10 w-20 rounded-sm'
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name='name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className='!text-foreground font-medium text-sm'>
                          {copy.fields.name}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={copy.placeholders.name}
                            className='h-10 rounded-sm'
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className='grid grid-cols-2 gap-4'>
                    <FormField
                      control={form.control}
                      name='author'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className='!text-foreground font-medium text-sm'>
                            {copy.fields.author}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={copy.placeholders.author}
                              className='h-10 rounded-sm'
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name='category'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className='!text-foreground font-medium text-sm'>
                            {copy.fields.category}
                          </FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className='h-10 rounded-sm'>
                                <SelectValue placeholder={copy.placeholders.category} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.map((category) => (
                                <SelectItem key={category.value} value={category.value}>
                                  {getTemplateCategoryLabel(category.value, copy)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name='description'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className='!text-foreground font-medium text-sm'>
                          {copy.fields.description}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={copy.placeholders.description}
                            className='min-h-[80px] resize-none rounded-sm'
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </div>

            {/* Fixed Footer */}
            <div className='mt-auto border-t px-6 py-4'>
              <div className='flex items-center gap-3'>
                {form.formState.errors.root?.message ? (
                  <p className='text-destructive text-sm'>{form.formState.errors.root.message}</p>
                ) : null}
                {existingTemplate && (
                  <Button
                    type='button'
                    variant='destructive'
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={isSubmitting || isLoadingTemplate}
                    className='h-9 rounded-sm px-4'
                  >
                    {copy.actions.delete}
                  </Button>
                )}
                <Button
                  type='submit'
                  disabled={isSubmitting || !isFormValid || isLoadingTemplate}
                  className={cn(
                    'ml-auto h-9 rounded-sm px-4 font-[480]',
                    'bg-primary hover:bg-primary-hover',
                    'shadow-[0_0_0_0_var(--primary)] ',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-primary disabled:hover:shadow-none'
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {existingTemplate ? copy.submit.updating : copy.submit.publishing}
                    </>
                  ) : existingTemplate ? (
                    copy.submit.update
                  ) : (
                    copy.submit.publish
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
        {existingTemplate && (
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{copy.delete.title}</AlertDialogTitle>
                <AlertDialogDescription>{copy.delete.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className='flex'>
                <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
                  {copy.delete.cancel}
                </AlertDialogCancel>
                <AlertDialogAction
                  className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                  disabled={isDeleting}
                  onClick={async () => {
                    if (!existingTemplate) return
                    setIsDeleting(true)
                    try {
                      const resp = await fetch(`/api/templates/${existingTemplate.id}`, {
                        method: 'DELETE',
                      })
                      if (!resp.ok) {
                        const err = await resp.json().catch(() => ({}))
                        throw new Error(err.error || copy.errors.delete)
                      }
                      setShowDeleteDialog(false)
                      onOpenChange(false)
                    } catch (err) {
                      logger.error('Failed to delete template', err)
                    } finally {
                      setIsDeleting(false)
                    }
                  }}
                >
                  {isDeleting ? copy.delete.deleting : copy.delete.confirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </DialogContent>
    </Dialog>
  )
}
