import type { QueryClient } from '@tanstack/react-query'
import { devtools } from 'zustand/middleware'
import { createWithEqualityFn as create } from 'zustand/traditional'

export interface WorkflowFolder {
  id: string
  name: string
  userId: string
  workspaceId: string
  parentId: string | null
  color: string
  isExpanded: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export const folderKeys = {
  all: ['folders'] as const,
  lists: () => [...folderKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...folderKeys.lists(), workspaceId ?? ''] as const,
}

const mapFolder = (folder: any): WorkflowFolder => ({
  id: folder.id,
  name: folder.name,
  userId: folder.userId,
  workspaceId: folder.workspaceId,
  parentId: folder.parentId,
  color: folder.color,
  isExpanded: folder.isExpanded,
  sortOrder: folder.sortOrder,
  createdAt: new Date(folder.createdAt),
  updatedAt: new Date(folder.updatedAt),
})

async function throwFolderResponseError(response: Response, fallback: string): Promise<never> {
  const failure = await response.json().catch(() => ({}))
  throw new Error(failure.error || fallback)
}

export async function fetchFolders(workspaceId: string): Promise<WorkflowFolder[]> {
  const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)
  if (!response.ok) await throwFolderResponseError(response, 'Failed to fetch folders')

  const { folders }: { folders: any[] } = await response.json()
  return folders.map(mapFolder)
}

async function createFolder(input: {
  workspaceId: string
  name: string
  parentId?: string
  color?: string
}): Promise<void> {
  const response = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) await throwFolderResponseError(response, 'Failed to create folder')
}

async function updateFolder(input: {
  id: string
  updates: Partial<Pick<WorkflowFolder, 'name' | 'parentId' | 'color' | 'sortOrder'>>
}): Promise<void> {
  const response = await fetch(`/api/folders/${input.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.updates),
  })
  if (!response.ok) await throwFolderResponseError(response, 'Failed to update folder')
}

async function deleteFolder(id: string): Promise<void> {
  const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' })
  if (!response.ok) await throwFolderResponseError(response, 'Failed to delete folder')
}

export type FolderWrite =
  | { kind: 'create'; workspaceId: string; ownerId: string; name: string }
  | { kind: 'rename'; workspaceId: string; ownerId: string; id: string; name: string }
  | {
      kind: 'move'
      workspaceId: string
      ownerId: string
      id: string
      name: string
      parentId: string | null
    }
  | { kind: 'delete'; workspaceId: string; ownerId: string; id: string; name: string }

export type FolderWriteFailure = FolderWrite & { failure: 'transport' | 'refresh' }

export interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[]
  level: number
}

interface FolderState {
  folders: Record<string, WorkflowFolder>
  expandedFolders: Set<string>
  selectedWorkflows: Set<string>
  folderDataReady: Record<string, boolean>
  activeWrite: FolderWrite | null
  writeError: FolderWriteFailure | null

  // Actions
  setFolders: (workspaceId: string, folders: WorkflowFolder[]) => boolean
  toggleExpanded: (folderId: string) => void
  setExpanded: (folderId: string, expanded: boolean) => void

  // Selection actions
  selectWorkflow: (workflowId: string) => void
  deselectWorkflow: (workflowId: string) => void
  toggleWorkflowSelection: (workflowId: string) => void
  clearSelection: () => void
  selectOnly: (workflowId: string) => void
  isWorkflowSelected: (workflowId: string) => boolean

  // Computed values
  getFolderTree: (workspaceId: string) => FolderTreeNode[]
  getFolderById: (id: string) => WorkflowFolder | undefined
  getChildFolders: (parentId: string | null) => WorkflowFolder[]
  getFolderPath: (folderId: string) => WorkflowFolder[]

  writeFolder: (write: FolderWrite, queryClient: QueryClient) => Promise<'synced' | 'committed'>
}

export const useFolderStore = create<FolderState>()(
  devtools(
    (set, get) => ({
      folders: {},
      expandedFolders: new Set(),
      selectedWorkflows: new Set(),
      folderDataReady: {},
      activeWrite: null,
      writeError: null,

      setFolders: (workspaceId, folders) => {
        if (folders.some((folder) => folder.workspaceId !== workspaceId)) {
          set((state) => ({
            folderDataReady: { ...state.folderDataReady, [workspaceId]: false },
          }))
          return false
        }

        set((state) => {
          const nextFolders: Record<string, WorkflowFolder> = {}
          const previousWorkspaceIds = new Set<string>()
          Object.entries(state.folders).forEach(([id, folder]) => {
            if (folder.workspaceId !== workspaceId) {
              nextFolders[id] = folder
            } else {
              previousWorkspaceIds.add(id)
            }
          })
          folders.forEach((folder) => {
            nextFolders[folder.id] = folder
          })
          const nextExpanded = new Set(state.expandedFolders)
          const nextWorkspaceIds = new Set(folders.map((folder) => folder.id))
          for (const previousId of previousWorkspaceIds) {
            if (!nextWorkspaceIds.has(previousId)) nextExpanded.delete(previousId)
          }
          if (previousWorkspaceIds.size === 0) {
            for (const folder of folders) {
              if (folder.isExpanded) nextExpanded.add(folder.id)
            }
          }
          return {
            folders: nextFolders,
            expandedFolders: nextExpanded,
            folderDataReady: { ...state.folderDataReady, [workspaceId]: true },
            writeError:
              state.writeError?.failure === 'refresh' &&
              state.writeError.workspaceId === workspaceId
                ? null
                : state.writeError,
          }
        })
        return true
      },

      toggleExpanded: (folderId) =>
        set((state) => {
          const newExpanded = new Set(state.expandedFolders)
          if (newExpanded.has(folderId)) {
            newExpanded.delete(folderId)
          } else {
            newExpanded.add(folderId)
          }
          return { expandedFolders: newExpanded }
        }),

      setExpanded: (folderId, expanded) =>
        set((state) => {
          const newExpanded = new Set(state.expandedFolders)
          if (expanded) {
            newExpanded.add(folderId)
          } else {
            newExpanded.delete(folderId)
          }
          return { expandedFolders: newExpanded }
        }),

      // Selection actions
      selectWorkflow: (workflowId) =>
        set((state) => {
          const newSelected = new Set(state.selectedWorkflows)
          newSelected.add(workflowId)
          return { selectedWorkflows: newSelected }
        }),

      deselectWorkflow: (workflowId) =>
        set((state) => {
          const newSelected = new Set(state.selectedWorkflows)
          newSelected.delete(workflowId)
          return { selectedWorkflows: newSelected }
        }),

      toggleWorkflowSelection: (workflowId) =>
        set((state) => {
          const newSelected = new Set(state.selectedWorkflows)
          if (newSelected.has(workflowId)) {
            newSelected.delete(workflowId)
          } else {
            newSelected.add(workflowId)
          }
          return { selectedWorkflows: newSelected }
        }),

      clearSelection: () =>
        set(() => ({
          selectedWorkflows: new Set(),
        })),

      selectOnly: (workflowId) =>
        set(() => ({
          selectedWorkflows: new Set([workflowId]),
        })),

      isWorkflowSelected: (workflowId) => get().selectedWorkflows.has(workflowId),

      getFolderTree: (workspaceId) => {
        const folders = Object.values(get().folders).filter((f) => f.workspaceId === workspaceId)

        const buildTree = (parentId: string | null, level = 0): FolderTreeNode[] => {
          return folders
            .filter((folder) => folder.parentId === parentId)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            .map((folder) => ({
              ...folder,
              children: buildTree(folder.id, level + 1),
              level,
            }))
        }

        return buildTree(null)
      },

      getFolderById: (id) => get().folders[id],

      getChildFolders: (parentId) =>
        Object.values(get().folders)
          .filter((folder) => folder.parentId === parentId)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),

      getFolderPath: (folderId) => {
        const folders = get().folders
        const path: WorkflowFolder[] = []
        let currentId: string | null = folderId

        while (currentId && folders[currentId]) {
          const folder: WorkflowFolder = folders[currentId]
          path.unshift(folder)
          currentId = folder.parentId
        }

        return path
      },

      writeFolder: async (write, queryClient) => {
        if (get().activeWrite) throw new Error('A folder change is already in progress.')
        if (get().folderDataReady[write.workspaceId] !== true) {
          throw new Error('Folder data must be refreshed before making changes.')
        }
        set({ activeWrite: write, writeError: null })

        try {
          if (write.kind === 'create') {
            await createFolder({ workspaceId: write.workspaceId, name: write.name })
          } else if (write.kind === 'delete') {
            await deleteFolder(write.id)
          } else {
            await updateFolder({
              id: write.id,
              updates:
                write.kind === 'rename' ? { name: write.name } : { parentId: write.parentId },
            })
          }
        } catch (error) {
          set({ activeWrite: null, writeError: { ...write, failure: 'transport' } })
          throw error
        }

        try {
          const queryKey = folderKeys.list(write.workspaceId)
          await queryClient.cancelQueries({ queryKey, exact: true })
          const folders = await queryClient.fetchQuery({
            queryKey,
            queryFn: () => fetchFolders(write.workspaceId),
            staleTime: 0,
          })
          if (!get().setFolders(write.workspaceId, folders)) {
            throw new Error('Folder refresh returned data for another workspace.')
          }
          set({ activeWrite: null })
          return 'synced'
        } catch (error) {
          set((state) => ({
            activeWrite: null,
            folderDataReady: { ...state.folderDataReady, [write.workspaceId]: false },
            writeError: { ...write, failure: 'refresh' },
          }))
          return 'committed'
        }
      },
    }),
    { name: 'folder-store' }
  )
)

// Selector hook for checking if a workflow is selected (avoids get() calls)
export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))
