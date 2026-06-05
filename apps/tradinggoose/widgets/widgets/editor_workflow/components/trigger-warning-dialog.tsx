import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useWorkflowI18n } from '@/widgets/widgets/editor_workflow/copy'

export enum TriggerWarningType {
  DUPLICATE_TRIGGER = 'duplicate_trigger',
}

interface TriggerWarningDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerName: string
  type: TriggerWarningType
}

export function TriggerWarningDialog({
  open,
  onOpenChange,
  triggerName,
  type,
}: TriggerWarningDialogProps) {
  const { getTriggerWarningCopy } = useWorkflowI18n()
  const copy = getTriggerWarningCopy(triggerName)
  const getTitle = () => {
    switch (type) {
      case TriggerWarningType.DUPLICATE_TRIGGER:
        return copy.title
    }
  }

  const getDescription = () => {
    switch (type) {
      case TriggerWarningType.DUPLICATE_TRIGGER:
        return copy.description
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{getTitle()}</AlertDialogTitle>
          <AlertDialogDescription>{getDescription()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>{copy.dismiss}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
