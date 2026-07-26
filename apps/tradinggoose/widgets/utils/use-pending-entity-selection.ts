'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Selection gate for entity-list projections: fires `onSelect(entityId)`
 * immediately when the id is in `members`, otherwise defers it until the
 * projection lists the id. The latest request always wins; a pending id is
 * discarded on unmount and never fires if it never appears.
 */
export function usePendingEntitySelection(
  members: ReadonlyArray<{ entityId: string }>,
  onSelect: (entityId: string) => void
): (entityId: string) => void {
  const [pendingEntityId, setPendingEntityId] = useState<string | null>(null)
  const membersRef = useRef(members)
  membersRef.current = members
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!pendingEntityId) return
    if (!members.some((member) => member.entityId === pendingEntityId)) return
    onSelectRef.current(pendingEntityId)
    setPendingEntityId(null)
  }, [members, pendingEntityId])

  return useCallback((entityId: string) => {
    if (membersRef.current.some((member) => member.entityId === entityId)) {
      setPendingEntityId(null)
      onSelectRef.current(entityId)
      return
    }
    setPendingEntityId(entityId)
  }, [])
}
