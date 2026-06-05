'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console/logger'
import { DeployedWorkflowCard } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deployment-controls/components/deployed-workflow-card'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { useWorkflowBlocks, useWorkflowEdges, useWorkflowLoops, useWorkflowParallels } from '@/lib/yjs/use-workflow-doc'
import { useDeploymentCopy } from '@/widgets/widgets/editor_workflow/copy'

const logger = createLogger('DeployedWorkflowModal')

interface DeployedWorkflowModalProps {
  isOpen: boolean
  onClose: () => void
  needsRedeployment: boolean
  activeDeployedState?: WorkflowState
  selectedDeployedState?: WorkflowState
  selectedVersion?: number
  onActivateVersion?: () => void
  isActivating?: boolean
  selectedVersionLabel?: string
  workflowId: string
  isSelectedVersionActive?: boolean
}

export function DeployedWorkflowModal({
  isOpen,
  onClose,
  needsRedeployment,
  activeDeployedState,
  selectedDeployedState,
  selectedVersion,
  onActivateVersion,
  isActivating,
  selectedVersionLabel,
  workflowId,
  isSelectedVersionActive,
}: DeployedWorkflowModalProps) {
  const copy = useDeploymentCopy()
  const [showRevertDialog, setShowRevertDialog] = useState(false)
  const resolvedWorkflowId = workflowId

  // Get current workflow state to compare with deployed state
  const blocks = useWorkflowBlocks()
  const edges = useWorkflowEdges()
  const loops = useWorkflowLoops()
  const parallels = useWorkflowParallels()
  const currentWorkflowState = { blocks, edges, loops, parallels }

  const handleRevert = async () => {
    if (!resolvedWorkflowId) {
      logger.error('Cannot revert: no active workflow ID')
      return
    }

    try {
      const versionToRevert = selectedVersion !== undefined ? selectedVersion : 'active'
      const response = await fetch(
        `/api/workflows/${workflowId}/deployments/${versionToRevert}/revert`,
        {
          method: 'POST',
        }
      )

      if (!response.ok) {
        throw new Error('Failed to revert to version')
      }

      setShowRevertDialog(false)
      onClose()
    } catch (error) {
      logger.error('Failed to revert workflow:', error)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className='max-h-[100vh] overflow-y-auto sm:max-w-[1100px]'
        style={{ zIndex: 1000 }}
        hideCloseButton={true}
      >
        <div className='sr-only'>
          <DialogHeader>
            <DialogTitle>{copy.deployedWorkflow}</DialogTitle>
          </DialogHeader>
        </div>
        <DeployedWorkflowCard
          workflowId={resolvedWorkflowId}
          currentWorkflowState={currentWorkflowState}
          activeDeployedWorkflowState={activeDeployedState}
          selectedDeployedWorkflowState={selectedDeployedState}
          selectedVersionLabel={selectedVersionLabel}
        />

        <div className='mt-1 flex justify-between'>
          <div className='flex items-center gap-1'>
            {onActivateVersion &&
              (isSelectedVersionActive ? (
                <div className='inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-600 text-xs dark:text-emerald-400'>
                  <span className='relative flex h-2 w-2 items-center justify-center'>
                    <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75' />
                    <span className='relative inline-flex h-2 w-2 rounded-full bg-emerald-500' />
                  </span>
                  {copy.active}
                </div>
              ) : (
                <div className='flex items-center gap-0'>
                  <Button
                    variant='outline'
                    disabled={!!isActivating}
                    onClick={() => onActivateVersion?.()}
                  >
                    {isActivating ? copy.activating : copy.activate}
                  </Button>
                </div>
              ))}
          </div>

          <div className='flex items-center gap-1'>
            {(needsRedeployment || selectedVersion !== undefined) && (
              <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
                <AlertDialogTrigger asChild>
                  <Button variant='outline'>{copy.loadDeployment}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent style={{ zIndex: 1001 }} className='sm:max-w-[425px]'>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{copy.loadThisDeployment}</AlertDialogTitle>
                    <AlertDialogDescription>{copy.loadDeploymentDescription}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleRevert}
                      className='bg-primary text-primary-foreground hover:bg-[var(--primary)]/90'
                    >
                      {copy.loadDeployment}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant='outline' onClick={onClose}>
              {copy.close}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
