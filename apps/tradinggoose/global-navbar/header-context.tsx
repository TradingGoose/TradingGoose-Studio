'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

type HeaderSlotContent = React.ReactNode | React.ReactNode[]
type HeaderSlotName = 'left' | 'center' | 'right'
type HeaderSlotTargets = Record<HeaderSlotName, HTMLSpanElement | null>
type HeaderSlotPresence = Record<HeaderSlotName, boolean>
type HeaderSlotOwner = symbol
type HeaderSlotRegistration = {
  owner: HeaderSlotOwner
  slots: HeaderSlotPresence
}

export type GlobalNavbarHeaderSlots = {
  left?: HeaderSlotContent
  center?: HeaderSlotContent
  right?: HeaderSlotContent
}

interface GlobalNavbarHeaderContextValue {
  activeSlots: HeaderSlotPresence
  activeOwner: HeaderSlotOwner | null
  setActiveSlots: (owner: HeaderSlotOwner, slots: HeaderSlotPresence | null) => void
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
  const [registrations, setRegistrations] = React.useState<HeaderSlotRegistration[]>([])
  const [targets, setTargets] = React.useState<HeaderSlotTargets>({
    left: null,
    center: null,
    right: null,
  })
  const activeRegistration = registrations[registrations.length - 1] ?? null
  const activeSlots = activeRegistration?.slots ?? inactiveSlots
  const activeOwner = activeRegistration?.owner ?? null

  const setActiveSlots = React.useCallback(
    (owner: HeaderSlotOwner, slots: HeaderSlotPresence | null) => {
      setRegistrations((current) => {
        const next = current.filter((registration) => registration.owner !== owner)
        return slots ? [...next, { owner, slots }] : next
      })
    },
    []
  )

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
      activeOwner,
      setActiveSlots,
      setTarget,
      targets,
    }),
    [activeOwner, activeSlots, setActiveSlots, setTarget, targets]
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
  const owner = React.useMemo(() => Symbol('GlobalNavbarHeader'), [])
  const { activeOwner, setActiveSlots, targets } = useGlobalNavbarHeaderContext()
  const isActiveOwner = activeOwner === owner
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
    setActiveSlots(owner, activeSlots)
    return () => setActiveSlots(owner, null)
  }, [activeSlots, owner, setActiveSlots])

  return (
    <>
      {isActiveOwner && targets.left && hasLeft
        ? createPortal(renderHeaderSlot(props.left), targets.left)
        : null}
      {isActiveOwner && targets.center && hasCenter
        ? createPortal(renderHeaderSlot(props.center), targets.center)
        : null}
      {isActiveOwner && targets.right && hasRight
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
