'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

const logger = createLogger('WorkspaceFilesManager')

export const SUPPORTED_EXTENSIONS = [
  'pdf',
  'csv',
  'doc',
  'docx',
  'txt',
  'md',
  'xlsx',
  'xls',
  'html',
  'htm',
  'pptx',
  'ppt',
] as const

export const ACCEPT_ATTR = '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt'

export interface StorageInfo {
  usedBytes: number
  limitBytes: number
  percentUsed: number
}

interface UploadProgress {
  completed: number
  total: number
}

interface UsageResponse {
  success: boolean
  storage?: StorageInfo
  usage?: {
    plan?: string
  }
}

interface FilesResponse {
  success: boolean
  files: WorkspaceFileRecord[]
}

export function useWorkspaceFilesManager(workspaceId?: string | null) {
  const [files, setFiles] = useState<WorkspaceFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ completed: 0, total: 0 })
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [planName, setPlanName] = useState<string>('free')
  const [storageLoading, setStorageLoading] = useState(true)

  const loadFiles = useCallback(async () => {
    if (!workspaceId) return
    try {
      setLoading(true)
      const response = await fetch(`/api/workspaces/${workspaceId}/files`)
      const data: FilesResponse = await response.json()
      if (data.success) {
        setFiles(data.files)
      }
    } catch (error) {
      logger.error('Error loading workspace files:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const loadStorageInfo = useCallback(async () => {
    try {
      setStorageLoading(true)
      const response = await fetch('/api/users/me/usage-limits')
      const data: UsageResponse = await response.json()

      if (data.success && data.storage) {
        setStorageInfo(data.storage)
        if (data.usage?.plan) {
          setPlanName(data.usage.plan)
        }
      }
    } catch (error) {
      logger.error('Error loading storage info:', error)
    } finally {
      setStorageLoading(false)
    }
  }, [])

  const uploadFiles = useCallback(
    async (list: FileList | File[]) => {
      if (!workspaceId) return

      const filesToUpload = Array.from(list)
      if (filesToUpload.length === 0) return

      try {
        setUploading(true)
        setUploadError(null)

        const unsupported: string[] = []
        const allowedFiles = filesToUpload.filter((file) => {
          const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
          const ok = SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])
          if (!ok) unsupported.push(file.name)
          return ok
        })

        setUploadProgress({ completed: 0, total: allowedFiles.length })
        let lastError: string | null = null

        for (let i = 0; i < allowedFiles.length; i++) {
          const selectedFile = allowedFiles[i]
          try {
            const formData = new FormData()
            formData.append('file', selectedFile)

            const response = await fetch(`/api/workspaces/${workspaceId}/files`, {
              method: 'POST',
              body: formData,
            })

            const data = await response.json()
            if (!data.success) {
              lastError = data.error || 'Upload failed'
            } else {
              setUploadProgress({ completed: i + 1, total: allowedFiles.length })
            }
          } catch (error) {
            logger.error('Error uploading file:', error)
            lastError = 'Upload failed'
          }
        }

        await loadFiles()
        await loadStorageInfo()

        if (unsupported.length) {
          lastError = `Unsupported file type: ${unsupported.join(', ')}`
        }

        if (lastError) {
          setUploadError(lastError)
        }
      } catch (error) {
        logger.error('Error uploading file:', error)
        setUploadError('Upload failed')
        setTimeout(() => setUploadError(null), 5000)
      } finally {
        setUploading(false)
        setUploadProgress({ completed: 0, total: 0 })
      }
    },
    [workspaceId, loadFiles, loadStorageInfo]
  )

  const downloadFile = useCallback(
    async (file: WorkspaceFileRecord) => {
      if (!workspaceId) return

      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/files/${file.id}/download`, {
          method: 'POST',
        })
        const data = await response.json()
        if (data.success && data.downloadUrl) {
          window.open(data.downloadUrl, '_blank')
        }
      } catch (error) {
        logger.error('Error downloading file:', error)
      }
    },
    [workspaceId]
  )

  const deleteFile = useCallback(
    async (file: WorkspaceFileRecord) => {
      if (!workspaceId) return

      try {
        setDeletingFileId(file.id)
        const previousFiles = files
        const previousStorageInfo = storageInfo

        setFiles((prev) => prev.filter((f) => f.id !== file.id))

        if (storageInfo) {
          const newUsedBytes = Math.max(0, storageInfo.usedBytes - file.size)
          const newPercentUsed = (newUsedBytes / storageInfo.limitBytes) * 100
          setStorageInfo({
            ...storageInfo,
            usedBytes: newUsedBytes,
            percentUsed: newPercentUsed,
          })
        }

        const response = await fetch(`/api/workspaces/${workspaceId}/files/${file.id}`, {
          method: 'DELETE',
        })

        const data = await response.json()
        if (!data.success) {
          setFiles(previousFiles)
          setStorageInfo(previousStorageInfo)
          logger.error('Failed to delete file:', data.error)
        }
      } catch (error) {
        logger.error('Error deleting file:', error)
        await loadFiles()
        await loadStorageInfo()
      } finally {
        setDeletingFileId(null)
      }
    },
    [workspaceId, files, storageInfo, loadFiles, loadStorageInfo]
  )

  useEffect(() => {
    if (!workspaceId) return
    void loadFiles()
    void loadStorageInfo()
  }, [workspaceId, loadFiles, loadStorageInfo])

  return {
    files,
    loading,
    uploading,
    deletingFileId,
    uploadError,
    uploadProgress,
    storageInfo,
    storageLoading,
    planName,
    loadFiles,
    loadStorageInfo,
    uploadFiles,
    downloadFile,
    deleteFile,
  }
}
