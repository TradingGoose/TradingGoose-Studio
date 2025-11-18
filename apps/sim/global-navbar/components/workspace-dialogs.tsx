'use client'

import { Loader2 } from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Workspace } from '../types'

interface WorkspaceDialogsProps {
  inviteDialogOpen: boolean
  onInviteDialogChange: (open: boolean) => void
  inviteWorkspace: Workspace | null
  inviteEmail: string
  onInviteEmailChange: (value: string) => void
  invitePermission: 'read' | 'write' | 'admin'
  onInvitePermissionChange: (value: 'read' | 'write' | 'admin') => void
  inviteError: string | null
  isInviting: boolean
  onSendInvite: () => void
  deleteDialogOpen: boolean
  onDeleteDialogChange: (open: boolean) => void
  workspaceToDelete: Workspace | null
  deleteError: string | null
  isDeletingWorkspace: boolean
  onConfirmDelete: () => void
}

export function WorkspaceDialogs({
  inviteDialogOpen,
  onInviteDialogChange,
  inviteWorkspace,
  inviteEmail,
  onInviteEmailChange,
  invitePermission,
  onInvitePermissionChange,
  inviteError,
  isInviting,
  onSendInvite,
  deleteDialogOpen,
  onDeleteDialogChange,
  workspaceToDelete,
  deleteError,
  isDeletingWorkspace,
  onConfirmDelete,
}: WorkspaceDialogsProps) {
  return (
    <>
      <Dialog open={inviteDialogOpen} onOpenChange={onInviteDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite to {inviteWorkspace?.name ?? 'workspace'}</DialogTitle>
            <DialogDescription>
              Send teammates an invitation to join this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <p className='font-medium text-muted-foreground text-sm'>Email address</p>
              <Input
                type='email'
                value={inviteEmail}
                onChange={(event) => onInviteEmailChange(event.target.value)}
                placeholder='name@example.com'
                disabled={isInviting}
              />
            </div>
            <div className='space-y-2'>
              <p className='font-medium text-muted-foreground text-sm'>Permission level</p>
              <Select
                value={invitePermission}
                onValueChange={(value) =>
                  onInvitePermissionChange(value as 'read' | 'write' | 'admin')
                }
                disabled={isInviting}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select permission' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='read'>Read</SelectItem>
                  <SelectItem value='write'>Write</SelectItem>
                  <SelectItem value='admin'>Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteError ? <p className='text-destructive text-sm'>{inviteError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => onInviteDialogChange(false)}>
              Cancel
            </Button>
            <Button onClick={onSendInvite} disabled={isInviting}>
              {isInviting ? (
                <>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Sending…
                </>
              ) : (
                'Send invite'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={onDeleteDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete <strong>{workspaceToDelete?.name}</strong> and all
              associated data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p className='text-destructive text-sm'>{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingWorkspace}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={onConfirmDelete}
              disabled={isDeletingWorkspace}
            >
              {isDeletingWorkspace ? (
                <>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Deleting…
                </>
              ) : (
                'Delete workspace'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
