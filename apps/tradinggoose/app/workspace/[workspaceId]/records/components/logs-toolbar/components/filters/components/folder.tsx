import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFolders } from '@/hooks/queries/folders'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  folderDropdownListStyle,
} from './shared'

interface FolderOption {
  id: string
  name: string
  color: string
  path: string // For nested folders, show full path
}

export default function FolderFilter() {
  const t = useTranslations('workspace.logs.dashboard.filters')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const { folderIds, toggleFolderId, setFolderIds } = useFilterStore()
  const { getFolderTree } = useFolderStore()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [search, setSearch] = useState('')
  const { isLoading: foldersLoading } = useFolders(workspaceId)
  const folderTree = workspaceId ? getFolderTree(workspaceId) : []

  const folders: FolderOption[] = useMemo(() => {
    const flattenFolders = (nodes: FolderTreeNode[], parentPath = ''): FolderOption[] => {
      const result: FolderOption[] = []

      for (const node of nodes) {
        const currentPath = parentPath ? `${parentPath} / ${node.name}` : node.name
        result.push({
          id: node.id,
          name: node.name,
          color: node.color || '#6B7280',
          path: currentPath,
        })

        if (node.children && node.children.length > 0) {
          result.push(...flattenFolders(node.children, currentPath))
        }
      }

      return result
    }

    return flattenFolders(folderTree)
  }, [folderTree])

  // Get display text for the dropdown button
  const getSelectedFoldersText = () => {
    if (folderIds.length === 0) return t('allFolders')
    if (folderIds.length === 1) {
      const selected = folders.find((f) => f.id === folderIds[0])
      return selected ? selected.name : t('allFolders')
    }
    return t('selectedFolders', {
      count: folderIds.length,
      plural: folderIds.length === 1 ? '' : 's',
    })
  }

  // Check if a folder is selected
  const isFolderSelected = (folderId: string) => {
    return folderIds.includes(folderId)
  }

  // Clear all selections
  const clearSelections = () => {
    setFolderIds([])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button ref={triggerRef} variant='outline' size='sm' className={filterButtonClass} />
        }
      >
        {foldersLoading ? t('loadingFolders') : getSelectedFoldersText()}
        <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        collisionAvoidance={{ side: 'none', align: 'none', fallbackAxisSide: 'none' }}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <Command>
          <CommandInput placeholder={t('searchFolders')} onValueChange={(v) => setSearch(v)} />
          <CommandList className={commandListClass} style={folderDropdownListStyle}>
            <CommandEmpty>{foldersLoading ? t('loadingFolders') : t('noFolders')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value='all-folders'
                onSelect={() => {
                  clearSelections()
                }}
                className='cursor-pointer'
              >
                <span>{t('allFolders')}</span>
                {folderIds.length === 0 && (
                  <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                )}
              </CommandItem>
              {useMemo(() => {
                const q = search.trim().toLowerCase()
                const filtered = q
                  ? folders.filter((f) => (f.path || f.name).toLowerCase().includes(q))
                  : folders
                return filtered.map((folder) => (
                  <CommandItem
                    key={folder.id}
                    value={`${folder.path || folder.name}`}
                    onSelect={() => {
                      toggleFolderId(folder.id)
                    }}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center'>
                      <span className='truncate' title={folder.path}>
                        {folder.path}
                      </span>
                    </div>
                    {isFolderSelected(folder.id) && (
                      <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                    )}
                  </CommandItem>
                ))
              }, [folders, search, folderIds])}
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
