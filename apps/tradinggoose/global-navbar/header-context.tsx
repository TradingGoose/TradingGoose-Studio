'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

type HeaderSlotContent = React.ReactNode | React.ReactNode[]
type HeaderSlotName = 'left' | 'center' | 'right'
type HeaderSlotTargets = Record<HeaderSlotName, HTMLSpanElement | null>
type HeaderSlotPresence = Record<HeaderSlotName, boolean>

export type GlobalNavbarHeaderSlots = {
  left?: HeaderSlotContent
  center?: HeaderSlotContent
  right?: HeaderSlotContent
}

interface GlobalNavbarHeaderContextValue {
  activeSlots: HeaderSlotPresence
  setActiveSlots: (slots: HeaderSlotPresence) => void
  setTarget: (slot: HeaderSlotName, target: HTMLSpanElement | null) => void
  targets: HeaderSlotTargets
}

const inactiveSlots: HeaderSlotPresence = { left: false, center: false, right: false }

const GlobalNavbarHeaderContext = React.createContext<GlobalNavbarHeaderContextValue | null>(null)

export function useGlobalNavbarHeaderContext() {
  const context = React.useContext(GlobalNavbarHeaderContext)
  if (!context) {
    throw new Error('useGlobalNavbarHeaderContext must be used within GlobalNavbarHeaderProvider')
  }
  return context
}

export function GlobalNavbarHeaderProvider({ children }: { children: React.ReactNode }) {
  const [activeSlots, setActiveSlots] = React.useState<HeaderSlotPresence>(inactiveSlots)
  const [targets, setTargets] = React.useState<HeaderSlotTargets>({
    left: null,
    center: null,
    right: null,
  })

  const setTarget = React.useCallback(
    (slot: HeaderSlotName, target: HTMLSpanElement | null) => {
      setTargets((current) => {
        if (current[slot] === target) {
          return current
        }
        return { ...current, [slot]: target }
      })
    },
    []
  )

  const contextValue = React.useMemo(
    () => ({
      activeSlots,
      setActiveSlots,
      setTarget,
      targets,
    }),
    [activeSlots, setTarget, targets]
  )

  return (
    <GlobalNavbarHeaderContext.Provider value={contextValue}>
      {children}
    </GlobalNavbarHeaderContext.Provider>
  )
}

export function useGlobalNavbarHeaderActiveSlots() {
  return useGlobalNavbarHeaderContext().activeSlots
}

export function useGlobalNavbarHeaderSlotTarget(slot: HeaderSlotName) {
  const { setTarget } = useGlobalNavbarHeaderContext()
  return React.useCallback(
    (target: HTMLSpanElement | null) => {
      setTarget(slot, target)
    },
    [setTarget, slot]
  )
}

export function GlobalNavbarHeader(props: GlobalNavbarHeaderSlots) {
  const { setActiveSlots, targets } = useGlobalNavbarHeaderContext()
  const hasLeft = props.left !== undefined
  const hasCenter = props.center !== undefined
  const hasRight = props.right !== undefined

  const activeSlots = React.useMemo(
    () => ({
      left: hasLeft,
      center: hasCenter,
      right: hasRight,
    }),
    [hasLeft, hasCenter, hasRight]
  )

  React.useEffect(() => {
    setActiveSlots(activeSlots)
    return () => setActiveSlots(inactiveSlots)
  }, [activeSlots, setActiveSlots])

  return (
    <>
      {targets.left && hasLeft ? createPortal(renderHeaderSlot(props.left), targets.left) : null}
      {targets.center && hasCenter
        ? createPortal(renderHeaderSlot(props.center), targets.center)
        : null}
      {targets.right && hasRight
        ? createPortal(renderHeaderSlot(props.right), targets.right)
        : null}
    </>
  )
}

function renderHeaderSlot(slot?: HeaderSlotContent) {
  if (!slot) {
    return null
  }

  if (Array.isArray(slot)) {
    return slot.map((node, index) => (
      <span key={index} className='inline-flex items-center gap-2 whitespace-nowrap'>
        {node}
      </span>
    ))
  }

  return slot
}
