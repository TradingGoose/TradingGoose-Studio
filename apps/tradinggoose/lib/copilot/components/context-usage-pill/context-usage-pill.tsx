'use client'

import { memo, useState } from 'react'
import { Minimize2, Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ContextResponse } from '@/lib/copilot/native/contract'

interface ContextUsagePillProps {
  evidence: ContextResponse
  onCreateNewChat: () => void
  onCompact: () => Promise<void>
}

/** Context evidence has no advertised capacity; it is never a percentage or a billing report. */
export const ContextUsagePill = memo(
  ({ evidence, onCreateNewChat, onCompact }: ContextUsagePillProps) => {
    const [compacting, setCompacting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const label =
      evidence.tokenSource === 'active_native_usage'
        ? 'Native context usage'
        : evidence.tokenSource === 'context_estimate'
          ? 'Context estimate'
          : 'Context unavailable'
    const text =
      evidence.contextTokens === null
        ? label
        : `${label}: ${evidence.contextTokens.toLocaleString()} tokens`
    return (
      <div className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
        <Tooltip>
          <TooltipTrigger render={<span>{text}</span>} />
          <TooltipContent>{text}. Context capacity is unavailable.</TooltipContent>
        </Tooltip>
        <button
          type='button'
          aria-label='Compact native context'
          disabled={compacting}
          onClick={async () => {
            setCompacting(true)
            setError(null)
            try {
              await onCompact()
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Native compaction failed')
            } finally {
              setCompacting(false)
            }
          }}
        >
          <Minimize2 className='h-3 w-3' />
        </button>
        <button type='button' aria-label='Create new chat' onClick={onCreateNewChat}>
          <Plus className='h-3 w-3' />
        </button>
        {error && <span role='alert'>{error}</span>}
      </div>
    )
  }
)
ContextUsagePill.displayName = 'ContextUsagePill'
