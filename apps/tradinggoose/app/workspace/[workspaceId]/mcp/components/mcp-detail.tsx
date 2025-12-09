'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Server, Pencil, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { cn } from '@/lib/utils'
import type { McpToolForUI } from '@/hooks/use-mcp-tools'
import type { McpServerWithStatus } from '@/stores/mcp-servers/types'
import { formatAbsoluteDate, formatRelativeTime } from './mcp-formatters'

interface McpServerDetailsProps {
  server: McpServerWithStatus | null
  tools: McpToolForUI[]
  onEdit: (server: McpServerWithStatus) => void
  onClosePanel: () => void
  onRefreshTools: () => void
  isRefreshing?: boolean
  isEditing: boolean
  onSave?: () => void
  isSaving?: boolean
  disableSave?: boolean
  formContent?: ReactNode
}

export function McpServerDetails({
  server,
  tools,
  onEdit,
  onClosePanel,
  onRefreshTools,
  isRefreshing,
  isEditing,
  onSave,
  isSaving,
  disableSave,
  formContent,
}: McpServerDetailsProps) {
  const [isCopied, setIsCopied] = useState(false)
  const saveHandler = onSave ? () => onSave() : undefined

  if (!server) {
    return (
      <div className='flex h-full items-center justify-center bg-card text-muted-foreground text-sm'>
        Select a server to view its details.
      </div>
    )
  }

  const headerEntries = Object.entries(server.headers || {}).filter(([key, value]) => key || value)
  const connectionStatus = server.connectionStatus || 'disconnected'
  const statusClass =
    connectionStatus === 'connected'
      ? 'border-green-700 bg-green-500/10 text-green-700'
      : connectionStatus === 'error'
        ? 'border-red-200 bg-red-500/10 text-red-700'
        : 'border-border bg-muted text-muted-foreground'
  const statusLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'error'
        ? 'Error'
        : 'Disconnected'
  const displayToolCount =
    tools.length > 0 ? tools.length : server.toolCount !== undefined ? server.toolCount : 0
  const displayLastToolsRefresh = server.lastToolsRefresh || null
  const displayLastConnected = server.lastConnected || server.updatedAt || server.createdAt

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(server.id)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className='flex h-full flex-col border-border border rounded-lg bg-card '>
      <div className='flex flex-wrap items-start justify-between gap-3 border-b bg-card/50 p-3'>
        <div className='space-y-1'>
          <div className='flex flex-wrap items-center gap-2'>

            <Server className='h-4 w-4 text-muted-foreground' /> <h3 className='text-lg font-semibold leading-tight'>{server.name || 'Unnamed Server'}</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                statusClass
              )}
            >
              <span className='h-2 w-2 rounded-full bg-current opacity-70' />
              {statusLabel}
            </span>
          </div>
          <div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xs'>
            <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
              {server.transport?.toUpperCase() || 'HTTP'}
            </span>
            {server.updatedAt && (
              <span className='inline-flex items-center gap-1'>
                •<span>Updated {formatRelativeTime(server.updatedAt)}</span>
              </span>
            )}
            {server.createdAt && (
              <span className='inline-flex items-center gap-1'>
                •<span>Added {formatRelativeTime(server.createdAt)}</span>
              </span>
            )}
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {isEditing ? (
            <Button size='sm' onClick={saveHandler} disabled={disableSave || isSaving} className='gap-2'>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          ) : (
            <>
              <Button
                variant='outline'
                size='icon'
                onClick={onRefreshTools}
                className='h-7 w-7'
                disabled={isRefreshing}
              >
                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                <span className='sr-only'>{isRefreshing ? 'Refreshing tools' : 'Refresh tools'}</span>
              </Button>
              <Button
                variant='outline'
                size='icon'
                onClick={() => onEdit(server)}
                className='h-7 w-7'
              >
                <Pencil className='h-4 w-4' />
                <span className='sr-only'>Edit server</span>
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={onClosePanel}
                className='h-7 w-7 p-0 text-muted-foreground hover:text-foreground'
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>Close details</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className='flex-1 space-y-5 overflow-auto px-5 py-4'>
        {isEditing && formContent ? (
          <div className='h-full'>{formContent}</div>
        ) : (
          <>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              <div className='rounded-lg border bg-background p-3'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>URL</p>
                <div className='mt-1 break-all text-sm font-medium leading-tight'>
                  {formatDisplayText(server.url || '—')}
                </div>
              </div>
              <div className='rounded-lg border bg-background p-3'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Timeout</p>
                <p className='mt-1 text-sm font-medium text-foreground'>
                  {server.timeout ? `${server.timeout}ms` : '30,000ms'}
                </p>
              </div>
              <div className='rounded-lg border bg-background p-3'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Tool count</p>
                <p className='mt-1 text-sm font-medium text-foreground'>{displayToolCount ?? '—'}</p>
              </div>
              <div className='rounded-lg border bg-background p-3'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Last connected</p>
                <p className='mt-1 text-sm font-medium text-foreground'>
                  {displayLastConnected ? formatRelativeTime(displayLastConnected) : 'Not connected yet'}
                </p>
                {displayLastConnected && (
                  <p className='text-muted-foreground text-xs'>{formatAbsoluteDate(displayLastConnected)}</p>
                )}
              </div>
              <div className='rounded-lg border bg-background p-3'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Last used</p>
                <p className='mt-1 text-sm font-medium text-foreground'>
                  {server.lastUsed ? formatRelativeTime(server.lastUsed) : '—'}
                </p>
              </div>
              <div className='rounded-lg border bg-background p-3'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Last tools refresh</p>
                <p className='mt-1 text-sm font-medium text-foreground'>
                  {displayLastToolsRefresh ? formatRelativeTime(displayLastToolsRefresh) : '—'}
                </p>
                {displayLastToolsRefresh && (
                  <p className='text-muted-foreground text-xs'>{formatAbsoluteDate(displayLastToolsRefresh)}</p>
                )}
              </div>
            </div>

            <div className=''>
              <div className='flex items-center justify-between'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Headers</p>
                <span className='text-muted-foreground text-xs'>{headerEntries.length} configured</span>
              </div>
              <div className='mt-2 space-y-2'>
                {headerEntries.length > 0 ? (
                  headerEntries.map(([key, value], index) => (
                    <div key={`${key || 'header'}-${index}`} className='flex flex-col rounded border bg-secondary/30 p-2 text-sm'>
                      <span className='font-mono text-[11px] text-muted-foreground'>{key || 'Unnamed header'}</span>
                      <span className='break-all text-foreground'>
                        {value ? formatDisplayText(value) : <span className='text-muted-foreground'>No value</span>}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className='text-muted-foreground text-sm'>No headers configured.</p>
                )}
              </div>
            </div>

            <div className=''>
              <div className='flex items-center justify-between'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Tools</p>
                <span className='text-muted-foreground text-xs'>{tools.length} total</span>
              </div>
              {tools.length > 0 ? (
                <div className='mt-3 space-y-2'>
                  {tools.map((tool) => (
                    <div key={tool.id} className='rounded-md border bg-secondary/30 p-3'>
                      <div className='flex items-start justify-between gap-2'>
                        <div>
                          <p className='font-medium text-sm pb-2'>{tool.name}</p>
                          {tool.description && (
                            <p className='text-muted-foreground text-xs leading-relaxed'>{tool.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className='mt-2 text-muted-foreground text-sm'>No tools discovered yet.</p>
              )}
            </div>

            {server.lastError && (
              <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'>
                <p className='font-medium'>Last error</p>
                <p className='text-destructive/80 text-xs'>{server.lastError}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
