'use client'

import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, Button, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { McpToolForUI } from '@/hooks/use-mcp-tools'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import { formatAbsoluteDate, formatRelativeTime } from './mcp-formatters'

interface McpServerListProps {
  serversLoading: boolean
  toolsError: string | null
  serversError: string | null
  hasServers: boolean
  filteredServers: McpServerWithStatus[]
  toolsByServer: Record<string, McpToolForUI[]>
  deletingServers: Set<string>
  selectedServerId: string | null
  onSelectServer: (serverId: string) => void
  onEdit: (server: McpServerWithStatus) => void
  onDelete: (serverId: string) => void
  showNoResults: boolean
  searchTerm: string
  onStartCreate: () => void
  createForm?: ReactNode
}

export function McpServerList({
  serversLoading,
  toolsError,
  serversError,
  hasServers,
  filteredServers,
  toolsByServer,
  deletingServers,
  selectedServerId,
  onSelectServer,
  onEdit,
  onDelete,
  showNoResults,
  searchTerm,
  onStartCreate,
  createForm,
}: McpServerListProps) {
  return (
    <div className='relative flex h-full flex-col p-3'>
      <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto'>
        <div className=' pb-6'>
          {(toolsError || serversError) && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>{toolsError || serversError}</AlertDescription>
            </Alert>
          )}

          {serversLoading ? (
            <div className='space-y-4'>
              <McpServerSkeleton />
              <McpServerSkeleton />
              <McpServerSkeleton />
            </div>
          ) : (
            <>
              {hasServers ? (
                <div className='space-y-4'>
                  {filteredServers.map((server) => {
                    if (!server || !server.id) return null

                    return (
                      <ServerCard
                        key={server.id}
                        server={server}
                        tools={toolsByServer[server.id] || []}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        onSelect={onSelectServer}
                        isDeleting={deletingServers.has(server.id)}
                        isSelected={selectedServerId === server.id}
                      />
                    )
                  })}
                </div>
              ) : (
                <div className='rounded-md border bg-card p-10 text-center shadow-sm'>
                  <p className='font-medium'>No MCP servers yet</p>
                  <p className='mt-2 text-muted-foreground'>
                    Configure MCP servers to extend your workflows with custom tools.
                  </p>
                  <Button className='mt-4' onClick={onStartCreate}>
                    <Plus className='mr-2 h-4 w-4 stroke-[2px]' />
                    Add Server
                  </Button>
                </div>
              )}

              {showNoResults && (
                <div className='rounded-xl border border-dashed bg-muted/40 px-6 py-4 text-center text-muted-foreground text-sm'>
                  No servers found matching "{searchTerm}"
                </div>
              )}
            </>
          )}

          {createForm}
        </div>
      </div>
    </div>
  )
}

function McpServerSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-40 rounded-sm' /> {/* Server name */}
          <Skeleton className='h-4 w-16' /> {/* Transport type */}
          <Skeleton className='h-1 w-1 rounded-full' /> {/* Dot separator */}
          <Skeleton className='h-4 w-12' /> {/* Tool count */}
        </div>
        <Skeleton className='h-8 w-16' /> {/* Delete button */}
      </div>
      <div className='mt-1 ml-2 flex flex-wrap gap-1'>
        <Skeleton className='h-5 w-16 rounded' /> {/* Tool name 1 */}
        <Skeleton className='h-5 w-20 rounded' /> {/* Tool name 2 */}
        <Skeleton className='h-5 w-14 rounded' /> {/* Tool name 3 */}
      </div>
    </div>
  )
}

interface ServerCardProps {
  server: McpServerWithStatus
  tools: McpToolForUI[]
  onEdit: (server: McpServerWithStatus) => void
  onDelete: (serverId: string) => void
  onSelect: (serverId: string) => void
  isDeleting: boolean
  isSelected: boolean
}

function ServerCard({
  server,
  tools,
  onEdit,
  onDelete,
  onSelect,
  isDeleting,
  isSelected,
}: ServerCardProps) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async () => {
    if (!server.id) return
    try {
      await navigator.clipboard.writeText(server.id)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={cn(
        'group rounded-md border p-4 transition-colors hover:bg-secondary/10 ',
        isSelected && 'bg-secondary/30',
      )}
    >
      <div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2 text-sm font-medium'>
            <span>{server.name || 'Unnamed Server'}</span>
            <span className='inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium border-green-700 bg-green-500/10 text-green-700'>
              <span className='h-2 w-2 rounded-full bg-current opacity-70' />
              Connected
            </span>
            <div className='flex flex-wrap gap-2 text-muted-foreground text-xs'>
              {server.updatedAt && (
                <span title={`Updated ${formatAbsoluteDate(server.updatedAt)}`}>
                  Updated {formatRelativeTime(server.updatedAt)}
                </span>
              )}
              {server.createdAt && (
                <span title={`Created ${formatAbsoluteDate(server.createdAt)}`}>
                  Created {formatRelativeTime(server.createdAt)}
                </span>
              )}
            </div>
          </div>

          <div className='grid gap-3 text-muted-foreground text-xs sm:grid-cols-3'>
            <div>
              <p className='uppercase text-[10px] tracking-wide text-muted-foreground/70'>URL</p>
              <p className='text-foreground'>{server.url || '—'}</p>
            </div>
            <div>
              <p className='uppercase text-[10px] tracking-wide text-muted-foreground/70'>Timeout</p>
              <p className='text-foreground'>{server.timeout ? `${server.timeout}ms` : '30,000ms'}</p>
            </div>
            <div>
              <p className='uppercase text-[10px] tracking-wide text-muted-foreground/70'>Tools</p>
              <p className='text-foreground'>{tools.length}</p>
            </div>
          </div>
          {tools.length > 0 && (
            <div className='flex flex-wrap gap-2 pt-1'>
              {tools.map((tool) => (
                <span
                  key={tool.id}
                  className='inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground'
                >
                  {tool.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className='flex items-center justify-center gap-2 self-start'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7'
            onClick={(event) => {
              event.stopPropagation()
              if (server.id) {
                onSelect(server.id)
              }
            }}
          >
            Detail
          </Button>
          <button
            type='button'
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              event.preventDefault()
              onDelete(server.id)
            }}
            disabled={isDeleting}
            className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
          >
            <Trash2 className='h-3.5 w-3.5' />
            <span className='sr-only'>Delete server</span>
          </button>
        </div>
      </div>
    </div>
  )
}
