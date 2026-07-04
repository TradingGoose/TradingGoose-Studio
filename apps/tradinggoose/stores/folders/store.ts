import { devtools } from 'zustand/middleware'
import { createWithEqualityFn as create } from 'zustand/traditional'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('FoldersStore')

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

export interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[]
  level: number
}

interface FolderState {
  folders: Record<string, WorkflowFolder>
  isLoading: boolean
  expandedFolders: Set<string>
  selectedWorkflows: Set<string>
  loadedWorkspaces: Record<string, boolean>

  // Actions
  setFolders: (workspaceId: string, folders: WorkflowFolder[]) => void
  addFolder: (folder: WorkflowFolder) => void
  updateFolder: (id: string, updates: Partial<WorkflowFolder>) => void
  removeFolder: (id: string) => void
  setLoading: (loading: boolean) => void
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

  // API actions
  fetchFolders: (workspaceId: string) => Promise<void>
  createFolder: (data: {
    name: string
    workspaceId: string
    parentId?: string
    color?: string
  }) => Promise<WorkflowFolder>
  updateFolderAPI: (id: string, updates: Partial<WorkflowFolder>) => Promise<WorkflowFolder>
  deleteFolder: (id: string, workspaceId: string) => Promise<void>
}

export const useFolderStore = create<FolderState>()(
  devtools(
    (set, get) => ({
      folders: {},
      isLoading: false,
      expandedFolders: new Set(),
      selectedWorkflows: new Set(),
      loadedWorkspaces: {},

      setFolders: (workspaceId, folders) =>
        set((state) => {
          const nextFolders: Record<string, WorkflowFolder> = {}
          Object.entries(state.folders).forEach(([id, folder]) => {
            if (folder.workspaceId !== workspaceId) {
              nextFolders[id] = folder
            }
          })
          folders.forEach((folder) => {
            nextFolders[folder.id] = folder
          })
          return { folders: nextFolders }
        }),

      addFolder: (folder) =>
        set((state) => ({
          folders: { ...state.folders, [folder.id]: folder },
        })),

      updateFolder: (id, updates) =>
        set((state) => ({
          folders: {
            ...state.folders,
            [id]: state.folders[id] ? { ...state.folders[id], ...updates } : state.folders[id],
          },
        })),

      removeFolder: (id) =>
        set((state) => {
          const newFolders = { ...state.folders }
          delete newFolders[id]
          return { folders: newFolders }
        }),

      setLoading: (loading) => set({ isLoading: loading }),

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

      fetchFolders: async (workspaceId) => {
        let didLoad = false
        set((state) => ({
          isLoading: true,
          loadedWorkspaces: { ...state.loadedWorkspaces, [workspaceId]: false },
        }))
        try {
          const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)
          if (!response.ok) {
            throw new Error('Failed to fetch folders')
          }
          const { folders }: { folders: any[] } = await response.json()

          // Convert date strings to Date objects
          const processedFolders: WorkflowFolder[] = folders.map((folder: any) => ({
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
          }))

          get().setFolders(workspaceId, processedFolders)

          // Initialize expanded state from folder data
          const expandedSet = new Set<string>()
          processedFolders.forEach((folder: WorkflowFolder) => {
            if (folder.isExpanded) {
              expandedSet.add(folder.id)
            }
          })
          set({ expandedFolders: expandedSet })
          didLoad = true
        } catch (error) {
          logger.error('Error fetching folders:', error)
        } finally {
          set((state) => ({
            isLoading: false,
            loadedWorkspaces: { ...state.loadedWorkspaces, [workspaceId]: didLoad },
          }))
        }
      },

      createFolder: async (data) => {
        const response = await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to create folder')
        }

        const { folder } = await response.json()
        const processedFolder = {
          ...folder,
          createdAt: new Date(folder.createdAt),
          updatedAt: new Date(folder.updatedAt),
        }

        get().addFolder(processedFolder)
        return processedFolder
      },

      updateFolderAPI: async (id, updates) => {
        const response = await fetch(`/api/folders/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to update folder')
        }

        const { folder } = await response.json()
        const processedFolder = {
          ...folder,
          createdAt: new Date(folder.createdAt),
          updatedAt: new Date(folder.updatedAt),
        }

        get().updateFolder(id, processedFolder)

        return processedFolder
      },

      deleteFolder: async (id: string, _workspaceId: string) => {
        const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to delete folder')
        }

        const responseData = await response.json()
        const parentId = typeof responseData.parentId === 'string' ? responseData.parentId : null

        for (const childFolder of get().getChildFolders(id)) {
          get().updateFolder(childFolder.id, { parentId })
        }
        get().removeFolder(id)

        set((state) => {
          const newExpanded = new Set(state.expandedFolders)
          newExpanded.delete(id)
          return { expandedFolders: newExpanded }
        })

        logger.info(
          `Deleted folder ${id}; moved ${responseData.movedFolders ?? 0} folder(s) and ${responseData.movedWorkflows ?? 0} workflow(s) up one level`
        )
      },
    }),
    { name: 'folder-store' }
  )
)

// Selector hook for checking if a workflow is selected (avoids get() calls)
export const useIsWorkflowSelected = (workflowId: string) =>
  useFolderStore((state) => state.selectedWorkflows.has(workflowId))
