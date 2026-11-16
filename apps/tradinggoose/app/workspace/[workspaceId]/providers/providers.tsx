'use client'

import React from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

type ProvidersProps = {
  children: React.ReactNode
  workspaceId: string
  requireFresh?: boolean
  onUnavailable?: (message: string) => void
} & ({ userId: string; inheritUser?: never } | { inheritUser: true; userId?: never })

const Providers = React.memo<ProvidersProps>((props) => {
  const { children, workspaceId, requireFresh, onUnavailable } = props
  const workspaceIdentityProps =
    props.inheritUser === true ? { inheritUser: true as const } : { userId: props.userId }

  return (
    <TooltipProvider delay={100} timeout={0}>
      <WorkspacePermissionsProvider
        workspaceId={workspaceId}
        requireFresh={requireFresh}
        onUnavailable={onUnavailable}
        {...workspaceIdentityProps}
      >
        {children}
      </WorkspacePermissionsProvider>
    </TooltipProvider>
  )
})

Providers.displayName = 'Providers'

export default Providers
