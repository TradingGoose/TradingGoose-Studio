'use client'

import { useCallback, useMemo } from 'react'
import { buildDashboardColorPairDescriptor } from '@/lib/copilot/review-sessions/identity'
import {
  getDashboardColorPairMap,
  readDashboardColorPairDocument,
} from '@/lib/yjs/dashboard-layout-session'
import { useYjsTargetSession } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import type { PairColorContext } from '@/widgets/color-pairs'
import type { PairColor } from '@/widgets/pair-colors'

const EMPTY_PAIR_CONTEXT: PairColorContext = {}

const arePairContextsEqual = (left: PairColorContext, right: PairColorContext) =>
  JSON.stringify(left) === JSON.stringify(right)

export function useDashboardColorPair(input: {
  workspaceId: string
  ownerUserId: string
  layoutId: string
  pairColor: PairColor
  failureMessage: string
}) {
  const descriptor = useMemo(
    () =>
      input.pairColor !== 'gray'
        ? buildDashboardColorPairDescriptor({
            layoutId: input.layoutId,
            color: input.pairColor,
            workspaceId: input.workspaceId,
            ownerUserId: input.ownerUserId,
          })
        : null,
    [input.layoutId, input.ownerUserId, input.pairColor, input.workspaceId]
  )
  const session = useYjsTargetSession(descriptor, 'write', input.failureMessage)
  const subscribe = useMemo(() => {
    if (!session.doc) return (_listener: () => void) => () => {}
    const map = getDashboardColorPairMap(session.doc)
    return (listener: () => void) => {
      map.observeDeep(listener)
      return () => map.unobserveDeep(listener)
    }
  }, [session.doc])
  const read = useCallback(
    () => (session.doc ? readDashboardColorPairDocument(session.doc) : EMPTY_PAIR_CONTEXT),
    [session.doc]
  )
  const context = useYjsSubscription(subscribe, read, EMPTY_PAIR_CONTEXT, arePairContextsEqual)

  return { ...session, context }
}
