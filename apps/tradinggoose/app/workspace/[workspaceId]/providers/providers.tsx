'use client'

import React from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

interface ProvidersProps {
  children: React.ReactNode
  workspaceId?: string
}

const Providers = React.memo<ProvidersProps>(({ children, workspaceId }) => {
  return (
    <TooltipProvider delayDuration={100} skipDelayDuration={0}>
      <WorkspacePermissionsProvider workspaceId={workspaceId}>
        {children}
      </WorkspacePermissionsProvider>
    </TooltipProvider>
  )
})

Providers.displayName = 'Providers'

export default Providers
