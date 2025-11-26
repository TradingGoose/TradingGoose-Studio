'use client'
import { ChevronsUpDown, Loader2, Pencil, Plus, Sparkles, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { Workspace } from '../types'
import { getInitials } from '../utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './resizable-dropdown'

interface WorkspaceSwitcherProps {
  activeWorkspace: Workspace | null
  workspaces: Workspace[]
  isLoading: boolean
  workspaceMenuOpen: boolean
  onWorkspaceMenuOpenChange: (open: boolean) => void
  hoveredWorkspaceId: string | null
  onHoverWorkspace: (id: string | null) => void
  editingWorkspaceId: string | null
  editingWorkspaceName: string
  onEditingWorkspaceNameChange: (value: string) => void
  isRenamingWorkspace: boolean
  renameError: string | null
  onStartEditing: (workspace: Workspace) => void
  onCancelEditing: () => void
  onSaveWorkspaceName: () => void
  onSwitchWorkspace: (workspace: Workspace) => void
  onInviteWorkspace: (workspace: Workspace) => void
  onCreateWorkspace: () => void
  isCreatingWorkspace: boolean
  onDeleteWorkspace: (workspace: Workspace) => void
  brandName: string
}

export function WorkspaceSwitcher({
  activeWorkspace,
  workspaces,
  isLoading,
  workspaceMenuOpen,
  onWorkspaceMenuOpenChange,
  hoveredWorkspaceId,
  onHoverWorkspace,
  editingWorkspaceId,
  editingWorkspaceName,
  onEditingWorkspaceNameChange,
  isRenamingWorkspace,
  renameError,
  onStartEditing,
  onCancelEditing,
  onSaveWorkspaceName,
  onSwitchWorkspace,
  onInviteWorkspace,
  onCreateWorkspace,
  isCreatingWorkspace,
  onDeleteWorkspace,
  brandName,
}: WorkspaceSwitcherProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={workspaceMenuOpen} onOpenChange={onWorkspaceMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              variant='muted'
              size='lg'
              className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              <div className='flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary p-1.5 text-sidebar-primary-foreground'>
                {activeWorkspace ? (
                  <span className='font-semibold text-sm'>{getInitials(activeWorkspace.name)}</span>
                ) : (
                  <Sparkles className='size-4' />
                )}
              </div>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>{activeWorkspace?.name ?? brandName}</span>
                <span className='truncate text-xs'>{activeWorkspace?.role ?? 'Workspace'}</span>
              </div>
              <ChevronsUpDown className='ml-auto' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 max-w-[calc(100vw-2rem)] rounded-md border p-0 shadow-lg'
            side='bottom'
            sideOffset={4}
            align='start'
          >
            <div className='flex h-[300px] flex-col p-2'>
              <div className='min-h-0 flex-1'>
                <ScrollArea className='h-[220px]'>
                  {isLoading ? (
                    <div className='space-y-2'>
                      {[0, 1, 2].map((index) => (
                        <Skeleton key={index} className='h-8 w-full rounded-sm' />
                      ))}
                    </div>
                  ) : workspaces.length === 0 ? (
                    <div className='rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm'>
                      No workspaces yet. Create one to get started.
                    </div>
                  ) : (
                    <div className='space-y-1'>
                      {workspaces.map((workspace) => {
                        const isActive = workspace.id === activeWorkspace?.id
                        const isEditing = editingWorkspaceId === workspace.id
                        const isHovered = hoveredWorkspaceId === workspace.id

                        return (
                          <div key={workspace.id}>
                            <div
                              className={cn(
                                'group flex h-8 cursor-pointer items-center rounded-sm px-2 text-left text-sm transition-colors',
                                isActive ? 'bg-muted' : 'hover:bg-card'
                              )}
                              onMouseEnter={() => onHoverWorkspace(workspace.id)}
                              onMouseLeave={() => onHoverWorkspace(null)}
                              onClick={() => {
                                if (isEditing) return
                                onSwitchWorkspace(workspace)
                              }}
                            >
                              {isEditing ? (
                                <Input
                                  value={editingWorkspaceName}
                                  onChange={(event) =>
                                    onEditingWorkspaceNameChange(event.target.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      onSaveWorkspaceName()
                                    } else if (event.key === 'Escape') {
                                      onCancelEditing()
                                    }
                                  }}
                                  onBlur={() => onSaveWorkspaceName()}
                                  disabled={isRenamingWorkspace}
                                  className='mr-2 h-6 flex-1 border-0 bg-transparent p-0 text-sm focus-visible:ring-0'
                                  autoFocus
                                />
                              ) : (
                                <span
                                  className={cn(
                                    'min-w-0 flex-1 truncate pr-2 font-medium text-sm',
                                    isActive
                                      ? 'text-foreground'
                                      : 'text-muted-foreground group-hover:text-foreground'
                                  )}
                                >
                                  {workspace.name}
                                </span>
                              )}
                              <div className='flex h-full flex-shrink-0 items-center gap-1'>
                                {workspace.permissions === 'admin' ? (
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className={cn(
                                      'h-6 w-6 p-0 text-muted-foreground transition-opacity hover:text-foreground',
                                      isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
                                    )}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onStartEditing(workspace)
                                    }}
                                  >
                                    <Pencil className='h-3.5 w-3.5' />
                                  </Button>
                                ) : null}
                                {workspace.permissions === 'admin' ? (
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className={cn(
                                      'h-6 w-6 p-0 text-muted-foreground transition-opacity hover:text-destructive',
                                      isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
                                    )}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onDeleteWorkspace(workspace)
                                    }}
                                  >
                                    <Trash2 className='h-3.5 w-3.5' />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            {renameError && editingWorkspaceId === workspace.id ? (
                              <p className='px-2 text-destructive text-xs'>{renameError}</p>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </ScrollArea>
              </div>
              <div className='mt-2 flex items-center gap-2 border-t pt-2'>
                <Button
                  variant='secondary'
                  className='h-8 flex-1 justify-center gap-2 rounded-sm text-xs'
                  onClick={() => (activeWorkspace ? onInviteWorkspace(activeWorkspace) : undefined)}
                  disabled={!activeWorkspace || activeWorkspace.permissions !== 'admin'}
                >
                  <UserPlus className='h-3.5 w-3.5' />
                  Invite
                </Button>
                <Button
                  variant='secondary'
                  className='h-8 flex-1 justify-center gap-2 rounded-sm text-xs'
                  onClick={() => onCreateWorkspace()}
                  disabled={isCreatingWorkspace}
                >
                  {isCreatingWorkspace ? (
                    <>
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Plus className='h-3.5 w-3.5' />
                      Create
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
