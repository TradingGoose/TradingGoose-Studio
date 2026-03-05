'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { ToolbarAddBlockRequest } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-dispatcher'

type ToolbarAddBlockContextValue = (request: ToolbarAddBlockRequest) => void

const ToolbarAddBlockContext = createContext<ToolbarAddBlockContextValue | null>(null)

export function ToolbarAddBlockProvider({
  onAddBlock,
  children,
}: {
  onAddBlock: ToolbarAddBlockContextValue
  children: ReactNode
}) {
  return (
    <ToolbarAddBlockContext.Provider value={onAddBlock}>
      {children}
    </ToolbarAddBlockContext.Provider>
  )
}

export function useToolbarAddBlock() {
  const context = useContext(ToolbarAddBlockContext)
  if (!context) {
    throw new Error('useToolbarAddBlock must be used within a ToolbarAddBlockProvider')
  }

  return context
}
