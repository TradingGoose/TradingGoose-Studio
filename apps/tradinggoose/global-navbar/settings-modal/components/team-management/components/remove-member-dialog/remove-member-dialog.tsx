import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'

interface RemoveMemberDialogProps {
  open: boolean
  memberName: string
  shouldReduceSeats: boolean
  canReduceSeats: boolean
  isSelfRemoval?: boolean
  onOpenChange: (open: boolean) => void
  onShouldReduceSeatsChange: (shouldReduce: boolean) => void
  onConfirmRemove: (shouldReduceSeats: boolean) => Promise<void>
  onCancel: () => void
}

export function RemoveMemberDialog({
  open,
  memberName,
  shouldReduceSeats,
  canReduceSeats,
  onOpenChange,
  onShouldReduceSeatsChange,
  onConfirmRemove,
  onCancel,
  isSelfRemoval = false,
}: RemoveMemberDialogProps) {
  const locale = useLocale() as LocaleCode
  const teamCopy = getPublicCopy(locale).workspace.settingsModal.team

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isSelfRemoval ? teamCopy.leaveOrganization : teamCopy.removeTeamMember}
          </DialogTitle>
          <DialogDescription>
            {isSelfRemoval
              ? teamCopy.leaveOrganizationDescription
              : teamCopy.removeMemberDescription.replaceAll('{{name}}', memberName)}{' '}
            <span className='text-red-500 dark:text-red-500'>
              {teamCopy.thisActionCannotBeUndone}
            </span>
          </DialogDescription>
        </DialogHeader>

        {!isSelfRemoval && canReduceSeats && (
          <div className='py-4'>
            <div className='flex items-center space-x-2'>
              <input
                type='checkbox'
                id='reduce-seats'
                className='rounded-sm'
                checked={shouldReduceSeats}
                onChange={(e) => onShouldReduceSeatsChange(e.target.checked)}
              />
              <label htmlFor='reduce-seats' className='text-xs'>
                {teamCopy.alsoReduceSeatCount}
              </label>
            </div>
            <p className='mt-1 text-muted-foreground text-xs'>
              {teamCopy.reduceSeatCountDescription}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={onCancel} className='h-9 rounded-sm'>
            {teamCopy.cancel}
          </Button>
          <Button
            variant='destructive'
            onClick={() => onConfirmRemove(shouldReduceSeats)}
            className='h-9 rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
          >
            {isSelfRemoval ? teamCopy.leaveOrganization : teamCopy.remove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
