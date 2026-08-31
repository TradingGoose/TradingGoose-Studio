import { motion } from 'framer-motion'
import { Circle, CircleOff, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

interface ActionBarProps {
  selectedCount: number
  onEnable?: () => void
  onDisable?: () => void
  onDelete?: () => void
  enabledCount?: number
  disabledCount?: number
  busy?: boolean
  className?: string
}

export function ActionBar({
  selectedCount,
  onEnable,
  onDisable,
  onDelete,
  enabledCount = 0,
  disabledCount = 0,
  busy = false,
  className,
}: ActionBarProps) {
  const userPermissions = useUserPermissionsContext()
  const t = useTranslations('workspace.knowledge.actionBar')

  if (selectedCount === 0) return null

  const canEdit = userPermissions.canEdit
  const showEnableButton = disabledCount > 0 && onEnable && canEdit
  const showDisableButton = enabledCount > 0 && onDisable && canEdit
  const selectedLabel = t('selectedItems', { count: selectedCount })
  const enableLabel = t('enableItems', { count: disabledCount })
  const disableLabel = t('disableItems', { count: enabledCount })
  const deleteLabel = t('deleteItems', { count: selectedCount })

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className={cn('-translate-x-1/2 fixed bottom-6 left-1/2 z-50 transform', className)}
    >
      <div className='flex items-center gap-3 rounded-lg border border-gray-200 bg-background px-4 py-2 shadow-sm dark:border-gray-800'>
        <span className='text-gray-500 text-sm'>{selectedLabel}</span>

        <div className='h-4 w-px bg-gray-200 dark:bg-gray-800' />

        <div className='flex items-center gap-1'>
          {showEnableButton && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='sm'
                    aria-label={enableLabel}
                    onClick={onEnable}
                    disabled={busy}
                    className='text-gray-500 hover:text-gray-700'
                  >
                    <Circle aria-hidden='true' className='h-4 w-4' />
                  </Button>
                }
              />
              <TooltipContent side='top'>{enableLabel}</TooltipContent>
            </Tooltip>
          )}

          {showDisableButton && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='sm'
                    aria-label={disableLabel}
                    onClick={onDisable}
                    disabled={busy}
                    className='text-gray-500 hover:text-gray-700'
                  >
                    <CircleOff aria-hidden='true' className='h-4 w-4' />
                  </Button>
                }
              />
              <TooltipContent side='top'>{disableLabel}</TooltipContent>
            </Tooltip>
          )}

          {onDelete && canEdit && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='sm'
                    aria-label={deleteLabel}
                    onClick={onDelete}
                    disabled={busy}
                    className='text-gray-500 hover:text-red-600'
                  >
                    <Trash2 aria-hidden='true' className='h-4 w-4' />
                  </Button>
                }
              />
              <TooltipContent side='top'>{deleteLabel}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </motion.div>
  )
}
