import { useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  isSelfRemoval?: boolean
  isPending: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onConfirmRemove: () => Promise<void>
  onCancel: () => void
}

export function RemoveMemberDialog({
  open,
  memberName,
  onOpenChange,
  onConfirmRemove,
  onCancel,
  isSelfRemoval = false,
  isPending,
  error,
}: RemoveMemberDialogProps) {
  const t = useTranslations('workspace.settingsModal.team')

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending) return details.cancel()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent hideCloseButton={isPending}>
        <DialogHeader>
          <DialogTitle>
            {isSelfRemoval ? t('leaveOrganization') : t('removeTeamMember')}
          </DialogTitle>
          <DialogDescription>
            {isSelfRemoval
              ? t('leaveOrganizationDescription')
              : t('removeMemberDescription', { name: memberName })}{' '}
            <span className='text-red-500 dark:text-red-500'>{t('thisActionCannotBeUndone')}</span>
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            variant='outline'
            onClick={onCancel}
            disabled={isPending}
            className='h-9 rounded-sm'
          >
            {t('cancel')}
          </Button>
          <Button
            variant='destructive'
            onClick={onConfirmRemove}
            disabled={isPending}
            focusableWhenDisabled={isPending}
            aria-busy={isPending || undefined}
            className='h-9 rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
          >
            {isPending ? t('removing') : isSelfRemoval ? t('leaveOrganization') : t('remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
