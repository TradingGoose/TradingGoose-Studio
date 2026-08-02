import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFolders, folderKeys, useFolderStore } from '@/stores/folders/store'

export function useFolders(workspaceId?: string) {
  const setFolders = useFolderStore((state) => state.setFolders)

  const query = useQuery({
    queryKey: folderKeys.list(workspaceId),
    queryFn: () => fetchFolders(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (query.isSuccess && query.data && workspaceId) {
      setFolders(workspaceId, query.data)
    }
  }, [query.data, query.isSuccess, setFolders, workspaceId])

  return query
}
