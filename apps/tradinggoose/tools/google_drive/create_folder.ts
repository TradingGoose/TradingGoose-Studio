import type { GoogleDriveToolParams, GoogleDriveUploadResponse } from '@/tools/google_drive/types'
import type { ToolConfig } from '@/tools/types'

export const createFolderTool: ToolConfig<GoogleDriveToolParams, GoogleDriveUploadResponse> = {
  id: 'google_drive_create_folder',
  name: 'Create Folder in Google Drive',
  description: 'Create a new folder in Google Drive',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-drive',
    additionalScopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Drive API',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the folder to create',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the parent folder',
    },
  },

  request: {
    url: 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const metadata: {
        name: string | undefined
        mimeType: string
        parents?: string[]
      } = {
        name: params.fileName,
        mimeType: 'application/vnd.google-apps.folder',
      }

      if (params.folderId) {
        metadata.parents = [params.folderId]
      }

      return metadata
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error?.message || 'Failed to create folder in Google Drive')
    }
    const data = await response.json()

    return {
      success: true,
      output: {
        file: {
          id: data.id,
          name: data.name,
          mimeType: data.mimeType,
          webViewLink: data.webViewLink,
          webContentLink: data.webContentLink,
          size: data.size,
          createdTime: data.createdTime,
          modifiedTime: data.modifiedTime,
          parents: data.parents,
        },
      },
    }
  },

  outputs: {
    file: {
      type: 'json',
      description: 'Created folder metadata including ID, name, and parent information',
    },
  },
}
